import { useEffect, useMemo, useState } from "react";
import {
  normalizeSoundPreferences,
  type SoundPreferences,
  type SoundAlertKind,
} from "../soundPreferences";
import {
  createSoundActivation,
  INITIAL_SOUND_ACTIVATION,
  subscribeSoundActivation,
} from "../soundActivation";

export type KitchenSoundControl = ReturnType<typeof useKitchenSound>;

export function useKitchenSound(
  kind: SoundAlertKind = "newKot",
  settings?: SoundPreferences
) {
  const preference = useMemo(
    () => normalizeSoundPreferences(settings)[kind],
    [settings, kind]
  );
  const configured = preference.enabled !== false && preference.volume > 0;
  const [state, setState] = useState(INITIAL_SOUND_ACTIVATION);
  const [activation] = useState(() =>
    createSoundActivation(preference, setState)
  );
  useEffect(() => {
    activation.setPreference(preference);
    void activation.activate();
  }, [activation, preference]);
  useEffect(() => {
    const unsubscribe = subscribeSoundActivation(window, () => {
      void activation.activate(true);
    });
    return () => {
      unsubscribe();
      activation.dispose();
    };
  }, [activation]);
  return {
    configured,
    enabled: configured && state.enabled,
    muted: state.muted,
    error: state.error,
    busy: state.busy,
    onCreated: activation.notify,
    preview: () => activation.activate(true, true),
  };
}
