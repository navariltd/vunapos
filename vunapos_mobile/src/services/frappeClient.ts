import { normalizeCompanyUrl } from "@/config/companyUrl";

type FrappeMessage = {
  message?: {
    ok?: boolean;
  };
};

type FrappeLoginResponse = {
  message?: string;
  redirect_to?: string;
};

type FrappeErrorResponse = {
  _server_messages?: string;
  message?: unknown;
  exception?: string;
  exc_type?: string;
};

type VunaEnvelope<T> = {
  data: T;
  errors?: { message?: string }[];
  ok: boolean;
};

type VunaMethodParams = Record<
  string,
  boolean | number | string | null | undefined
>;
type FrappeJsonMethodParams = Record<string, unknown>;

export class FrappeClientError extends Error {
  constructor(
    message: string,
    readonly code: "api" | "connection" | "login" | "session",
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Frappe has verified the supplied credentials, but requires a password
 * change before it will create a session. The reset key is a short-lived
 * bearer credential and must remain in memory only.
 */
export class FrappePasswordResetRequiredError extends FrappeClientError {
  constructor(readonly resetKey: string) {
    super(
      "Your password has expired. Set a new password to continue.",
      "login",
    );
  }
}

function requestUrl(companyUrl: string, path: string) {
  return `${companyUrl}${path}`;
}

function getMethodUrl(
  companyUrl: string,
  method: string,
  params: VunaMethodParams,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  }

  const baseUrl = requestUrl(companyUrl, `/api/method/${method}`);
  const queryString = query.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

function getSessionId(response: Response): string | undefined {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headers.getSetCookie?.() ?? [
    headers.get("set-cookie") ?? "",
  ];

  for (const setCookie of setCookies) {
    const match = /(?:^|,\s*)sid=([^;,\s]+)/.exec(setCookie);
    if (match?.[1]) {
      try {
        const sid = decodeURIComponent(match[1]);
        if (!/[\r\n]/.test(sid)) {
          return sid;
        }
      } catch {
        // Ignore a malformed cookie value rather than putting it in a request header.
      }
    }
  }
}

function getResetKey(redirectTo: unknown): string | undefined {
  if (typeof redirectTo !== "string") return;

  try {
    const url = new URL(redirectTo, "https://vunapos.invalid");
    if (url.pathname !== "/update-password") return;

    const key = url.searchParams.get("key");
    if (!key || key.length > 1024 || /[\r\n]/.test(key)) return;
    return key;
  } catch {
    return;
  }
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
  } catch {
    return;
  }
}

function cleanFrappeMessage(value: string) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .trim();
}

function messageFromValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim())
    return cleanFrappeMessage(value);
  if (!value || typeof value !== "object") return;
  const message = (value as { message?: unknown }).message;
  return messageFromValue(message);
}

/** Extracts the useful, user-facing message from Frappe's error variants. */
function getFrappeErrorMessage(payload: FrappeErrorResponse | undefined) {
  const directMessage = messageFromValue(payload?.message);
  if (directMessage) return directMessage;

  if (payload?._server_messages) {
    try {
      const messages = JSON.parse(payload._server_messages) as unknown;
      if (Array.isArray(messages)) {
        for (const candidate of messages) {
          let parsedCandidate: unknown = candidate;
          if (typeof candidate === "string") {
            try {
              parsedCandidate = JSON.parse(candidate);
            } catch {
              // Keep the original text as a fallback.
            }
          }
          const message = messageFromValue(parsedCandidate);
          if (message) return message;
        }
      }
    } catch {
      // Continue to Frappe's exception fallback below.
    }
  }

  const exception = payload?.exception;
  if (typeof exception === "string" && exception.trim()) {
    const withoutType = exception.replace(/^[^:]+:\s*/, "");
    return cleanFrappeMessage(withoutType);
  }
}

