import { useCallback, useEffect } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import {
  invalidateHeldInvoiceCache,
  invalidateSaleCache,
} from "@/services/posCacheInvalidation";
import { refreshSoldItemStock } from "@/services/posInventoryRefresh";
import { registerRealtimeRefresh } from "@/sync/realtimeInvalidation";
import { takeQueuedCheckout } from "@/sync/queuedCheckoutRegistry";

type QueueEvent = {
  invoice_name?: unknown;
  pos_profile?: unknown;
  status?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * Reconciles server-side queued checkouts without coupling queue updates to a
 * particular screen. The registry contains the original cart only while this
 * process is alive; after a restart, timestamp refresh remains the fallback.
 */
export function usePosQueueRealtime() {
  const { authState, companyUrl, sessionId } = useAppSession();

  const handleQueueEvent = useCallback(
    async (rawPayload?: unknown) => {
      if (
        authState !== "signedIn" ||
        !companyUrl ||
        !sessionId ||
        !rawPayload ||
        typeof rawPayload !== "object"
      ) {
        return;
      }

      const payload = rawPayload as QueueEvent;
      const invoiceName = text(payload.invoice_name);
      if (!invoiceName) return;

      const queued = takeQueuedCheckout(invoiceName);
      const posProfile = text(payload.pos_profile) ?? queued?.posProfile;

      // Queue screens and invoice history should reflect every transition,
      // including events received after a retry or from another app instance.
      if (posProfile) {
        await invalidateHeldInvoiceCache({ companyUrl, posProfile, sessionId });
      }

      if (text(payload.status) !== "Submitted" || !posProfile) {
        return;
      }

      // After a process restart the original cart is unavailable. Mark the
      // affected resources stale so the normal timestamp delta repairs them;
      // never invent a second item-details request without cart context.
      await invalidateSaleCache({ companyUrl, posProfile, sessionId });
      if (!queued) return;

      await refreshSoldItemStock({
        companyUrl,
        items: queued.items,
        posProfile,
        sessionId,
      });
    },
    [authState, companyUrl, sessionId],
  );

  useEffect(
    () => registerRealtimeRefresh("checkout-queue", handleQueueEvent),
    [handleQueueEvent],
  );
}
