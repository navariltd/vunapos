import { useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import {
  FrappeClientError,
  postFrappeJsonMethod,
} from "@/services/frappeClient";

type OpenPosShiftInput = {
  openingBalances: { mode_of_payment: string; opening_amount: number }[];
  posProfile: string;
};

export type OpenPosShiftResult = {
  message?: string;
  name: string;
  pos_profile: string;
  success: boolean;
};

/** Creates a server-authorized POS Opening Entry for the signed-in cashier. */
export function useOpenPosShift() {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [error, setError] = useState<string | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  function clearError() {
    setError(null);
  }

  async function open(
    input: OpenPosShiftInput,
  ): Promise<OpenPosShiftResult | null> {
    if (connectionStatus !== "online") {
      setError("Reconnect to the server before opening this POS shift.");
      return null;
    }
    if (!companyUrl || !sessionId) {
      setError(
        "Your session is no longer available. Sign in again to continue.",
      );
      return null;
    }

    setError(null);
    setIsOpening(true);
    try {
      return await postFrappeJsonMethod<OpenPosShiftResult>(
        companyUrl,
        sessionId,
        "vunapos.api.pos_entry.create_opening_entry",
        {
          opening_balance: input.openingBalances,
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
          : "Could not open this POS shift.",
      );
      return null;
    } finally {
      setIsOpening(false);
    }
  }

  return { clearError, error, isOpening, open };
}
