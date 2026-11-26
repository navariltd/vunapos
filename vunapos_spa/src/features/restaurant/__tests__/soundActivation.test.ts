import { describe, expect, it, vi } from "vitest";
import {
  createSoundActivation,
  subscribeSoundActivation,
} from "../soundActivation";
import { playKitchenChime } from "../kitchenSound";
import type { AlertSoundPreference } from "../soundPreferences";

vi.mock("../kitchenSound", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../kitchenSound")>()),
  playKitchenChime: vi.fn(),
}));

function fixture() {
  const preference: AlertSoundPreference = {
    enabled: true,
    tone: "bell",
    volume: 70,
  };
  const context = {
    state: "running" as AudioContextState,
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const change = vi.fn();
  const makeContext = vi.fn(() => context as unknown as AudioContext);
  const activation = createSoundActivation(preference, change, makeContext);
  vi.mocked(playKitchenChime).mockClear();
  return {
    context,
    change,
    makeContext,
    activation,
    settings: (next: AlertSoundPreference) => {
      activation.setPreference(next);
    },
  };
}

describe("restaurant automatic sound activation", () => {
  it("releases the controls when a browser never finishes resuming audio", async () => {
    vi.useFakeTimers();
    try {
      const { activation, context, change } = fixture();
      context.resume.mockImplementationOnce(() => new Promise<void>(() => {}));
      const pending = activation.activate();
      await vi.advanceTimersByTimeAsync(3000);
      expect(await pending).toBe(false);
      expect(change.mock.lastCall?.[0]).toMatchObject({
        busy: false,
        enabled: false,
      });
      expect(await activation.activate(true)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("unlocks silently and chimes only for a new notification or explicit test", async () => {
    const { activation, context, change } = fixture();
    const pending = activation.activate();
    expect(context.resume).toHaveBeenCalledOnce();
    await pending;
    expect(change.mock.lastCall?.[0]).toMatchObject({
      enabled: true,
      busy: false,
    });
    expect(playKitchenChime).not.toHaveBeenCalled();
    activation.notify("KOT-1");
    activation.notify("KOT-1");
    expect(playKitchenChime).toHaveBeenCalledOnce();
    await activation.activate(true, true);
    expect(playKitchenChime).toHaveBeenCalledTimes(2);
  });

  it("does not override central disable or zero volume, including manual enable", async () => {
    for (const preference of [
      { enabled: false, tone: "chime", volume: 70 },
      { enabled: true, tone: "bell", volume: 0 },
    ] as AlertSoundPreference[]) {
      const { activation, settings, makeContext } = fixture();
      settings(preference);
      expect(await activation.activate()).toBe(false);
      expect(await activation.activate(true)).toBe(false);
      expect(makeContext).not.toHaveBeenCalled();
    }
  });

  it("respects mute on later clicks and cancels pending activation", async () => {
    const { activation, context, change } = fixture();
    let finish!: () => void;
    context.resume.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const pending = activation.activate();
    activation.mute();
    finish();
    expect(await pending).toBe(false);
    expect(await activation.activate()).toBe(false);
    expect(change.mock.lastCall?.[0]).toMatchObject({
      enabled: false,
      muted: true,
    });
    expect(await activation.activate(true)).toBe(true);
    expect(change.mock.lastCall?.[0]).toMatchObject({
      enabled: true,
      muted: false,
    });
  });

  it("offers a manual fallback without retrying on every click", async () => {
    const { activation, context, change } = fixture();
    context.resume.mockRejectedValueOnce(new Error("blocked"));
    expect(await activation.activate()).toBe(false);
    expect(change.mock.lastCall?.[0].error).toContain("Enable sound");
    expect(await activation.activate()).toBe(false);
    expect(context.resume).toHaveBeenCalledOnce();
    expect(await activation.activate(true)).toBe(true);
  });

  it("reads current settings and cannot enable after disabling settings or unmounting", async () => {
    for (const unmount of [false, true]) {
      const { activation, settings, context, change } = fixture();
      let finish!: () => void;
      context.resume.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );
      const pending = activation.activate();
      if (unmount) activation.dispose();
      else settings({ enabled: false, tone: "bell", volume: 70 });
      finish();
      expect(await pending).toBe(false);
      expect(change.mock.calls.some(([state]) => state.enabled)).toBe(false);
      expect(playKitchenChime).not.toHaveBeenCalled();
    }
  });

  it("does not suppress notifications just because the page is hidden", async () => {
    const { activation } = fixture();
    await activation.activate();
    vi.stubGlobal("document", { visibilityState: "hidden", hidden: true });
    try {
      activation.notify("READY-1");
      expect(playKitchenChime).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("registers only trusted clicks/normal keypresses and cleans up listeners", () => {
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener: (type: string, listener: EventListener) =>
        listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as EventTarget;
    const activate = vi.fn();
    const unsubscribe = subscribeSoundActivation(target, activate);
    listeners.get("click")!({ type: "click", isTrusted: false } as Event);
    listeners.get("click")!({ type: "click", isTrusted: true } as Event);
    for (const options of [
      { key: "a" },
      { key: "Enter" },
      { key: "Escape" },
      { key: "a", ctrlKey: true },
      { key: "a", repeat: true },
    ]) {
      listeners.get("keydown")!({
        type: "keydown",
        isTrusted: true,
        ...options,
      } as unknown as KeyboardEvent);
    }
    expect(activate).toHaveBeenCalledTimes(3);
    expect(listeners.has("visibilitychange")).toBe(false);
    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});
