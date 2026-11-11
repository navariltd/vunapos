import { PropsWithChildren } from "react";
import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/services/sessionStore", () => ({
  clearStoredCompanyUrl: jest.fn(),
  clearStoredSession: jest.fn(),
  clearStoredRevokedSession: jest.fn(),
  loadStoredCompanyUrl: jest.fn(),
  loadStoredRevokedSession: jest.fn(),
  loadStoredSessionId: jest.fn(),
  markStoredSessionRevoked: jest.fn(),
  persistCompanyUrl: jest.fn(),
  persistSessionId: jest.fn(),
}));

jest.mock("@/services/frappeClient", () => {
  const actual = jest.requireActual("@/services/frappeClient");
  return {
    ...actual,
    requestFrappePasswordReset: jest.fn(),
    signInToFrappe: jest.fn(),
    updateFrappePassword: jest.fn(),
    validateFrappeSession: jest.fn(),
    verifyVunaPosSite: jest.fn(),
  };
});

jest.mock("@/services/posCache", () => ({
  posCache: { clearAll: jest.fn(), clearSession: jest.fn(), clearAccountData: jest.fn(), allowSession: jest.fn() },
}));

import {
  AppSessionProvider,
  useAppSession,
} from "@/features/auth/AppSessionProvider";
import {
  FrappeClientError,
  FrappePasswordResetRequiredError,
  getVunaMethod,
  requestFrappePasswordReset,
  signInToFrappe,
  updateFrappePassword,
  validateFrappeSession,
  verifyVunaPosSite,
} from "@/services/frappeClient";
import { posCache } from "@/services/posCache";
import {
  clearStoredCompanyUrl,
  clearStoredSession,
  loadStoredRevokedSession,
  loadStoredCompanyUrl,
  loadStoredSessionId,
  persistCompanyUrl,
  persistSessionId,
} from "@/services/sessionStore";

const sessionStore = {
  clearStoredCompanyUrl: jest.mocked(clearStoredCompanyUrl),
  clearStoredSession: jest.mocked(clearStoredSession),
  loadStoredCompanyUrl: jest.mocked(loadStoredCompanyUrl),
  loadStoredSessionId: jest.mocked(loadStoredSessionId),
  persistCompanyUrl: jest.mocked(persistCompanyUrl),
  persistSessionId: jest.mocked(persistSessionId),
};
const frappeClient = {
  requestFrappePasswordReset: jest.mocked(requestFrappePasswordReset),
  signInToFrappe: jest.mocked(signInToFrappe),
  updateFrappePassword: jest.mocked(updateFrappePassword),
  validateFrappeSession: jest.mocked(validateFrappeSession),
  verifyVunaPosSite: jest.mocked(verifyVunaPosSite),
};

function wrapper({ children }: PropsWithChildren) {
  return <AppSessionProvider>{children}</AppSessionProvider>;
}

async function renderSession() {
  const session = await renderHook(() => useAppSession(), { wrapper });
  await waitFor(() =>
    expect(session.result.current.isBootstrapping).toBe(false),
  );
  return session;
}

