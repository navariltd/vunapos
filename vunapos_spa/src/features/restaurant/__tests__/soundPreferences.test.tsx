import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SOUND_PREFERENCES,
  SOUND_TONES,
  normalizeSoundPreferences,
} from "../soundPreferences";
import { playKitchenChime } from "../kitchenSound";

describe("centrally resolved restaurant sound settings", () => {
  it("uses application defaults when settings are absent", () => {
    expect(normalizeSoundPreferences(undefined)).toEqual(
      DEFAULT_SOUND_PREFERENCES
    );
  });

  it("preserves server disable flags and zero volume", () => {
    expect(
      normalizeSoundPreferences({
        newKot: { enabled: false, tone: "double-beep", volume: 0 },
        ready: { enabled: true, tone: "soft-ding", volume: 40 },
      })
    ).toEqual({
      newKot: { enabled: false, tone: "double-beep", volume: 0 },
      ready: { enabled: true, tone: "soft-ding", volume: 40 },
    });
  });

  it("rejects invalid tones and bounds volume without reading browser storage", () => {
    const getItem = vi.fn(() => {
      throw new Error("must not read local sound preferences");
    });
    vi.stubGlobal("window", { localStorage: { getItem } });
    try {
      expect(
        normalizeSoundPreferences({
          newKot: { tone: "uploaded-file", volume: NaN },
          ready: { tone: "soft-ding", volume: 300 },
        })
      ).toEqual({
        newKot: DEFAULT_SOUND_PREFERENCES.newKot,
        ready: { enabled: true, tone: "soft-ding", volume: 100 },
      });
      expect(getItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("generated sound presets", () => {
  function audioContext() {
    return {
      state: "running",
      currentTime: 10,
      destination: {},
      createOscillator: vi.fn(() => ({
        frequency: { value: 0 },
        type: "",
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      })),
      createGain: vi.fn(() => ({
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
    };
  }

  it.each(SOUND_TONES)(
    "generates the $label preset with the selected volume",
    ({ value }) => {
      const context = audioContext();
      playKitchenChime(context as unknown as AudioContext, {
        tone: value,
        volume: 50,
      });
      const expectedNotes =
        value === "chime" || value === "double-beep" ? 2 : 1;
      expect(context.createOscillator).toHaveBeenCalledTimes(expectedNotes);
      expect(
        context.createGain.mock.results[0].value.gain.linearRampToValueAtTime
      ).toHaveBeenCalledWith(0.24, 10.02);
      const gains = context.createGain.mock.results.map(
        ({ value }) => value.gain
      );
      expect(
        gains.every((gain) => gain.setValueAtTime.mock.calls[1][0] === 0.24)
      ).toBe(true);
      const end = Math.max(
        ...context.createOscillator.mock.results.map(
          ({ value }) => value.stop.mock.calls[0][0]
        )
      );
      expect(end - context.currentTime).toBeGreaterThanOrEqual(1);
      expect(end - context.currentTime).toBeLessThan(2);
      expect(
        context.createOscillator.mock.results[0].value.frequency.value
      ).toBeGreaterThan(0);
    }
  );

  it("uses distinct note patterns for all four presets", () => {
    const patterns = SOUND_TONES.map(({ value }) => {
      const context = audioContext();
      playKitchenChime(context as unknown as AudioContext, {
        tone: value,
        volume: 70,
      });
      return JSON.stringify(
        context.createOscillator.mock.results.map(({ value: node }) => ({
          frequency: node.frequency.value,
          wave: node.type,
          start: node.start.mock.calls,
          stop: node.stop.mock.calls,
        }))
      );
    });
    expect(new Set(patterns).size).toBe(4);
  });

  it("does not generate audio at zero volume", () => {
    const context = audioContext();
    playKitchenChime(context as unknown as AudioContext, {
      tone: "chime",
      volume: 0,
    });
    expect(context.createOscillator).not.toHaveBeenCalled();
  });
});
