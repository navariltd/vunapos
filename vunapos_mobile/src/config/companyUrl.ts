const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '10.0.2.2']);

export type CompanyUrlValidation =
  | { ok: true; url: string }
  | { ok: false; message: string };

/** Normalizes the single Frappe site origin the mobile app communicates with. */
export function normalizeCompanyUrl(rawInput: string): CompanyUrlValidation {
  const input = rawInput.trim();
  if (!input) {
    return { ok: false, message: 'Enter your company URL.' };
  }

  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;

  try {
    const parsed = new URL(withScheme);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
      return { ok: false, message: 'Enter a valid http:// or https:// address.' };
    }
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
      return { ok: false, message: 'Enter the site address only, without a path or sign-in details.' };
    }
    if (parsed.protocol === 'http:' && !LOOPBACK_HOSTS.has(parsed.hostname)) {
      return { ok: false, message: 'Use https:// to keep your sign-in details secure.' };
    }

    return { ok: true, url: parsed.origin };
  } catch {
    return { ok: false, message: 'Enter a valid http:// or https:// address.' };
  }
}
