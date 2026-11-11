import * as SecureStore from 'expo-secure-store';

const COMPANY_URL_KEY = 'vunapos_company_url';
const SESSION_ID_KEY = 'vunapos_session_id';
const REVOKED_SESSION_KEY = 'vunapos_revoked_session';

export type RevokedSession = { companyUrl: string; sessionId: string };

export async function loadStoredCompanyUrl() {
  return SecureStore.getItemAsync(COMPANY_URL_KEY);
}

export async function persistCompanyUrl(companyUrl: string) {
  await SecureStore.setItemAsync(COMPANY_URL_KEY, companyUrl);
}

export async function loadStoredSessionId() {
  return SecureStore.getItemAsync(SESSION_ID_KEY);
}

export async function persistSessionId(sessionId: string) {
  await SecureStore.setItemAsync(SESSION_ID_KEY, sessionId);
}

export async function clearStoredSession() {
  await SecureStore.deleteItemAsync(SESSION_ID_KEY);
}

/** A durable tombstone prevents a failed SID deletion from restoring a revoked session. */
export async function loadStoredRevokedSession(): Promise<RevokedSession | null> {
  const value = await SecureStore.getItemAsync(REVOKED_SESSION_KEY);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as RevokedSession;
    return typeof parsed.companyUrl === 'string' && typeof parsed.sessionId === 'string'
      ? parsed : null;
  } catch { return null; }
}

export async function markStoredSessionRevoked(companyUrl: string, sessionId: string) {
  await SecureStore.setItemAsync(REVOKED_SESSION_KEY, JSON.stringify({ companyUrl, sessionId }));
}

export async function clearStoredRevokedSession() {
  await SecureStore.deleteItemAsync(REVOKED_SESSION_KEY);
}

export async function clearStoredCompanyUrl() {
  await Promise.all([
    SecureStore.deleteItemAsync(COMPANY_URL_KEY),
    SecureStore.deleteItemAsync(SESSION_ID_KEY),
  ]);
}
