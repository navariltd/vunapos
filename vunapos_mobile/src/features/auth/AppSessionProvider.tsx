import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { normalizeCompanyUrl } from "@/config/companyUrl";
import {
  FrappeClientError,
  FrappePasswordResetRequiredError,
  requestFrappePasswordReset,
  signInToFrappe,
  subscribeToFrappeSessionExpiry,
  updateFrappePassword,
  validateFrappeSession,
  verifyVunaPosSite,
} from "@/services/frappeClient";
import {
  clearStoredCompanyUrl,
  clearStoredSession,
  clearStoredRevokedSession,
  loadStoredCompanyUrl,
  loadStoredRevokedSession,
  loadStoredSessionId,
  markStoredSessionRevoked,
  persistCompanyUrl,
  persistSessionId,
} from "@/services/sessionStore";
import { posCache } from "@/services/posCache";

export type AuthState =
  "needsCompanyUrl" | "signedIn" | "signedOut" | "sessionExpired";
type SaveCompanyUrlResult = { ok: true } | { ok: false; message: string };
type ActionResult = { ok: true } | { ok: false; message: string };
type SignInResult = ActionResult | { ok: false; requiresPasswordReset: true };

type AppSessionContextValue = {
  authState: AuthState;
  clearLocalPosData: () => Promise<void>;
  companyUrl: string | null;
  completePasswordReset: (newPassword: string) => Promise<ActionResult>;
  hasPendingPasswordReset: boolean;
  invalidateSession: (rejectedSessionId?: string | null, rejectedCompanyUrl?: string | null) => Promise<void>;
  isBootstrapping: boolean;
  clearCompanyUrl: () => Promise<void>;
  saveCompanyUrl: (rawUrl: string) => Promise<SaveCompanyUrlResult>;
  sessionId: string | null;
  signIn: (identifier: string, password: string) => Promise<SignInResult>;
  requestPasswordReset: (email: string) => Promise<ActionResult>;
  signOut: () => Promise<void>;
};

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

