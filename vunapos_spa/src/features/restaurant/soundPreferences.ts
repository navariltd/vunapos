export const SOUND_TONES = [
  { value: "chime", label: "Chime" },
  { value: "bell", label: "Bell" },
  { value: "double-beep", label: "Double beep" },
  { value: "soft-ding", label: "Soft ding" },
] as const;

export type SoundTone = typeof SOUND_TONES[number]["value"];
export type SoundAlertKind = "newKot" | "ready";
export type AlertSoundPreference = {
  tone: SoundTone;
  volume: number;
  enabled?: boolean;
};
export type SoundPreferences = Record<SoundAlertKind, AlertSoundPreference>;

export const DEFAULT_SOUND_PREFERENCES: SoundPreferences = {
  newKot: { tone: "chime", volume: 70, enabled: true },
  ready: { tone: "bell", volume: 70, enabled: true },
};

function normalizeAlert(
  value: unknown,
  fallback: AlertSoundPreference
): AlertSoundPreference {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<AlertSoundPreference>)
      : {};
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : true,
    tone: SOUND_TONES.some((tone) => tone.value === candidate.tone)
      ? candidate.tone!
      : fallback.tone,
    volume:
      typeof candidate.volume === "number" && Number.isFinite(candidate.volume)
        ? Math.round(Math.max(0, Math.min(100, candidate.volume)))
        : fallback.volume,
  };
}

export function normalizeSoundPreferences(value: unknown): SoundPreferences {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<SoundPreferences>)
      : {};
  return {
    newKot: normalizeAlert(candidate.newKot, DEFAULT_SOUND_PREFERENCES.newKot),
    ready: normalizeAlert(candidate.ready, DEFAULT_SOUND_PREFERENCES.ready),
  };
}
