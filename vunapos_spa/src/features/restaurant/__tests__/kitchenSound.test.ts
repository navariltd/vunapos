import { describe, expect, it, vi } from "vitest";
import { createKitchenSoundGate, playKitchenChime } from "../kitchenSound";

describe("kitchen sound alerts", () => {
  it("does not replay duplicate notifications or tickets received while muted", () => {
    const gate = createKitchenSoundGate();
    expect(gate("KOT-1", false, 0)).toBe(false);
    expect(gate("KOT-1", true, 2000)).toBe(false);
    expect(gate("KOT-2", true, 2000)).toBe(true);
    expect(gate("KOT-2", true, 4000)).toBe(false);
    expect(gate("KOT-3", true, 4000)).toBe(true);
  });

  it("coalesces a burst of station tickets without replaying suppressed tickets", () => {
    const gate = createKitchenSoundGate();
    expect(gate("KOT-1", true, 0)).toBe(true);
    expect(gate("KOT-2", true, 200)).toBe(false);
    expect(gate("KOT-2", true, 2000)).toBe(false);
    expect(gate("KOT-3", true, 2000)).toBe(true);
  });

  it("rejects blank identities", () => {
    expect(createKitchenSoundGate()("", true, 0)).toBe(false);
  });

  it("plays two longer notes with sustained volume and disconnects their nodes afterwards", () => {
    const oscillators: Array<ReturnType<typeof oscillator>> = [];
    const gains: Array<ReturnType<typeof gain>> = [];
    const oscillator = () => ({
      frequency: { value: 0 },
      type: "",
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as null | (() => void),
    });
    const gain = () => ({
      gain: {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    });
    const context = {
      state: "running",
      currentTime: 10,
      destination: {},
      createOscillator: () => {
        const node = oscillator();
        oscillators.push(node);
        return node;
      },
      createGain: () => {
        const node = gain();
        gains.push(node);
        return node;
      },
    };
    playKitchenChime(context as unknown as AudioContext);
    expect(oscillators).toHaveLength(2);
    expect(oscillators[0].frequency.value).toBe(880);
    expect(oscillators[1].frequency.value).toBe(1174.66);
    expect(oscillators[0].start).toHaveBeenCalledWith(10);
    expect(oscillators[1].start).toHaveBeenCalledWith(10.68);
    expect(gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(0.336),
      10.02
    );
    expect(gains[0].gain.setValueAtTime).toHaveBeenCalledWith(expect.closeTo(0.336), 10.39);
    expect(oscillators[1].stop).toHaveBeenCalledWith(expect.closeTo(11.49));
    oscillators.forEach((node, index) => {
      node.onended?.();
      expect(node.disconnect).toHaveBeenCalledOnce();
      expect(gains[index].disconnect).toHaveBeenCalledOnce();
    });
  });

  it("does not silently pretend a suspended browser can play sound", () => {
    expect(() =>
      playKitchenChime({ state: "suspended" } as AudioContext)
    ).toThrow("Enable sound again");
  });
});