export function AppSessionProvider({ children }: PropsWithChildren) {
  const [companyUrl, setCompanyUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [passwordResetKey, setPasswordResetKey] = useState<string | null>(null);
  const [authState, setAuthState] = useState<AuthState>("needsCompanyUrl");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const activeSession = useRef<string | null>(null);
  const activeCompanyUrl = useRef<string | null>(null);
  const invalidation = useRef<{ companyUrl: string; sessionId: string; promise: Promise<void> } | null>(null);
  const pendingCleanup = useRef<Promise<void> | null>(null);
  const transitionVersion = useRef(0);
  const storageQueue = useRef<Promise<unknown>>(Promise.resolve());
  const queueStorage = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = storageQueue.current.catch(() => undefined).then(operation);
    storageQueue.current = result;
    return result;
  }, []);
  const revokeStoredSession = useCallback((site: string, sid: string) => queueStorage(async () => {
    let marked = false;
    try {
      await markStoredSessionRevoked(site, sid);
      marked = true;
    } catch {
      // Deletion can still revoke the credential if the marker write failed.
    }
    try {
      await clearStoredSession();
    } catch (error) {
      if (!marked) throw error;
      console.warn("Could not delete a revoked session from secure storage.");
    }
  }), [queueStorage]);
  const persistAuthenticatedSession = useCallback(async (site: string, sid: string, version: number) => {
    await pendingCleanup.current;
    await queueStorage(async () => {
      if (version !== transitionVersion.current) return;
      // Never replace an old revocation marker if its SID could not be deleted.
      await clearStoredSession();
      if (version !== transitionVersion.current) return;
      await markStoredSessionRevoked(site, sid);
      if (version !== transitionVersion.current) return;
      await persistSessionId(sid);
      if (version !== transitionVersion.current) return;
      await clearStoredRevokedSession();
    });
  }, [queueStorage]);

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const version = transitionVersion.current;
        const [storedCompanyUrl, storedSessionId, revokedSession] = await Promise.all([
          loadStoredCompanyUrl(),
          loadStoredSessionId(),
          loadStoredRevokedSession(),
        ]);
        if (!isMounted || version !== transitionVersion.current) return;

        if (!storedCompanyUrl) {
          setAuthState("needsCompanyUrl");
          return;
        }

        setCompanyUrl(storedCompanyUrl);
        if (!storedSessionId) {
          setAuthState("signedOut");
          return;
        }

        if (revokedSession?.companyUrl === storedCompanyUrl &&
          revokedSession.sessionId === storedSessionId) {
          setAuthState("sessionExpired");
          const cleanup = Promise.allSettled([
            revokeStoredSession(storedCompanyUrl, storedSessionId),
            posCache.clearSession(storedCompanyUrl, storedSessionId),
          ]).then(() => undefined);
          pendingCleanup.current = cleanup;
          return;
        }

        const sessionStatus = await validateFrappeSession(
          storedCompanyUrl,
          storedSessionId,
        );
        if (!isMounted || version !== transitionVersion.current) return;

        if (sessionStatus === "expired") {
          setAuthState("sessionExpired");
          const cleanup = Promise.allSettled([
            revokeStoredSession(storedCompanyUrl, storedSessionId),
            posCache.clearSession(storedCompanyUrl, storedSessionId),
          ]).then(() => undefined);
          pendingCleanup.current = cleanup;
          await cleanup;
          if (!isMounted || version !== transitionVersion.current) return;
          activeSession.current = null;
          activeCompanyUrl.current = null;
          setSessionId(null);
          return;
        }

        // Do not treat a temporary offline failure as an expired session. Future feature
        // requests will redirect through invalidateSession when the server rejects the SID.
        activeSession.current = storedSessionId;
        activeCompanyUrl.current = storedCompanyUrl;
        posCache.allowSession(storedCompanyUrl, storedSessionId);
        setSessionId(storedSessionId);
        setAuthState("signedIn");
      } catch {
        if (isMounted && transitionVersion.current === 0) {
          setAuthState("needsCompanyUrl");
        }
      } finally {
        if (isMounted) {
          setIsBootstrapping(false);
        }
      }
    }

    void restoreSession();
    return () => {
      isMounted = false;
    };
  }, [revokeStoredSession]);

  const clearCompanyUrl = useCallback(async () => {
    ++transitionVersion.current;
    const departingSite = activeCompanyUrl.current;
    const departingSid = activeSession.current;
    activeSession.current = null;
    activeCompanyUrl.current = null;
    setSessionId(null);
    setPasswordResetKey(null);
    setCompanyUrl(null);
    setAuthState("needsCompanyUrl");
    await pendingCleanup.current;
    if (departingSite && departingSid) await revokeStoredSession(departingSite, departingSid);
    await Promise.all([queueStorage(clearStoredCompanyUrl), posCache.clearAll()]);
  }, [queueStorage, revokeStoredSession]);

  // This is intentionally narrower than signing out or changing company: it
  // removes only cached POS records, so the workspace address and session stay
  // available while the POS reloads its data.
  const clearLocalPosData = useCallback(async () => {
    if (activeCompanyUrl.current && activeSession.current) {
      await posCache.clearAccountData(activeCompanyUrl.current, activeSession.current);
    }
  }, []);

  const saveCompanyUrl = useCallback(
    async (rawUrl: string): Promise<SaveCompanyUrlResult> => {
      const normalized = normalizeCompanyUrl(rawUrl);
      if (!normalized.ok) {
        return normalized;
      }

      const version = ++transitionVersion.current;
      try {
        await verifyVunaPosSite(normalized.url);
        if (version !== transitionVersion.current) {
          return { ok: false, message: "Company setup was superseded. Try again." };
        }
        const isDifferentCompany = companyUrl !== normalized.url;
        if (!isDifferentCompany) return { ok: true };
        const departingSite = activeCompanyUrl.current;
        const departingSid = activeSession.current;
        activeSession.current = null;
        activeCompanyUrl.current = null;
        setSessionId(null);
        setPasswordResetKey(null);
        setAuthState("signedOut");
        await pendingCleanup.current;
        if (departingSite && departingSid) await revokeStoredSession(departingSite, departingSid);
        // The URL must not change while an old site's SID is still persisted:
        // a site-specific tombstone cannot guard that SID under the new URL.
        await queueStorage(clearStoredSession);
        await posCache.clearAll();
        await queueStorage(() => persistCompanyUrl(normalized.url));
        if (version !== transitionVersion.current) {
          return { ok: false, message: "Company setup was superseded. Try again." };
        }
        setCompanyUrl(normalized.url);
        setAuthState("signedOut");
        return { ok: true };
      } catch (error) {
        const message =
          error instanceof FrappeClientError
            ? error.message
            : "Could not save that company URL.";
        return { ok: false, message };
      }
    },
    [companyUrl, queueStorage, revokeStoredSession],
  );

  const signIn = useCallback(
    async (identifier: string, password: string): Promise<SignInResult> => {
      if (!companyUrl) {
        return {
          ok: false,
          message: "Set your company URL before signing in.",
        };
      }

      const version = ++transitionVersion.current;
      setPasswordResetKey(null);
      try {
        const nextSessionId = await signInToFrappe(
          companyUrl,
          identifier,
          password,
        );
        if (version !== transitionVersion.current) {
          return { ok: false, message: "This sign-in was superseded. Try again." };
        }
        await persistAuthenticatedSession(companyUrl, nextSessionId, version);
        if (version !== transitionVersion.current) {
          return { ok: false, message: "This sign-in was superseded. Try again." };
        }
        activeSession.current = nextSessionId;
        activeCompanyUrl.current = companyUrl;
        posCache.allowSession(companyUrl, nextSessionId);
        setSessionId(nextSessionId);
        setPasswordResetKey(null);
        setAuthState("signedIn");
        return { ok: true };
      } catch (error) {
        if (version !== transitionVersion.current) {
          return { ok: false, message: "This sign-in was superseded. Try again." };
        }
        if (error instanceof FrappePasswordResetRequiredError) {
          setPasswordResetKey(error.resetKey);
          return { ok: false, requiresPasswordReset: true };
        }
        const message =
          error instanceof FrappeClientError
            ? error.message
            : "Could not complete sign-in.";
        return { ok: false, message };
      }
    },
    [companyUrl, persistAuthenticatedSession],
  );

  const requestPasswordReset = useCallback(
    async (email: string): Promise<ActionResult> => {
      if (!companyUrl) {
        return {
          ok: false,
          message: "Set your company URL before resetting your password.",
        };
      }

      try {
        await requestFrappePasswordReset(companyUrl, email);
        return { ok: true };
      } catch (error) {
        const message =
          error instanceof FrappeClientError
            ? error.message
            : "Could not request a password reset.";
        return { ok: false, message };
      }
    },
    [companyUrl],
  );

  const completePasswordReset = useCallback(
    async (newPassword: string): Promise<ActionResult> => {
      if (!companyUrl || !passwordResetKey) {
        return {
          ok: false,
          message:
            "This password reset link is no longer available. Sign in again to request a new one.",
        };
      }

      const version = ++transitionVersion.current;
      try {
        const nextSessionId = await updateFrappePassword(
          companyUrl,
          passwordResetKey,
          newPassword,
        );
        if (version !== transitionVersion.current) {
          return { ok: false, message: "This password reset was superseded. Try again." };
        }
        await persistAuthenticatedSession(companyUrl, nextSessionId, version);
        if (version !== transitionVersion.current) {
          return { ok: false, message: "This password reset was superseded. Try again." };
        }
        activeSession.current = nextSessionId;
        activeCompanyUrl.current = companyUrl;
        posCache.allowSession(companyUrl, nextSessionId);
        setSessionId(nextSessionId);
        setPasswordResetKey(null);
        setAuthState("signedIn");
        return { ok: true };
      } catch (error) {
        if (version !== transitionVersion.current) {
          return { ok: false, message: "This password reset was superseded. Try again." };
        }
        const message =
          error instanceof FrappeClientError
            ? error.message
            : "Could not update your password.";
        return { ok: false, message };
      }
    },
    [companyUrl, passwordResetKey, persistAuthenticatedSession],
  );

  const signOut = useCallback((): Promise<void> => {
    ++transitionVersion.current;
    const departingSite = activeCompanyUrl.current;
    const departingSid = activeSession.current;
    activeSession.current = null;
    activeCompanyUrl.current = null;
    setSessionId(null);
    setPasswordResetKey(null);
    setAuthState(companyUrl ? "signedOut" : "needsCompanyUrl");
    const priorCleanup = pendingCleanup.current;
    const cleanup = (async () => {
      await priorCleanup;
      const results = await Promise.allSettled([
        departingSite && departingSid
          ? revokeStoredSession(departingSite, departingSid)
          : queueStorage(clearStoredSession),
        departingSite && departingSid
          ? posCache.clearSession(departingSite, departingSid)
          : Promise.resolve(),
      ]);
      if (results.some((result) => result.status === "rejected")) {
        console.warn("Could not fully clear local POS data after sign-out.");
      }
    })();
    pendingCleanup.current = cleanup;
    void cleanup.then(() => {
      if (pendingCleanup.current === cleanup) pendingCleanup.current = null;
    });
    return cleanup;
  }, [companyUrl, queueStorage, revokeStoredSession]);

  const invalidateSession = useCallback((
    rejectedSessionId: string | null = sessionId,
    rejectedCompanyUrl: string | null = companyUrl,
  ): Promise<void> => {
    if (!rejectedSessionId || !rejectedCompanyUrl) return Promise.resolve();
    if (invalidation.current?.sessionId === rejectedSessionId &&
      invalidation.current.companyUrl === rejectedCompanyUrl) {
      return invalidation.current.promise;
    }
    // A late response from another SID or site must not clear a newer login.
    if (activeSession.current !== rejectedSessionId ||
      activeCompanyUrl.current !== rejectedCompanyUrl) return Promise.resolve();
    ++transitionVersion.current;
    activeSession.current = null;
    activeCompanyUrl.current = null;
    setSessionId(null);
    setPasswordResetKey(null);
    setAuthState("sessionExpired");
    const promise = (async () => {
      const cleanup = await Promise.allSettled([
        revokeStoredSession(rejectedCompanyUrl, rejectedSessionId),
        posCache.clearSession(rejectedCompanyUrl, rejectedSessionId),
      ]);
      if (cleanup.some((result) => result.status === "rejected")) {
        // Local cleanup failure cannot restore a session Frappe has rejected.
        console.warn("Could not fully clear local POS data after session expiry.");
      }
    })();
    invalidation.current = { companyUrl: rejectedCompanyUrl, sessionId: rejectedSessionId, promise };
    pendingCleanup.current = promise;
    void promise.then(
      () => {
        if (invalidation.current?.promise === promise) invalidation.current = null;
        if (pendingCleanup.current === promise) pendingCleanup.current = null;
      },
      () => {
        if (invalidation.current?.promise === promise) invalidation.current = null;
        if (pendingCleanup.current === promise) pendingCleanup.current = null;
      },
    );
    return promise;
  }, [companyUrl, revokeStoredSession, sessionId]);

  useEffect(() => subscribeToFrappeSessionExpiry((site, sid) => {
    void invalidateSession(sid, site);
  }), [invalidateSession]);

  const value = useMemo(
    () => ({
      authState,
      clearCompanyUrl,
      clearLocalPosData,
      companyUrl,
      completePasswordReset,
      hasPendingPasswordReset: Boolean(passwordResetKey),
      invalidateSession,
      isBootstrapping,
      saveCompanyUrl,
      sessionId,
      signIn,
      requestPasswordReset,
      signOut,
    }),
    [
      authState,
      clearCompanyUrl,
      clearLocalPosData,
      companyUrl,
      completePasswordReset,
      invalidateSession,
      isBootstrapping,
      passwordResetKey,
      requestPasswordReset,
      saveCompanyUrl,
      sessionId,
      signIn,
      signOut,
    ],
  );

  return (
    <AppSessionContext.Provider value={value}>
      {children}
    </AppSessionContext.Provider>
  );
}

export function useAppSession() {
  const context = useContext(AppSessionContext);
  if (!context) {
    throw new Error("useAppSession must be used inside AppSessionProvider.");
  }
  return context;
}
