import { useCallback, useEffect, useState } from 'react';

import { useAppSession } from '@/features/auth/AppSessionProvider';
import { useNetworkStatus } from '@/services/NetworkStatusProvider';
import { PosBootstrapData } from '@/features/pos/types';
import { FrappeClientError, getVunaMethod } from '@/services/frappeClient';

type PosBootstrapState = {
  data: PosBootstrapData | null;
  error: string | null;
  isLoading: boolean;
  reload: () => void;
};

type PosBootstrapRequestState = Omit<PosBootstrapState, 'isLoading' | 'reload'> & {
  requestKey: string | null;
};

export function usePosBootstrap(): PosBootstrapState {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [reloadKey, setReloadKey] = useState(0);
  const requestKey = companyUrl && sessionId ? `${companyUrl}:${sessionId}:${reloadKey}` : null;
  const [state, setState] = useState<PosBootstrapRequestState>({ data: null, error: null, requestKey: null });

  useEffect(() => {
    if (connectionStatus === 'offline' || !companyUrl || !sessionId) {
      return;
    }

    const controller = new AbortController();

    void getVunaMethod<PosBootstrapData>(companyUrl, sessionId, 'vunapos.api.pos.get_pos_bootstrap', {}, controller.signal)
      .then((data) => setState({ data, error: null, requestKey }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof FrappeClientError && error.code === 'session') {
          void invalidateSession();
          return;
        }
        setState({ data: null, error: error instanceof Error ? error.message : 'Could not load the POS workspace.', requestKey });
      });

    return () => controller.abort();
  }, [companyUrl, connectionStatus, invalidateSession, requestKey, sessionId]);

  const reload = useCallback(() => {
    if (connectionStatus !== 'offline') setReloadKey((current) => current + 1);
  }, [connectionStatus]);

  if (!requestKey) return { data: null, error: 'Your session is no longer available. Sign in again to continue.', isLoading: false, reload };

  if (connectionStatus === 'offline') {
    return { data: state.data, error: null, isLoading: false, reload };
  }

  return { ...state, isLoading: state.requestKey !== requestKey, reload };
}
