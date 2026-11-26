import {
  DEFAULT_SOUND_PREFERENCES,
  type AlertSoundPreference,
  type SoundTone,
} from "./soundPreferences";

type ToneNote = {
  offset: number;
  frequency: number;
  duration: number;
  wave: OscillatorType;
};
const TONE_NOTES: Record<SoundTone, ToneNote[]> = {
  chime: [
    { offset: 0, frequency: 880, duration: 0.6, wave: "sine" },
    { offset: 0.68, frequency: 1174.66, duration: 0.8, wave: "sine" },
  ],
  bell: [{ offset: 0, frequency: 1046.5, duration: 1.5, wave: "triangle" }],
  "double-beep": [
    { offset: 0, frequency: 880, duration: 0.4, wave: "sine" },
    { offset: 0.65, frequency: 880, duration: 0.4, wave: "sine" },
  ],
  "soft-ding": [{ offset: 0, frequency: 659.25, duration: 1.6, wave: "sine" }],
};

/** Original synthesized presets: no recordings, audio downloads or dependencies. */
export function playKitchenChime(
  context: AudioContext,
  preference: AlertSoundPreference = DEFAULT_SOUND_PREFERENCES.newKot
) {
  if (preference.enabled === false) return;
  if (context.state !== "running")
    throw new Error("Sound is paused. Enable sound again.");
  const volume = Math.max(0, Math.min(100, preference.volume)) / 100;
  if (!volume) return;
  for (const { offset, frequency, duration, wave } of TONE_NOTES[
    preference.tone
  ]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + offset;
    oscillator.type = wave;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    // Keep headroom for overlapping alerts, but sustain the audible body rather
    // than immediately fading a very short note almost to silence.
    const peak = 0.48 * volume;
    gain.gain.linearRampToValueAtTime(peak, start + 0.02);
    gain.gain.setValueAtTime(peak, start + duration * 0.65);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
  }
}

/** Duplicate deliveries must not ring again; coalesce a burst into one chime. */
export function createKitchenSoundGate() {
  const seen = new Set<string>();
  let lastPlayed = -Infinity;
  return (name: string, enabled: boolean, now: number) => {
    if (!name || seen.has(name)) return false;
    seen.add(name);
    if (seen.size > 5000) seen.delete(seen.values().next().value!);
    if (!enabled || now - lastPlayed < 1000) return false;
    lastPlayed = now;
    return true;
  };
}