export async function verifyVunaPosSite(companyUrl: string): Promise<void> {
  try {
    const response = await fetch(
      requestUrl(companyUrl, "/api/method/vunapos.api.pos.ping"),
      {
        headers: { Accept: "application/json" },
        method: "GET",
      },
    );
    if (!response.ok) {
      throw new FrappeClientError(
        "That address did not respond as a VunaPOS site.",
        "connection",
      );
    }

    const payload = (await response.json()) as FrappeMessage;
    if (payload.message?.ok !== true) {
      throw new FrappeClientError(
        "That address did not respond as a VunaPOS site.",
        "connection",
      );
    }
  } catch (error) {
    if (error instanceof FrappeClientError) {
      throw error;
    }
    throw new FrappeClientError(
      "Could not reach that address. Check the URL and your connection.",
      "connection",
    );
  }
}

export async function signInToFrappe(
  companyUrl: string,
  identifier: string,
  password: string,
): Promise<string> {
  const normalized = normalizeCompanyUrl(companyUrl);
  if (!normalized.ok) {
    throw new FrappeClientError(
      "Set a valid company URL before signing in.",
      "connection",
    );
  }

  try {
    const response = await fetch(
      requestUrl(normalized.url, "/api/method/login"),
      {
        body: new URLSearchParams({
          usr: identifier.trim(),
          pwd: password,
        }).toString(),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        method: "POST",
      },
    );

    if (!response.ok) {
      throw new FrappeClientError(
        "Sign-in failed. Check your details and try again.",
        "login",
      );
    }

    const payload = await readJson<FrappeLoginResponse>(response);
    if (payload?.message === "Password Reset") {
      const resetKey = getResetKey(payload.redirect_to);
      if (resetKey) {
        throw new FrappePasswordResetRequiredError(resetKey);
      }
      throw new FrappeClientError(
        "Your password has expired. Reset it from the company sign-in page, then try again.",
        "login",
      );
    }

    const sessionId = getSessionId(response);
    if (!sessionId) {
      throw new FrappeClientError(
        "Frappe did not create a session. Complete any additional sign-in verification and try again.",
        "login",
      );
    }

    return sessionId;
  } catch (error) {
    if (error instanceof FrappeClientError) {
      throw error;
    }
    throw new FrappeClientError(
      "Could not reach your company site. Check your connection and try again.",
      "connection",
    );
  }
}

export async function requestFrappePasswordReset(
  companyUrl: string,
  email: string,
): Promise<void> {
  const normalized = normalizeCompanyUrl(companyUrl);
  if (!normalized.ok) {
    throw new FrappeClientError(
      "Set a valid company URL before resetting your password.",
      "connection",
    );
  }

  try {
    const response = await fetch(
      requestUrl(
        normalized.url,
        "/api/method/frappe.core.doctype.user.user.reset_password",
      ),
      {
        body: new URLSearchParams({ user: email.trim() }).toString(),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        method: "POST",
      },
    );

    if (!response.ok) {
      throw new FrappeClientError(
        "Could not request a password reset. Check your connection and try again.",
        "login",
      );
    }
  } catch (error) {
    if (error instanceof FrappeClientError) throw error;
    throw new FrappeClientError(
      "Could not reach your company site. Check your connection and try again.",
      "connection",
    );
  }
}

export async function updateFrappePassword(
  companyUrl: string,
  resetKey: string,
  newPassword: string,
): Promise<string> {
  const normalized = normalizeCompanyUrl(companyUrl);
  if (!normalized.ok) {
    throw new FrappeClientError(
      "Set a valid company URL before updating your password.",
      "connection",
    );
  }

  try {
    const response = await fetch(
      requestUrl(
        normalized.url,
        "/api/method/frappe.core.doctype.user.user.update_password",
      ),
      {
        body: new URLSearchParams({
          key: resetKey,
          logout_all_sessions: "1",
          new_password: newPassword,
        }).toString(),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        method: "POST",
      },
    );
    const payload = await readJson<FrappeErrorResponse>(response);

    if (!response.ok) {
      throw new FrappeClientError(
        getFrappeErrorMessage(payload) ??
          "Could not update your password. Request another reset link and try again.",
        "login",
      );
    }

    const sessionId = getSessionId(response);
    if (!sessionId) {
      throw new FrappeClientError(
        "Your password was updated, but Frappe did not create a session. Sign in with your new password.",
        "login",
      );
    }

    return sessionId;
  } catch (error) {
    if (error instanceof FrappeClientError) throw error;
    throw new FrappeClientError(
      "Could not reach your company site. Check your connection and try again.",
      "connection",
    );
  }
}

