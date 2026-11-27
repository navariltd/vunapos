// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AllDaySummary } from "../components/AllDaySummary";

const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }));
vi.mock("frappe-react-sdk", () => ({ useFrappeGetCall: mocks.request }));
let node: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.request.mockReturnValue({
    data: {
      message: {
        items: [
          { item_code: "Tea", item_name: "Tea", remaining: 1234, uom: "Cup" },
        ],
        partial: false,
      },
    },
    mutate: mocks.refresh,
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});
async function render(station = "Coffee Bar", revision = "1") {
  await act(async () =>
    root.render(
      <AllDaySummary
        posProfile="Till 1"
        station={station}
        revision={revision}
      />
    )
  );
}
async function open() {
  await act(async () =>
    node
      .querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!
      .click()
  );
}

describe("items to prepare dialog", () => {
  it("only loads quantities when opened and closes with Escape", async () => {
    await render();
    expect(node.textContent).toBe("Items to prepare");
    expect(mocks.request).not.toHaveBeenCalled();
    await open();
    expect(node.querySelector('[role="dialog"]')?.className).toContain(
      "sm:max-w-4xl"
    );
    expect(node.textContent).not.toContain("Check each ticket");
    expect(node.textContent).not.toContain("Pending quantities across");
    expect(node.querySelector('[role="dialog"]')?.textContent).toContain("Tea");
    expect(node.textContent).toContain("Cup");
    expect(mocks.request).toHaveBeenCalledWith(
      "vunapos.api.kitchen_printing.all_day",
      { pos_profile: "Till 1", station: "Coffee Bar" },
      "all-day:Till 1:Coffee Bar",
      { refreshInterval: 15000 }
    );
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    );
    expect(node.querySelector('[role="dialog"]')).toBeNull();
    const count = mocks.request.mock.calls.length;
    await render("Coffee Bar", "2");
    expect(mocks.request).toHaveBeenCalledTimes(count);
  });

  it("refreshes on kitchen revisions and preserves partial and empty states", async () => {
    mocks.request.mockReturnValue({
      data: { message: { items: [], partial: true } },
      mutate: mocks.refresh,
    });
    await render();
    await open();
    expect(node.textContent).toContain("first 1,000 tickets");
    expect(node.textContent).toContain("No items waiting for preparation");
    mocks.refresh.mockClear();
    await render("Coffee Bar", "2");
    expect(mocks.refresh).toHaveBeenCalledOnce();
    await render("", "3");
    expect(mocks.request).toHaveBeenLastCalledWith(
      "vunapos.api.kitchen_printing.all_day",
      { pos_profile: "Till 1", station: undefined },
      "all-day:Till 1:",
      { refreshInterval: 15000 }
    );
  });

  it("shows a retry action rather than stale totals after refresh errors", async () => {
    mocks.request.mockReturnValue({
      error: new Error("offline"),
      mutate: mocks.refresh,
    });
    await render();
    await open();
    expect(node.querySelector('[role="alert"]')?.textContent).toContain(
      "Unable to refresh quantities"
    );
    mocks.refresh.mockClear();
    const retry = Array.from(node.querySelectorAll("button")).find(
      (button) => button.textContent === "Try again"
    )!;
    await act(async () => retry.click());
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
