import * as SecureStore from "expo-secure-store";

const APPEARANCE_PREFERENCE_KEY = "vunapos_appearance_preference";

export type AppearancePreference = "dark" | "light" | "system";

export function isAppearancePreference(
  value: string | null,
): value is AppearancePreference {
  return value === "dark" || value === "light" || value === "system";
}

export async function loadAppearancePreference(): Promise<AppearancePreference | null> {
  const value = await SecureStore.getItemAsync(APPEARANCE_PREFERENCE_KEY);
  return isAppearancePreference(value) ? value : null;
}

export async function persistAppearancePreference(
  preference: AppearancePreference,
) {
  await SecureStore.setItemAsync(APPEARANCE_PREFERENCE_KEY, preference);
}
