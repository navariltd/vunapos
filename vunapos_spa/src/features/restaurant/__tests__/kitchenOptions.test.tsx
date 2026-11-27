// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KitchenOptions } from "../components/KitchenOptions";

const sound = {
  configured: true,
  enabled: true,
  muted: false,
  error: null,
  busy: false,
  mute: vi.fn(),
  enable: vi.fn(),
  onCreated: vi.fn(),
  preview: vi.fn(),
};
const change = vi.fn();
let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});
async function show(manager = false) {
  await act(async () =>
    root.render(
      <KitchenOptions
        sound={sound}
        history={false}
        onHistoryChange={change}
        canManageAvailability={manager}
      />
    )
  );
  const more = node.querySelector<HTMLButtonElement>(
    'button[aria-label="More kitchen options"]'
  )!;
  expect(node.textContent).not.toContain("Test sound");
  await act(async () => more.click());
  return more;
}

it("keeps secondary actions behind More and preserves their behavior", async () => {
  const more = await show();
  expect(node.querySelector("a")).toBeNull();
  await act(async () =>
    node.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
  );
  expect(change).toHaveBeenCalledWith(true);
  expect(node.textContent).not.toContain("Test sound");
  expect(sound.preview).not.toHaveBeenCalled();
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
  );
  expect(more.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(more);
});

it("shows manager availability tools and dismisses on an outside click", async () => {
  await show(true);
  const preview = Array.from(node.querySelectorAll("button")).find(
    (button) => button.textContent === "Test sound"
  )!;
  await act(async () => preview.click());
  expect(sound.preview).toHaveBeenCalledOnce();
  expect(node.querySelector("a")?.getAttribute("href")).toBe(
    "/desk/restaurant-availability"
  );
  await act(async () =>
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }))
  );
  expect(node.querySelector('[role="group"]')).toBeNull();
});