describe("AppSessionProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(loadStoredRevokedSession).mockResolvedValue(null);
    sessionStore.loadStoredCompanyUrl.mockResolvedValue(null);
    sessionStore.loadStoredSessionId.mockResolvedValue(null);
    frappeClient.validateFrappeSession.mockResolvedValue("valid");
  });

  it("starts at company setup when this device has no saved company URL", async () => {
    const session = await renderSession();

    expect(session.result.current.authState).toBe("needsCompanyUrl");
    expect(session.result.current.companyUrl).toBeNull();
    expect(session.result.current.sessionId).toBeNull();
  });

  it("fails safely to company setup when stored authentication data cannot be read", async () => {
    sessionStore.loadStoredCompanyUrl.mockRejectedValue(
      new Error("storage unavailable"),
    );

    const session = await renderSession();

    expect(session.result.current.authState).toBe("needsCompanyUrl");
    expect(session.result.current.isBootstrapping).toBe(false);
  });

  it("shows sign-in when a company URL exists without a saved session", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue(
      "https://vuna.example.com",
    );

    const session = await renderSession();

    expect(session.result.current).toMatchObject({
      authState: "signedOut",
      companyUrl: "https://vuna.example.com",
      sessionId: null,
    });
    expect(frappeClient.validateFrappeSession).not.toHaveBeenCalled();
  });

  it("restores a valid saved session and retains it when the server is temporarily unavailable", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue(
      "https://vuna.example.com",
    );
    sessionStore.loadStoredSessionId.mockResolvedValue("sid-1");
    frappeClient.validateFrappeSession.mockResolvedValue("unavailable");

    const session = await renderSession();

    expect(session.result.current.authState).toBe("signedIn");
    expect(session.result.current.companyUrl).toBe("https://vuna.example.com");
    expect(session.result.current.sessionId).toBe("sid-1");
    expect(sessionStore.clearStoredSession).not.toHaveBeenCalled();
  });

  it("clears an expired saved session and requires sign-in again", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue(
      "https://vuna.example.com",
    );
    sessionStore.loadStoredSessionId.mockResolvedValue("sid-1");
    frappeClient.validateFrappeSession.mockResolvedValue("expired");

    const session = await renderSession();

    expect(session.result.current.authState).toBe("sessionExpired");
    expect(session.result.current.sessionId).toBeNull();
    expect(sessionStore.clearStoredSession).toHaveBeenCalledTimes(1);
    expect(posCache.clearSession).toHaveBeenCalledWith("https://vuna.example.com", "sid-1");
  });

  it("saves a verified company URL and clears a previous company session", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue(
      "https://old.example.com",
    );
    sessionStore.loadStoredSessionId.mockResolvedValue("old-sid");

    const session = await renderSession();
    let result:
      | Awaited<ReturnType<typeof session.result.current.saveCompanyUrl>>
      | undefined;
    await act(async () => {
      result = await session.result.current.saveCompanyUrl("vuna.example.com");
    });

    expect(result).toEqual({ ok: true });
    expect(frappeClient.verifyVunaPosSite).toHaveBeenCalledWith(
      "https://vuna.example.com",
    );
    expect(sessionStore.clearStoredSession).toHaveBeenCalled();
    expect(posCache.clearAll).toHaveBeenCalledTimes(1);
    expect(sessionStore.persistCompanyUrl).toHaveBeenCalledWith(
      "https://vuna.example.com",
    );
    expect(session.result.current).toMatchObject({
      authState: "signedOut",
      companyUrl: "https://vuna.example.com",
      sessionId: null,
    });
  });

  it("does not save an unverified company URL", async () => {
    frappeClient.verifyVunaPosSite.mockRejectedValue(
      new FrappeClientError(
        "That address did not respond as a VunaPOS site.",
        "connection",
      ),
    );

    const session = await renderSession();
    let result:
      | Awaited<ReturnType<typeof session.result.current.saveCompanyUrl>>
      | undefined;
    await act(async () => {
      result = await session.result.current.saveCompanyUrl("vuna.example.com");
    });

    expect(result).toEqual({
      ok: false,
      message: "That address did not respond as a VunaPOS site.",
    });
    expect(sessionStore.persistCompanyUrl).not.toHaveBeenCalled();
    expect(session.result.current.authState).toBe("needsCompanyUrl");
  });

  it("keeps an existing session when the verified company URL is unchanged", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue(
      "https://vuna.example.com",
    );
    sessionStore.loadStoredSessionId.mockResolvedValue("sid-1");

    const session = await renderSession();
    await act(async () => {
      await session.result.current.saveCompanyUrl("vuna.example.com");
    });

    expect(sessionStore.clearStoredSession).not.toHaveBeenCalled();
    expect(session.result.current.sessionId).toBe("sid-1");
  });

  it("does not bind an old persisted SID to a different company URL if deletion fails", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    sessionStore.loadStoredCompanyUrl.mockResolvedValue("https://old.example.com");
    sessionStore.loadStoredSessionId.mockResolvedValue("old-sid");
    sessionStore.clearStoredSession
      .mockRejectedValueOnce(new Error("SecureStore unavailable"))
      .mockRejectedValueOnce(new Error("SecureStore unavailable"));
    const session = await renderSession();
    frappeClient.verifyVunaPosSite.mockResolvedValue(undefined);
    let result: Awaited<ReturnType<typeof session.result.current.saveCompanyUrl>> | undefined;

    await act(async () => { result = await session.result.current.saveCompanyUrl("https://new.example.com"); });

    expect(result).toMatchObject({ ok: false });
    expect(sessionStore.persistCompanyUrl).not.toHaveBeenCalledWith("https://new.example.com");
    expect(session.result.current.sessionId).toBeNull();
    warning.mockRestore();
  });

  it("persists a successful sign-in and supports sign-out and explicit session invalidation", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue(
      "https://vuna.example.com",
    );
    frappeClient.signInToFrappe.mockResolvedValue("new-sid");

    const session = await renderSession();
    let signInResult:
      Awaited<ReturnType<typeof session.result.current.signIn>> | undefined;
    await act(async () => {
      signInResult = await session.result.current.signIn("cashier", "secret");
    });

    expect(signInResult).toEqual({ ok: true });
    expect(frappeClient.signInToFrappe).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "cashier",
      "secret",
    );
    expect(sessionStore.persistSessionId).toHaveBeenCalledWith("new-sid");
    expect(session.result.current.authState).toBe("signedIn");

    await act(async () => {
      await session.result.current.signOut();
    });
    expect(session.result.current.authState).toBe("signedOut");

    await act(async () => {
      await session.result.current.invalidateSession();
    });
    expect(session.result.current.authState).toBe("signedOut");
    expect(sessionStore.clearStoredSession).toHaveBeenCalled();
    expect(posCache.clearSession).toHaveBeenCalledWith("https://vuna.example.com", "new-sid");
  });

  it("coalesces simultaneous expiry reports for the same session", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue("https://vuna.example.com");
    sessionStore.loadStoredSessionId.mockResolvedValue("sid-1");
    const session = await renderSession();
    const invalidate = session.result.current.invalidateSession;

    await act(async () => {
      await Promise.all([invalidate(), invalidate()]);
    });

    expect(session.result.current.authState).toBe("sessionExpired");
    expect(sessionStore.clearStoredSession).toHaveBeenCalledTimes(1);
    expect(posCache.clearSession).toHaveBeenCalledWith("https://vuna.example.com", "sid-1");
  });

  it("removes an expired session from the screen before slow storage cleanup completes", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue("https://vuna.example.com");
    sessionStore.loadStoredSessionId.mockResolvedValue("sid-1");
    let finishCleanup!: () => void;
    sessionStore.clearStoredSession.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishCleanup = resolve;
    }));
    const session = await renderSession();
    let cleanup!: Promise<void>;

    await act(async () => { cleanup = session.result.current.invalidateSession(); });
    expect(session.result.current.authState).toBe("sessionExpired");
    expect(session.result.current.sessionId).toBeNull();

    await act(async () => { finishCleanup(); await cleanup; });
  });

  it("never restores a locally revoked SID during an offline restart", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue("https://vuna.example.com");
    sessionStore.loadStoredSessionId.mockResolvedValue("revoked-sid");
    jest.mocked(loadStoredRevokedSession).mockResolvedValue({
      companyUrl: "https://vuna.example.com", sessionId: "revoked-sid",
    });
    frappeClient.validateFrappeSession.mockResolvedValue("unavailable");

    const session = await renderSession();
    expect(session.result.current.authState).toBe("sessionExpired");
    expect(session.result.current.sessionId).toBeNull();
    expect(frappeClient.validateFrappeSession).not.toHaveBeenCalled();
  });

  it("waits for an old SID deletion before persisting a new sign-in", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue("https://vuna.example.com");
    sessionStore.loadStoredSessionId.mockResolvedValue("old-sid");
    frappeClient.signInToFrappe.mockResolvedValue("new-sid");
    let finishDeletion!: () => void;
    sessionStore.clearStoredSession.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishDeletion = resolve;
    }));
    const session = await renderSession();
    let cleanup!: Promise<void>;
    let login!: Promise<unknown>;

    await act(async () => { cleanup = session.result.current.invalidateSession(); });
    await act(async () => { login = session.result.current.signIn("cashier", "password"); });
    expect(sessionStore.persistSessionId).not.toHaveBeenCalled();

    await act(async () => { finishDeletion(); await cleanup; await login; });
    expect(sessionStore.persistSessionId).toHaveBeenCalledWith("new-sid");
    expect(session.result.current.sessionId).toBe("new-sid");
  });

  it("hides the workspace immediately when sign-out cleanup is slow", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue("https://vuna.example.com");
    sessionStore.loadStoredSessionId.mockResolvedValue("sid-1");
    let finishDeletion!: () => void;
    sessionStore.clearStoredSession.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishDeletion = resolve;
    }));
    const session = await renderSession();
    let cleanup!: Promise<void>;

    await act(async () => { cleanup = session.result.current.signOut(); });
    expect(session.result.current.authState).toBe("signedOut");
    expect(session.result.current.sessionId).toBeNull();

    await act(async () => { finishDeletion(); await cleanup; });
  });

  it("does not let a delayed first sign-in replace a newer one", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue("https://vuna.example.com");
    let resolveFirst!: (sid: string) => void;
    frappeClient.signInToFrappe
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce("sid-new");
    const session = await renderSession();
    let oldLogin!: Promise<unknown>;
    await act(async () => { oldLogin = session.result.current.signIn("first", "password"); });
    await act(async () => { await session.result.current.signIn("second", "password"); });
    await act(async () => { resolveFirst("sid-old"); await oldLogin; });

    expect(session.result.current.sessionId).toBe("sid-new");
    expect(sessionStore.persistSessionId).toHaveBeenCalledWith("sid-new");
    expect(sessionStore.persistSessionId).not.toHaveBeenCalledWith("sid-old");
  });

  it("ignores an API expiry reported for another company site", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue("https://vuna.example.com");
    sessionStore.loadStoredSessionId.mockResolvedValue("sid-1");
    const session = await renderSession();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => JSON.stringify({ exc_type: "AuthenticationError" }),
    }) as typeof fetch;
    try {
      await act(async () => {
        await expect(getVunaMethod("https://other.example.com", "sid-1", "method"))
          .rejects.toMatchObject({ code: "session" });
      });
      expect(session.result.current.authState).toBe("signedIn");
      expect(session.result.current.sessionId).toBe("sid-1");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("expires immediately when a protected API returns a confirmed 401", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue("https://vuna.example.com");
    sessionStore.loadStoredSessionId.mockResolvedValue("sid-1");
    const session = await renderSession();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => JSON.stringify({ exc_type: "AuthenticationError" }),
    }) as typeof fetch;
    try {
      await act(async () => {
        await expect(getVunaMethod("https://vuna.example.com", "sid-1", "method"))
          .rejects.toMatchObject({ code: "session" });
      });
      expect(session.result.current.authState).toBe("sessionExpired");
      expect(session.result.current.sessionId).toBeNull();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("does not expire an authenticated session for a proxy's HTML 401", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue("https://vuna.example.com");
    sessionStore.loadStoredSessionId.mockResolvedValue("sid-1");
    const session = await renderSession();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => "<html>Proxy authentication failed</html>",
    }) as typeof fetch;
    try {
      await act(async () => {
        await expect(getVunaMethod("https://vuna.example.com", "sid-1", "method"))
          .rejects.toMatchObject({ code: "INVALID_SERVER_RESPONSE" });
      });
      expect(session.result.current.authState).toBe("signedIn");
      expect(session.result.current.sessionId).toBe("sid-1");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("ignores an old protected request after a different session signs in", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue("https://vuna.example.com");
    sessionStore.loadStoredSessionId.mockResolvedValue("sid-1");
    frappeClient.signInToFrappe.mockResolvedValue("sid-2");
    const session = await renderSession();
    const oldInvalidate = session.result.current.invalidateSession;

    await act(async () => { await session.result.current.signOut(); });
    await act(async () => { await session.result.current.signIn("cashier-2", "secret"); });
    await act(async () => { await oldInvalidate(); });

    expect(session.result.current.authState).toBe("signedIn");
    expect(session.result.current.sessionId).toBe("sid-2");
    expect(sessionStore.clearStoredSession).toHaveBeenCalled();
  });

  it("blocks an expired session even if local cache cleanup fails", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    sessionStore.loadStoredCompanyUrl.mockResolvedValue("https://vuna.example.com");
    sessionStore.loadStoredSessionId.mockResolvedValue("sid-1");
    jest.mocked(posCache.clearSession).mockRejectedValueOnce(new Error("SQLite unavailable"));
    const session = await renderSession();

    await act(async () => { await session.result.current.invalidateSession(); });

    expect(session.result.current.authState).toBe("sessionExpired");
    expect(session.result.current.sessionId).toBeNull();
    expect(sessionStore.clearStoredSession).toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith("Could not fully clear local POS data after session expiry.");
    warning.mockRestore();
  });

  it("keeps the user signed out when Frappe rejects their sign-in", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue(
      "https://vuna.example.com",
    );
    frappeClient.signInToFrappe.mockRejectedValue(
      new FrappeClientError(
        "Sign-in failed. Check your details and try again.",
        "login",
      ),
    );

    const session = await renderSession();
    let signInResult:
      Awaited<ReturnType<typeof session.result.current.signIn>> | undefined;
    await act(async () => {
      signInResult = await session.result.current.signIn(
        "cashier",
        "wrong-password",
      );
    });

    expect(signInResult).toEqual({
      ok: false,
      message: "Sign-in failed. Check your details and try again.",
    });
    expect(sessionStore.persistSessionId).not.toHaveBeenCalled();
    expect(session.result.current.authState).toBe("signedOut");
  });

  it("keeps the reset key only in memory and signs in after Frappe accepts a new password", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue(
      "https://vuna.example.com",
    );
    frappeClient.signInToFrappe.mockRejectedValue(
      new FrappePasswordResetRequiredError("one-time-key"),
    );
    frappeClient.updateFrappePassword.mockResolvedValue("fresh-sid");

    const session = await renderSession();
    let signInResult:
      Awaited<ReturnType<typeof session.result.current.signIn>> | undefined;
    await act(async () => {
      signInResult = await session.result.current.signIn(
        "cashier",
        "expired-password",
      );
    });

    expect(signInResult).toEqual({ ok: false, requiresPasswordReset: true });
    expect(session.result.current.hasPendingPasswordReset).toBe(true);
    expect(session.result.current.sessionId).toBeNull();

    let resetResult:
      | Awaited<ReturnType<typeof session.result.current.completePasswordReset>>
      | undefined;
    await act(async () => {
      resetResult =
        await session.result.current.completePasswordReset("new-password");
    });

    expect(resetResult).toEqual({ ok: true });
    expect(frappeClient.updateFrappePassword).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "one-time-key",
      "new-password",
    );
    expect(sessionStore.persistSessionId).toHaveBeenCalledWith("fresh-sid");
    expect(session.result.current).toMatchObject({
      authState: "signedIn",
      hasPendingPasswordReset: false,
      sessionId: "fresh-sid",
    });
  });

  it("requests a generic password-reset email without changing the local session", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue(
      "https://vuna.example.com",
    );
    frappeClient.requestFrappePasswordReset.mockResolvedValue(undefined);

    const session = await renderSession();
    let result:
      | Awaited<ReturnType<typeof session.result.current.requestPasswordReset>>
      | undefined;
    await act(async () => {
      result = await session.result.current.requestPasswordReset(
        "cashier@example.com",
      );
    });

    expect(result).toEqual({ ok: true });
    expect(frappeClient.requestFrappePasswordReset).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "cashier@example.com",
    );
    expect(session.result.current.authState).toBe("signedOut");
  });

  it("clears all local authentication data when the company URL is removed", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue(
      "https://vuna.example.com",
    );
    const session = await renderSession();

    await act(async () => {
      await session.result.current.clearCompanyUrl();
    });

    expect(sessionStore.clearStoredCompanyUrl).toHaveBeenCalledTimes(1);
    expect(posCache.clearAll).toHaveBeenCalledTimes(1);
    expect(session.result.current).toMatchObject({
      authState: "needsCompanyUrl",
      companyUrl: null,
      sessionId: null,
    });
  });

  it("clears saved POS data without changing the workspace URL or session", async () => {
    sessionStore.loadStoredCompanyUrl.mockResolvedValue(
      "https://vuna.example.com",
    );
    sessionStore.loadStoredSessionId.mockResolvedValue("sid-1");
    const session = await renderSession();

    await act(async () => {
      await session.result.current.clearLocalPosData();
    });

    expect(posCache.clearAccountData).toHaveBeenCalledWith("https://vuna.example.com", "sid-1");
    expect(sessionStore.clearStoredCompanyUrl).not.toHaveBeenCalled();
    expect(sessionStore.clearStoredSession).not.toHaveBeenCalled();
    expect(session.result.current).toMatchObject({
      authState: "signedIn",
      companyUrl: "https://vuna.example.com",
      sessionId: "sid-1",
    });
  });
});
