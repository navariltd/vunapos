import { createKitchenSoundGate, playKitchenChime } from "./kitchenSound";
import type { AlertSoundPreference } from "./soundPreferences";

export type SoundActivationState = {
  enabled: boolean;
  muted: boolean;
  busy: boolean;
  error: string | null;
};
export const INITIAL_SOUND_ACTIVATION: SoundActivationState = {
  enabled: false,
  muted: false,
  busy: false,
  error: null,
};

/** Begin resume() synchronously inside the user gesture; never ring just for activation. */
export function createSoundActivation(
  initialPreference: AlertSoundPreference,
  onChange: (state: SoundActivationState) => void,
  makeContext: () => AudioContext = () => new AudioContext()
) {
  let preference = initialPreference;
  let context: AudioContext | null = null;
  let state = { ...INITIAL_SOUND_ACTIVATION };
  let version = 0;
  let automaticAttempted = false;
  const gate = createKitchenSoundGate();
  const configured = () =>
    preference.enabled !== false && preference.volume > 0;
  const update = (next: Partial<SoundActivationState>) => {
    state = { ...state, ...next };
    onChange(state);
  };
  const activate = async (manual = false, test = false) => {
    if (!configured()) return false;
    if (state.busy) {
      // An automatic resume may still be pending when the first real gesture arrives.
      if (manual && context) void context.resume().catch(() => undefined);
      return false;
    }
    if (state.enabled && context?.state === "running" && !test) return true;
    if (!manual && (state.muted || state.enabled || automaticAttempted))
      return false;
    automaticAttempted = true;
    const attempt = ++version;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    update({ busy: true, ...(manual ? { muted: false } : {}) });
    try {
      context ??= makeContext();
      const current = context;
      await Promise.race([
        current.resume(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Audio activation timed out")),
            3000
          );
        }),
      ]);
      if (attempt !== version || state.muted || current !== context)
        return false;
      if (!configured()) {
        automaticAttempted = false;
        update({ enabled: false });
        return false;
      }
      if (current.state !== "running") throw new Error("Audio is suspended");
      if (test) playKitchenChime(current, preference);
      update({ enabled: true, error: null });
      return true;
    } catch {
      if (attempt === version)
        update({
          enabled: false,
          error:
            "Sound could not start. Tap anywhere in POS and check this browser’s sound permissions.",
        });
      return false;
    } finally {
      clearTimeout(timeout);
      if (attempt === version) update({ busy: false });
    }
  };
  return {
    setPreference(next: AlertSoundPreference) {
      preference = next;
    },
    activate,
    mute() {
      version++;
      update({ enabled: false, muted: true, busy: false, error: null });
    },
    notify(name: string) {
      if (
        !gate(name, configured() && state.enabled && !state.muted, Date.now())
      )
        return;
      try {
        if (context) playKitchenChime(context, preference);
      } catch {
        automaticAttempted = false;
        update({
          enabled: false,
          error:
            "Sound was paused by the browser. Tap anywhere in POS to resume alerts.",
        });
      }
    },
    dispose() {
      version++;
      state = { ...state, enabled: false, busy: false };
      automaticAttempted = false;
      void context?.close().catch(() => undefined);
      context = null;
    },
  };
}

export function subscribeSoundActivation(
  target: EventTarget,
  activate: () => void
) {
  const interact = (event: Event) => {
    if (!event.isTrusted) return;
    if (event.type === "keydown") {
      const key = event as KeyboardEvent;
      if (
        key.repeat ||
        key.ctrlKey ||
        key.metaKey ||
        key.altKey ||
        ["Escape", "Shift", "Control", "Alt", "Meta"].includes(key.key)
      )
        return;
    }
    activate();
  };
  // Bubble after React handlers: a Mute click must not immediately enable sound again.
  target.addEventListener("click", interact);
  target.addEventListener("keydown", interact);
  return () => {
    target.removeEventListener("click", interact);
    target.removeEventListener("keydown", interact);
  };
}
