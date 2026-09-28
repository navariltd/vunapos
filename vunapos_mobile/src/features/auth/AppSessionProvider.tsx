import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { normalizeCompanyUrl } from "@/config/companyUrl";
import {
  FrappeClientError,
  FrappePasswordResetRequiredError,
  requestFrappePasswordReset,
  signInToFrappe,
  updateFrappePassword,
  validateFrappeSession,
  verifyVunaPosSite,
} from "@/services/frappeClient";
import {
  clearStoredCompanyUrl,
  clearStoredSession,
  loadStoredCompanyUrl,
  loadStoredSessionId,
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
  invalidateSession: () => Promise<void>;
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

  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const [storedCompanyUrl, storedSessionId] = await Promise.all([
          loadStoredCompanyUrl(),
          loadStoredSessionId(),
        ]);
        if (!isMounted) return;

        if (!storedCompanyUrl) {
          setAuthState("needsCompanyUrl");
          return;
        }

        setCompanyUrl(storedCompanyUrl);
        if (!storedSessionId) {
          setAuthState("signedOut");
          return;
        }

        const sessionStatus = await validateFrappeSession(
          storedCompanyUrl,
          storedSessionId,
        );
        if (!isMounted) return;

        if (sessionStatus === "expired") {
          await Promise.all([clearStoredSession(), posCache.clearAll()]);
          setSessionId(null);
          setAuthState("sessionExpired");
          return;
        }

        // Do not treat a temporary offline failure as an expired session. Future feature
        // requests will redirect through invalidateSession when the server rejects the SID.
        setSessionId(storedSessionId);
        setAuthState("signedIn");
      } catch {
        if (isMounted) {
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
  }, []);

  const clearCompanyUrl = useCallback(async () => {
    await Promise.all([clearStoredCompanyUrl(), posCache.clearAll()]);
    setSessionId(null);
    setPasswordResetKey(null);
    setCompanyUrl(null);
    setAuthState("needsCompanyUrl");
  }, []);

  // This is intentionally narrower than signing out or changing company: it
  // removes only cached POS records, so the workspace address and session stay
  // available while the POS reloads its data.
  const clearLocalPosData = useCallback(async () => {
    await posCache.clearAll();
  }, []);

  const saveCompanyUrl = useCallback(
    async (rawUrl: string): Promise<SaveCompanyUrlResult> => {
      const normalized = normalizeCompanyUrl(rawUrl);
      if (!normalized.ok) {
        return normalized;
      }

      try {
        await verifyVunaPosSite(normalized.url);
        const isDifferentCompany = companyUrl !== normalized.url;
        if (isDifferentCompany) {
          await Promise.all([clearStoredSession(), posCache.clearAll()]);
          setSessionId(null);
          setPasswordResetKey(null);
        }
        await persistCompanyUrl(normalized.url);
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
    [companyUrl],
  );

  const signIn = useCallback(
    async (identifier: string, password: string): Promise<SignInResult> => {
      if (!companyUrl) {
        return {
          ok: false,
          message: "Set your company URL before signing in.",
        };
      }

      setPasswordResetKey(null);
      try {
        const sessionId = await signInToFrappe(
          companyUrl,
          identifier,
          password,
        );
        await persistSessionId(sessionId);
        setSessionId(sessionId);
        setPasswordResetKey(null);
        setAuthState("signedIn");
        return { ok: true };
      } catch (error) {
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
    [companyUrl],
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

      try {
        const nextSessionId = await updateFrappePassword(
          companyUrl,
          passwordResetKey,
          newPassword,
        );
        await persistSessionId(nextSessionId);
        setSessionId(nextSessionId);
        setPasswordResetKey(null);
        setAuthState("signedIn");
        return { ok: true };
      } catch (error) {
        const message =
          error instanceof FrappeClientError
            ? error.message
            : "Could not update your password.";
        return { ok: false, message };
      }
    },
    [companyUrl, passwordResetKey],
  );

  const signOut = useCallback(async () => {
    await Promise.all([clearStoredSession(), posCache.clearAll()]);
    setSessionId(null);
    setPasswordResetKey(null);
    setAuthState(companyUrl ? "signedOut" : "needsCompanyUrl");
  }, [companyUrl]);

  const invalidateSession = useCallback(async () => {
    await Promise.all([clearStoredSession(), posCache.clearAll()]);
    setSessionId(null);
    setPasswordResetKey(null);
    setAuthState(companyUrl ? "sessionExpired" : "needsCompanyUrl");
  }, [companyUrl]);

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
