import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PosCacheKey,
  posCache,
  posCacheKey,
} from "@/services/posCache";
import { NetworkConnectionStatus } from "@/services/NetworkStatusProvider";

export const POS_CACHE_TTL_MS = 60 * 60 * 1000;

export type PosCachedResourceClient = Pick<typeof posCache, "fetch" | "read">;

type UsePosCachedResourceArgs<T> = {
  cache?: PosCachedResourceClient;
  cacheKey: PosCacheKey | null;
  connectionStatus: NetworkConnectionStatus;
  enabled?: boolean;
  load: (signal: AbortSignal) => Promise<T>;
  ttlMs?: number;
};

type PosCachedResourceState<T> = {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  keyFingerprint: string | null;
  lastUpdated: number | null;
};

const emptyState = {
  data: null,
  error: null,
  isLoading: false,
  isRefreshing: false,
  isStale: false,
  keyFingerprint: null,
  lastUpdated: null,
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not refresh this data.";
}

/**
 * Gives browseable POS resources one predictable stale-while-revalidate path.
 * Mutations and authoritative transaction checks deliberately do not use it.
 */
export function usePosCachedResource<T>({
  cache = posCache,
  cacheKey,
  connectionStatus,
  enabled = true,
  load,
  ttlMs = POS_CACHE_TTL_MS,
}: UsePosCachedResourceArgs<T>) {
  const loadRef = useRef(load);
  loadRef.current = load;
  const cacheKeyRef = useRef(cacheKey);
  cacheKeyRef.current = cacheKey;
  const keyFingerprint = useMemo(
    () => (cacheKey ? posCacheKey(cacheKey) : null),
    [cacheKey],
  );
  const [state, setState] = useState<PosCachedResourceState<T>>(emptyState);

  const loadResource = useCallback(
    async (forceRefresh: boolean) => {
      const activeKey = cacheKeyRef.current;
      if (!activeKey) return;
      const activeFingerprint = posCacheKey(activeKey);
      const isActive = () => {
        const currentKey = cacheKeyRef.current;
        return Boolean(
          currentKey && posCacheKey(currentKey) === activeFingerprint,
        );
      };
      const setActiveState = (nextState: Omit<PosCachedResourceState<T>, "keyFingerprint">) => {
        if (!isActive()) return;
        setState({ ...nextState, keyFingerprint: activeFingerprint });
      };

      const canRequest = enabled && connectionStatus !== "offline";
      const cached = await cache.read<T>(activeKey);
      if (!isActive()) return;

      if (!forceRefresh && cached && !cached.isStale) {
        setActiveState({
          data: cached.data,
          error: null,
          isLoading: false,
          isRefreshing: false,
          isStale: false,
          lastUpdated: cached.fetchedAt,
        });
        return;
      }

      if (cached) {
        setActiveState({
          data: cached.data,
          error: null,
          isLoading: false,
          isRefreshing: canRequest,
          isStale: cached.isStale,
          lastUpdated: cached.fetchedAt,
        });
      } else if (!canRequest) {
        setActiveState({
          ...emptyState,
          error: "You are offline. Connect to load this data.",
        });
        return;
      } else {
        setActiveState({
          ...emptyState,
          isLoading: true,
        });
      }

      if (!canRequest) return;

      try {
        const controller = new AbortController();
        const data = await cache.fetch(
          activeKey,
          () => loadRef.current(controller.signal),
          ttlMs,
        );
        setActiveState({
          data,
          error: null,
          isLoading: false,
          isRefreshing: false,
          isStale: false,
          lastUpdated: Date.now(),
        });
      } catch (error) {
        if (!isActive()) return;
        setState((current) => ({
          ...current,
          error: errorMessage(error),
          isLoading: false,
          isRefreshing: false,
        }));
      }
    },
    [cache, connectionStatus, enabled, ttlMs],
  );

  useEffect(() => {
    if (!keyFingerprint) {
      setState(emptyState);
      return;
    }

    let disposed = false;
    void loadResource(false).then(() => {
      if (disposed) return;
    });
    return () => {
      disposed = true;
    };
  }, [enabled, keyFingerprint, loadResource]);

  const refresh = useCallback(async () => {
    await loadResource(true);
  }, [loadResource]);

  const isCurrentKey = state.keyFingerprint === keyFingerprint;
  const currentState = isCurrentKey ? state : emptyState;
  const isHydrating = Boolean(keyFingerprint && !isCurrentKey);

  return {
    ...currentState,
    isLoading: currentState.isLoading || isHydrating,
    refresh,
  };
}
