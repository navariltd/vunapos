import * as SecureStore from 'expo-secure-store';

const COMPANY_URL_KEY = 'vunapos_company_url';
const SESSION_ID_KEY = 'vunapos_session_id';

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

export async function clearStoredCompanyUrl() {
  await Promise.all([
    SecureStore.deleteItemAsync(COMPANY_URL_KEY),
    SecureStore.deleteItemAsync(SESSION_ID_KEY),
  ]);
}
