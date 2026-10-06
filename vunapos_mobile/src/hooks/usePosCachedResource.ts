import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PosCacheEntry,
  PosCacheKey,
  posCache,
  posCacheKey,
} from "@/services/posCache";
import { NetworkConnectionStatus } from "@/services/NetworkStatusProvider";

/** Freshness is a refresh trigger; stale rows remain available while it runs. */
export const POS_CACHE_TTL_MS = 60 * 1000;

export type PosCachedResourceClient = Pick<
  typeof posCache,
  "fetch" | "read"
> & {
  subscribe?: (key: PosCacheKey, listener: () => void) => () => void;
};

type UsePosCachedResourceArgs<T> = {
  cache?: PosCachedResourceClient;
  cacheKey: PosCacheKey | null;
  connectionStatus: NetworkConnectionStatus;
  enabled?: boolean;
  /** The cached snapshot is supplied so delta-capable loaders can use its watermark. */
  load: (signal: AbortSignal, cached?: T | null) => Promise<T>;
  /** Only app-owned resources should participate in the global freshness scheduler. */
  manageFreshness?: boolean;
  ttlMs?: number;
};

type PosCachedResourceState<T> = {
  data: T | null;
  error: string | null;
  hasHydratedCache: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  isStale: boolean;
  keyFingerprint: string | null;
  lastUpdated: number | null;
};

const emptyState = {
  data: null,
  error: null,
  hasHydratedCache: false,
  isLoading: false,
  isRefreshing: false,
  isStale: false,
  keyFingerprint: null,
  lastUpdated: null,
};

const registeredRefreshers = new Map<string, Set<() => void>>();

/** Invoked by the single app-level freshness scheduler. */
export async function refreshRegisteredPosResources() {
  const refreshes = [...registeredRefreshers.values()].flatMap((callbacks) =>
    [...callbacks].map((refresh) => refresh()),
  );
  await Promise.allSettled(refreshes);
}

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
  manageFreshness = true,
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

      if (!enabled) {
        let cached: PosCacheEntry<T> | null = null;
        try {
          cached = await cache.read<T>(activeKey);
        } catch (error) {
          if (!isActive()) return;
          setActiveState({
            ...emptyState,
            error: errorMessage(error),
            hasHydratedCache: true,
          });
          return;
        }
        if (!isActive()) return;
        setActiveState(
          cached
            ? {
                data: cached.data,
                error: null,
                hasHydratedCache: true,
                isLoading: false,
                isRefreshing: false,
                isStale: cached.isStale,
                lastUpdated: cached.fetchedAt,
              }
            : { ...emptyState, hasHydratedCache: true },
        );
        return;
      }

      let cached: PosCacheEntry<T> | null = null;
      try {
        cached = await cache.read<T>(activeKey);
      } catch (error) {
        // A local read failure must not leave the resource permanently in the
        // unresolved hydration state. Treat it as a cache miss and let the
        // normal server request provide the recovery path.
        if (!isActive()) return;
        setActiveState({
          ...emptyState,
          error: errorMessage(error),
          hasHydratedCache: true,
        });
      }
      if (!isActive()) return;

      // Cached rows remain usable during outages. When there is no cached row,
      // however, let the request reach Frappe and classify the real failure
      // instead of treating Expo Network's hint as authoritative.
      const canRequest = connectionStatus !== "offline" || !cached;

      if (!forceRefresh && cached && !cached.isStale) {
        setActiveState({
          data: cached.data,
          error: null,
          hasHydratedCache: true,
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
          hasHydratedCache: true,
          isLoading: false,
          isRefreshing: canRequest,
          isStale: cached.isStale,
          lastUpdated: cached.fetchedAt,
        });
      } else if (!canRequest) {
        setActiveState({ ...emptyState, hasHydratedCache: true, isLoading: true });
        return;
      } else {
        setActiveState({
          ...emptyState,
          hasHydratedCache: true,
          isLoading: true,
        });
      }

      if (!canRequest) return;

      try {
        const controller = new AbortController();
        const data = await cache.fetch(
          activeKey,
          () => loadRef.current(controller.signal, cached?.data ?? null),
          ttlMs,
        );
        setActiveState({
          data,
          error: null,
          hasHydratedCache: true,
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

  useEffect(() => {
    if (!keyFingerprint || !cache.subscribe || !cacheKey) return;
    const unsubscribe = cache.subscribe(cacheKey, () => {
      void cache.read<T>(cacheKey).then((cached) => {
        if (!cached || posCacheKey(cacheKey) !== keyFingerprint) return;
        setState({
          data: cached.data,
          error: null,
          hasHydratedCache: true,
          isLoading: false,
          isRefreshing: false,
          isStale: cached.isStale,
          keyFingerprint,
          lastUpdated: cached.fetchedAt,
        });
      });
    });
    return unsubscribe;
  }, [cache, cacheKey, keyFingerprint]);

  useEffect(() => {
    if (!enabled || !manageFreshness || !keyFingerprint) return;
    const refresh = () => loadResource(false);
    const refreshers = registeredRefreshers.get(keyFingerprint) ?? new Set();
    refreshers.add(refresh);
    registeredRefreshers.set(keyFingerprint, refreshers);
    return () => {
      refreshers.delete(refresh);
      if (!refreshers.size) registeredRefreshers.delete(keyFingerprint);
    };
  }, [enabled, keyFingerprint, loadResource, manageFreshness]);

  const refresh = useCallback(async () => {
    await loadResource(true);
  }, [loadResource]);

  const isCurrentKey = state.keyFingerprint === keyFingerprint;
  const currentState = isCurrentKey ? state : emptyState;
  const isHydratingCache = Boolean(
    keyFingerprint && (!isCurrentKey || !currentState.hasHydratedCache),
  );
  const hasHydratedCache = Boolean(
    keyFingerprint && isCurrentKey && currentState.hasHydratedCache,
  );

  return {
    ...currentState,
    isLoading: currentState.isLoading || isHydratingCache,
    isHydratingCache,
    hasHydratedCache,
    isInitialNetworkLoading:
      hasHydratedCache && currentState.isLoading && !currentState.data,
    refresh,
  };
}
