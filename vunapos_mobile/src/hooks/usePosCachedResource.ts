import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PosCacheEntry,
  PosCacheKey,
  SupersededCacheRequestError,
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
  subscribe?: (key: PosCacheKey, listener: (event: "write" | "clear") => void) => () => void;
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

/**
 * Resource lifecycle using the existing flags, without a second store:
 * - unmatched key / !hasHydratedCache: local hydration unresolved;
 * - hydrated + no data + isLoading: genuine cold network bootstrap;
 * - data + isStale/isRefreshing: usable same-scope display during revalidation;
 * - data + error: failed refresh retaining last-known-good display;
 * - no data + error: cold-start failure;
 * - key change: previous scope is hidden immediately;
 * - clear event: previous data is explicitly discarded, not treated as a miss.
 */

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

type RegisteredRefresher = {
  resource: string;
  refresh: (force: boolean) => Promise<void>;
};

const registeredRefreshers = new Map<string, Set<RegisteredRefresher>>();

/** Invoked by the single app-level freshness scheduler. */
export async function refreshRegisteredPosResources(options?: {
  force?: boolean;
  excludeResources?: readonly string[];
}) {
  const refreshes = [...registeredRefreshers.values()].flatMap((callbacks) =>
    [...callbacks]
      .filter(({ resource }) => !options?.excludeResources?.includes(resource))
      .map(({ refresh }) => refresh(options?.force === true)),
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
  const stateRef = useRef(state);
  stateRef.current = state;
  const clearVersionRef = useRef(0);
  const dataClearVersionRef = useRef(0);
  const clearedFingerprintRef = useRef<string | null>(null);
  const loadGenerationRef = useRef(0);

  const loadResource = useCallback(
    async (forceRefresh: boolean, afterCurrent = false) => {
      const activeKey = cacheKeyRef.current;
      if (!activeKey) return;
      const activeFingerprint = posCacheKey(activeKey);
      const clearVersion = clearVersionRef.current;
      // Forced full rebootstrap requests deliberately queue behind the active
      // request in PosCache.fetch; do not discard one of those intents here.
      const loadGeneration = afterCurrent ? null : ++loadGenerationRef.current;
      const isActive = () => {
        const currentKey = cacheKeyRef.current;
        return Boolean(
          currentKey && posCacheKey(currentKey) === activeFingerprint &&
          clearVersion === clearVersionRef.current &&
          (loadGeneration === null || loadGeneration === loadGenerationRef.current),
        );
      };
      const setActiveState = (nextState: Omit<PosCachedResourceState<T>, "keyFingerprint">) => {
        if (!isActive()) return;
        if (nextState.data !== null) dataClearVersionRef.current = clearVersion;
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
      let readError: string | null = null;
      try {
        cached = await cache.read<T>(activeKey);
      } catch (error) {
        readError = errorMessage(error);
      }
      if (!isActive()) return;

      // A recoverable same-scope miss must not put an operational resource
      // back into cold-start loading. This is display data, not checkout
      // authority; cache entry count/byte limits and explicit scope clears
      // govern durable retention.
      const prior = stateRef.current;
      const retainedPrior = dataClearVersionRef.current === clearVersion &&
        prior.keyFingerprint === activeFingerprint &&
        prior.data !== null && prior.lastUpdated !== null
        ? prior : null;
      const display = cached ?? (retainedPrior ? {
        data: retainedPrior.data as T,
        expiresAt: 0,
        fetchedAt: retainedPrior.lastUpdated as number,
        isStale: true,
      } : null);

      // Cached rows remain usable during outages. When there is no cached row,
      // however, let the request reach Frappe and classify the real failure
      // instead of treating Expo Network's hint as authoritative.
      // A forced retry/reconnect follows an observed server action, so an
      // outdated device network hint must not prevent the actual request.
      const canRequest = forceRefresh || connectionStatus !== "offline" || !display;

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

      if (display) {
        setActiveState({
          data: display.data,
          error: readError,
          hasHydratedCache: true,
          isLoading: false,
          isRefreshing: canRequest,
          isStale: display.isStale,
          lastUpdated: display.fetchedAt,
        });
      } else if (!canRequest) {
        setActiveState({ ...emptyState, error: readError, hasHydratedCache: true, isLoading: true });
        return;
      } else {
        setActiveState({
          ...emptyState,
          error: readError,
          hasHydratedCache: true,
          isLoading: true,
        });
      }

      if (!canRequest) return;

      try {
        const controller = new AbortController();
        const data = await cache.fetch(
          activeKey,
          () => loadRef.current(controller.signal, display?.data ?? null),
          ttlMs,
          { afterCurrent },
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
          error: error instanceof SupersededCacheRequestError
            ? current.error
            : errorMessage(error),
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
    const unsubscribe = cache.subscribe(cacheKey, (event) => {
      if (event === "clear") {
        clearVersionRef.current += 1;
        clearedFingerprintRef.current = keyFingerprint;
        setState((current) => current.keyFingerprint === keyFingerprint
          ? { ...emptyState, hasHydratedCache: true, keyFingerprint }
          : current);
        return;
      }
      const readClearVersion = clearVersionRef.current;
      void cache.read<T>(cacheKey).then((cached) => {
        if (!cached || posCacheKey(cacheKey) !== keyFingerprint ||
          readClearVersion !== clearVersionRef.current) return;
        dataClearVersionRef.current = readClearVersion;
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
    const registration: RegisteredRefresher = {
      resource: cacheKeyRef.current?.resource ?? "",
      refresh: loadResource,
    };
    const refreshers = registeredRefreshers.get(keyFingerprint) ?? new Set();
    refreshers.add(registration);
    registeredRefreshers.set(keyFingerprint, refreshers);
    return () => {
      refreshers.delete(registration);
      if (!refreshers.size) registeredRefreshers.delete(keyFingerprint);
    };
  }, [enabled, keyFingerprint, loadResource, manageFreshness]);

  const refresh = useCallback(async (options?: { afterCurrent?: boolean }) => {
    await loadResource(true, options?.afterCurrent);
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
    isScopeInvalidated: Boolean(
      keyFingerprint && clearedFingerprintRef.current === keyFingerprint &&
      dataClearVersionRef.current !== clearVersionRef.current,
    ),
    isLoading: currentState.isLoading || isHydratingCache,
    isHydratingCache,
    hasHydratedCache,
    isInitialNetworkLoading:
      hasHydratedCache && currentState.isLoading && !currentState.data,
    refresh,
  };
}
