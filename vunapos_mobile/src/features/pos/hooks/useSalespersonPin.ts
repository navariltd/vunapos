import { useEffect, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { useNetworkStatus } from '@/services/NetworkStatusProvider';
import { PosSalespersonSession } from '@/features/pos/types';
import { FrappeClientError, postVunaMethod } from '@/services/frappeClient';

type SalespersonVerification = {
  display_name: string;
  expires_in: number;
  salesperson: string;
  token: string;
};

type SalespersonPinState = {
  error: string | null;
  isVerifying: boolean;
  session: PosSalespersonSession | null;
};

/** Owns the short-lived, server-issued salesperson PIN session for one POS workspace. */
export function useSalespersonPin() {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [state, setState] = useState<SalespersonPinState>({ error: null, isVerifying: false, session: null });

  useEffect(() => {
    if (!state.session) return;
    const timeout = setTimeout(() => {
      setState((current) => current.session?.token === state.session?.token
        ? { ...current, session: null }
        : current);
    }, Math.max(state.session.expiresAt - Date.now(), 0));
    return () => clearTimeout(timeout);
  }, [state.session]);

  function lock() {
    setState((current) => ({ ...current, error: null, session: null }));
  }

  async function verify(posProfile: string, salesperson: string, pin: string): Promise<boolean> {
    if (connectionStatus !== 'online') {
      setState((current) => ({ ...current, error: 'Connection unavailable. Reconnect before verifying a salesperson PIN.' }));
      return false;
    }
    if (!companyUrl || !sessionId) {
      setState((current) => ({ ...current, error: 'Your session is no longer available. Sign in again to continue.' }));
      return false;
    }
    setState((current) => ({ ...current, error: null, isVerifying: true }));
    try {
      const verification = await postVunaMethod<SalespersonVerification>(companyUrl, sessionId, 'vunapos.api.pin.verify_salesperson', {
        pin,
        pos_profile: posProfile,
        salesperson,
      });
      setState({
        error: null,
        isVerifying: false,
        session: {
          displayName: verification.display_name || verification.salesperson,
          expiresAt: Date.now() + verification.expires_in * 1000,
          name: verification.salesperson,
          token: verification.token,
        },
      });
      return true;
    } catch (requestError) {
      if (requestError instanceof FrappeClientError && requestError.code === 'session') {
        void invalidateSession();
      }
      setState((current) => ({
        ...current,
        error: requestError instanceof Error ? requestError.message : 'PIN verification failed.',
        isVerifying: false,
      }));
      return false;
    }
  }

  return { error: state.error, isVerifying: state.isVerifying, lock, session: state.session, verify };
}
