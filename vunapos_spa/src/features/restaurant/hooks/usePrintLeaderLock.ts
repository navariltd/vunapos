import { useEffect, useMemo, useState } from "react";

// Web Locks are atomic across tabs. A localStorage read/write lease is not.
export function usePrintLeaderLock(channelKey: string, enabled: boolean) {
  const request = useMemo(() => ({channelKey, enabled}), [channelKey, enabled]);
  const [leader, setLeader] = useState<typeof request | null>(null);
  useEffect(() => {
    if (!request.enabled || !navigator.locks) return;
    const abort = new AbortController();
    let release: (() => void) | undefined;
    void navigator.locks.request(`vunapos-kitchen-print:${request.channelKey}`, { signal: abort.signal }, async () => {
      if (abort.signal.aborted) return;
      setLeader(request);
      await new Promise<void>(resolve => { release = resolve; });
      setLeader(current => current === request ? null : current);
    }).catch(() => { /* Abort on navigation/logout also removes queued lock requests. */ });
    return () => { abort.abort(); release?.(); };
  }, [request]);
  return enabled && leader === request;
}
