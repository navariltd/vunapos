import { useRef, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosCloseShiftResult } from "@/features/pos/types";
import { FrappeClientError, postVunaJsonMethod } from "@/services/frappeClient";

type ClosePosShiftInput = {
  closingBalances: { closing_amount: number; mode_of_payment: string }[];
  posProfile: string;
};

/** Submits previously reviewed till counts; ERPNext remains authoritative. */
export function useClosePosShift() {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const [error, setError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const closingInFlight = useRef(false);

  function clearError() {
    setError(null);
  }

  async function close(
    input: ClosePosShiftInput,
  ): Promise<PosCloseShiftResult | null> {
    if (closingInFlight.current) return null;
    if (!companyUrl || !sessionId) {
      setError(
        "Your session is no longer available. Sign in again to continue.",
      );
      return null;
    }

    closingInFlight.current = true;
    setError(null);
    setIsClosing(true);
    try {
      return await postVunaJsonMethod<PosCloseShiftResult>(
        companyUrl,
        sessionId,
        "vunapos.api.pos_closing.close_session",
        {
          closing_balances: input.closingBalances,
          pos_profile: input.posProfile,
        },
      );
    } catch (requestError) {
      if (
        requestError instanceof FrappeClientError &&
        requestError.code === "session"
      ) {
        void invalidateSession();
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not close this POS shift.",
      );
      return null;
    } finally {
      closingInFlight.current = false;
      setIsClosing(false);
    }
  }

  return { clearError, close, error, isClosing };
}