export async function validateFrappeSession(
  companyUrl: string,
  sessionId: string,
): Promise<"valid" | "expired" | "unavailable"> {
  try {
    const response = await fetch(
      requestUrl(companyUrl, "/api/method/vunapos.api.auth.get_csrf_token"),
      {
        headers: {
          Accept: "application/json",
          Cookie: `sid=${encodeURIComponent(sessionId)}`,
        },
        method: "GET",
      },
    );
    if (response.status === 401 || response.status === 403) {
      return "expired";
    }
    return response.ok ? "valid" : "unavailable";
  } catch {
    return "unavailable";
  }
}

/**
 * Calls a VunaPOS GET endpoint using the saved Frappe session. API failures
 * remain distinguishable from connectivity and expired-session failures so a
 * feature can present the right recovery path.
 */
export async function getVunaMethod<T>(
  companyUrl: string,
  sessionId: string,
  method: string,
  params: VunaMethodParams = {},
  signal?: AbortSignal,
): Promise<T> {
  try {
    const response = await fetch(getMethodUrl(companyUrl, method, params), {
      headers: {
        Accept: "application/json",
        Cookie: `sid=${encodeURIComponent(sessionId)}`,
      },
      method: "GET",
      signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new FrappeClientError(
        "Your session has expired. Sign in again to continue.",
        "session",
      );
    }

    let payload: { message?: VunaEnvelope<T> } | undefined;
    try {
      payload = (await response.json()) as { message?: VunaEnvelope<T> };
    } catch {
      // Preserve a useful status-based error when a proxy returns non-JSON.
    }

    if (!response.ok) {
      throw new FrappeClientError(
        getFrappeErrorMessage(payload) ??
          `The server could not complete this request (${response.status}).`,
        "api",
        response.status,
      );
    }

    if (!payload?.message?.ok) {
      const message =
        payload?.message?.errors?.[0]?.message ??
        "The server could not complete this request.";
      throw new FrappeClientError(message, "api");
    }

    return payload.message.data;
  } catch (error) {
    if (error instanceof FrappeClientError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new FrappeClientError(
      "Could not reach your company site. Check your connection and try again.",
      "connection",
    );
  }
}

/**
 * Calls a VunaPOS POST endpoint with the saved Frappe session and CSRF token.
 * Frappe rejects state-changing requests without both, so this deliberately
 * fetches a current token instead of relying on browser cookie behaviour.
 */
export async function postVunaMethod<T>(
  companyUrl: string,
  sessionId: string,
  method: string,
  params: VunaMethodParams = {},
  signal?: AbortSignal,
): Promise<T> {
  const body = new URLSearchParams(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  ).toString();

  return postVunaEnvelopeMethod(
    companyUrl,
    sessionId,
    method,
    body,
    "application/x-www-form-urlencoded;charset=UTF-8",
    signal,
  );
}

/** Calls a VunaPOS envelope endpoint whose existing API expects JSON. */
export async function postVunaJsonMethod<T>(
  companyUrl: string,
  sessionId: string,
  method: string,
  params: FrappeJsonMethodParams = {},
  signal?: AbortSignal,
): Promise<T> {
  return postVunaEnvelopeMethod(
    companyUrl,
    sessionId,
    method,
    JSON.stringify(params),
    "application/json; charset=utf-8",
    signal,
  );
}

async function postVunaEnvelopeMethod<T>(
  companyUrl: string,
  sessionId: string,
  method: string,
  body: string,
  contentType: string,
  signal?: AbortSignal,
): Promise<T> {
  const csrf = await getVunaMethod<{ csrf_token: string }>(
    companyUrl,
    sessionId,
    "vunapos.api.auth.get_csrf_token",
    {},
    signal,
  );

  try {
    const response = await fetch(
      requestUrl(companyUrl, `/api/method/${method}`),
      {
        body,
        headers: {
          Accept: "application/json",
          Cookie: `sid=${encodeURIComponent(sessionId)}`,
          "Content-Type": contentType,
          "X-Frappe-CSRF-Token": csrf.csrf_token,
        },
        method: "POST",
        signal,
      },
    );

    if (response.status === 401 || response.status === 403) {
      throw new FrappeClientError(
        "Your session has expired. Sign in again to continue.",
        "session",
      );
    }

    let payload: { message?: VunaEnvelope<T> } | undefined;
    try {
      payload = (await response.json()) as { message?: VunaEnvelope<T> };
    } catch {
      // Preserve a useful status-based error when a proxy returns non-JSON.
    }

    if (!response.ok) {
      throw new FrappeClientError(
        getFrappeErrorMessage(payload) ??
          `The server could not complete this request (${response.status}).`,
        "api",
        response.status,
      );
    }

    if (!payload?.message?.ok) {
      const message =
        payload?.message?.errors?.[0]?.message ??
        "The server could not complete this request.";
      throw new FrappeClientError(message, "api");
    }

    return payload.message.data;
  } catch (error) {
    if (error instanceof FrappeClientError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new FrappeClientError(
      "Could not reach your company site. Check your connection and try again.",
      "connection",
    );
  }
}

/**
 * Calls a Frappe method that explicitly accepts a JSON request body. This is
 * deliberately separate from postVunaMethod: most VunaPOS APIs return the
 * standard { ok, data } envelope and accept form values, while a small number
 * of existing ERPNext-facing APIs return Frappe's raw `message` payload.
 */
export async function postFrappeJsonMethod<T>(
  companyUrl: string,
  sessionId: string,
  method: string,
  params: FrappeJsonMethodParams = {},
  signal?: AbortSignal,
): Promise<T> {
  const csrf = await getVunaMethod<{ csrf_token: string }>(
    companyUrl,
    sessionId,
    "vunapos.api.auth.get_csrf_token",
    {},
    signal,
  );

  try {
    const response = await fetch(
      requestUrl(companyUrl, `/api/method/${method}`),
      {
        body: JSON.stringify(params),
        headers: {
          Accept: "application/json",
          Cookie: `sid=${encodeURIComponent(sessionId)}`,
          "Content-Type": "application/json; charset=utf-8",
          "X-Frappe-CSRF-Token": csrf.csrf_token,
        },
        method: "POST",
        signal,
      },
    );

    if (response.status === 401 || response.status === 403) {
      throw new FrappeClientError(
        "Your session has expired. Sign in again to continue.",
        "session",
      );
    }

    let payload: { message?: T } | undefined;
    try {
      payload = (await response.json()) as { message?: T };
    } catch {
      // Preserve a useful status-based error when a proxy returns non-JSON.
    }

    if (!response.ok) {
      throw new FrappeClientError(
        getFrappeErrorMessage(payload) ??
          `The server could not complete this request (${response.status}).`,
        "api",
        response.status,
      );
    }

    if (payload?.message === undefined) {
      throw new FrappeClientError(
        getFrappeErrorMessage(payload) ??
          "The server could not complete this request.",
        "api",
        response.status,
      );
    }

    return payload.message;
  } catch (error) {
    if (error instanceof FrappeClientError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new FrappeClientError(
      "Could not reach your company site. Check your connection and try again.",
      "connection",
    );
  }
}
