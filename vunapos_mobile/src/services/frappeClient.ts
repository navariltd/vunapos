import { normalizeCompanyUrl } from '@/config/companyUrl';

type FrappeMessage = {
  message?: {
    ok?: boolean;
  };
};

export class FrappeClientError extends Error {
  constructor(
    message: string,
    readonly code: 'connection' | 'login' | 'session',
  ) {
    super(message);
  }
}

function requestUrl(companyUrl: string, path: string) {
  return `${companyUrl}${path}`;
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
