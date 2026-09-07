import { normalizeCompanyUrl } from '@/config/companyUrl';

type FrappeMessage = {
  message?: {
    ok?: boolean;
  };
};

type VunaEnvelope<T> = {
  data: T;
  errors?: { message?: string }[];
  ok: boolean;
};

type VunaMethodParams = Record<string, boolean | number | string | null | undefined>;

export class FrappeClientError extends Error {
  constructor(
    message: string,
    readonly code: 'api' | 'connection' | 'login' | 'session',
  ) {
    super(message);
  }
}

function requestUrl(companyUrl: string, path: string) {
  return `${companyUrl}${path}`;
}

function getMethodUrl(companyUrl: string, method: string, params: VunaMethodParams) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  }

  const baseUrl = requestUrl(companyUrl, `/api/method/${method}`);
  const queryString = query.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

function getSessionId(response: Response): string | undefined {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? [headers.get('set-cookie') ?? ''];

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

export async function verifyVunaPosSite(companyUrl: string): Promise<void> {
  try {
    const response = await fetch(requestUrl(companyUrl, '/api/method/vunapos.api.pos.ping'), {
      headers: { Accept: 'application/json' },
      method: 'GET',
    });
    if (!response.ok) {
      throw new FrappeClientError('That address did not respond as a VunaPOS site.', 'connection');
    }

    const payload = await response.json() as FrappeMessage;
    if (payload.message?.ok !== true) {
      throw new FrappeClientError('That address did not respond as a VunaPOS site.', 'connection');
    }
  } catch (error) {
    if (error instanceof FrappeClientError) {
      throw error;
    }
    throw new FrappeClientError('Could not reach that address. Check the URL and your connection.', 'connection');
  }
}

export async function signInToFrappe(companyUrl: string, identifier: string, password: string): Promise<string> {
  const normalized = normalizeCompanyUrl(companyUrl);
  if (!normalized.ok) {
    throw new FrappeClientError('Set a valid company URL before signing in.', 'connection');
  }

  try {
    const response = await fetch(requestUrl(normalized.url, '/api/method/login'), {
      body: new URLSearchParams({ usr: identifier.trim(), pwd: password }).toString(),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      method: 'POST',
    });

    if (!response.ok) {
      throw new FrappeClientError('Sign-in failed. Check your details and try again.', 'login');
    }

    const sessionId = getSessionId(response);
    if (!sessionId) {
      throw new FrappeClientError('Frappe did not create a session. Complete any additional sign-in verification and try again.', 'login');
    }

    return sessionId;
  } catch (error) {
    if (error instanceof FrappeClientError) {
      throw error;
    }
    throw new FrappeClientError('Could not reach your company site. Check your connection and try again.', 'connection');
  }
}

export async function validateFrappeSession(companyUrl: string, sessionId: string): Promise<'valid' | 'expired' | 'unavailable'> {
  try {
    const response = await fetch(requestUrl(companyUrl, '/api/method/vunapos.api.auth.get_csrf_token'), {
      headers: { Accept: 'application/json', Cookie: `sid=${encodeURIComponent(sessionId)}` },
      method: 'GET',
    });
    if (response.status === 401 || response.status === 403) {
      return 'expired';
    }
    return response.ok ? 'valid' : 'unavailable';
  } catch {
    return 'unavailable';
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
        Accept: 'application/json',
        Cookie: `sid=${encodeURIComponent(sessionId)}`,
      },
      method: 'GET',
      signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new FrappeClientError('Your session has expired. Sign in again to continue.', 'session');
    }

    let payload: { message?: VunaEnvelope<T> } | undefined;
    try {
      payload = await response.json() as { message?: VunaEnvelope<T> };
    } catch {
      // Preserve a useful status-based error when a proxy returns non-JSON.
    }

    if (!response.ok) {
      throw new FrappeClientError(`The server could not complete this request (${response.status}).`, 'api');
    }

    if (!payload?.message?.ok) {
      const message = payload?.message?.errors?.[0]?.message ?? 'The server could not complete this request.';
      throw new FrappeClientError(message, 'api');
    }

    return payload.message.data;
  } catch (error) {
    if (error instanceof FrappeClientError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new FrappeClientError('Could not reach your company site. Check your connection and try again.', 'connection');
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
  const csrf = await getVunaMethod<{ csrf_token: string }>(
    companyUrl,
    sessionId,
    'vunapos.api.auth.get_csrf_token',
    {},
    signal,
  );

  try {
    const response = await fetch(requestUrl(companyUrl, `/api/method/${method}`), {
      body: new URLSearchParams(
        Object.entries(params)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => [key, String(value)]),
      ).toString(),
      headers: {
        Accept: 'application/json',
        Cookie: `sid=${encodeURIComponent(sessionId)}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'X-Frappe-CSRF-Token': csrf.csrf_token,
      },
      method: 'POST',
      signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new FrappeClientError('Your session has expired. Sign in again to continue.', 'session');
    }

    let payload: { message?: VunaEnvelope<T> } | undefined;
    try {
      payload = await response.json() as { message?: VunaEnvelope<T> };
    } catch {
      // Preserve a useful status-based error when a proxy returns non-JSON.
    }

    if (!response.ok) {
      throw new FrappeClientError(`The server could not complete this request (${response.status}).`, 'api');
    }

    if (!payload?.message?.ok) {
      const message = payload?.message?.errors?.[0]?.message ?? 'The server could not complete this request.';
      throw new FrappeClientError(message, 'api');
    }

    return payload.message.data;
  } catch (error) {
    if (error instanceof FrappeClientError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    throw new FrappeClientError('Could not reach your company site. Check your connection and try again.', 'connection');
  }
}
