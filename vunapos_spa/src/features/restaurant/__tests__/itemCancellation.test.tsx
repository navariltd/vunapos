import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CancelOrderItems } from "../components/CancelOrderItems";
import { KitchenLineProgress } from "../components/KitchenLineProgress";
import {
  clearCancellation,
  readCancellation,
  saveCancellation,
  type SavedCancellation,
} from "../cancellationCommand";
import {
  cancelOrderItems,
  previewItemCancellation,
} from "../../../services/vunaApi";
import type { KitchenTicketDTO } from "../types";

vi.mock("frappe-react-sdk", () => ({
  useFrappePostCall: () => ({ call: vi.fn() }),
}));
afterEach(() => vi.unstubAllGlobals());

const saved: SavedCancellation = {
  command: {
    order: "SO-1",
    quantities: { meal: 1 },
    fingerprint: "original-review",
    request_key: "same-key",
    reason: "Customer changed their mind",
  },
  quote: {
    order: "SO-1",
    fingerprint: "original-review",
    pos_profile: "Counter",
    requires_manager_pin: true,
    lines: [
      {
        line_id: "meal",
        item_name: "Burger",
        qty: 4,
        uom: "Pcs",
        max_cancel_qty: 2,
      },
    ],
  },
};

describe("placed-item cancellation", () => {
  it("rejects structurally incomplete saved commands before rendering recovery quantities", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => JSON.stringify({ ...saved, quote: { order: "SO-1" } }),
    });
    expect(() => readCancellation("waiter:counter", "SO-1")).toThrow(
      "saved cancellation could not be read"
    );
  });
  it("preserves the original reviewed quantities, reason and key across a reload without saving a PIN", () => {
    const rows = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => rows.get(key) || null,
      setItem: (key: string, value: string) => rows.set(key, value),
      removeItem: (key: string) => rows.delete(key),
    });
    saveCancellation("waiter:counter", saved);
    expect(readCancellation("waiter:counter", "SO-1")).toEqual(saved);
    expect(readCancellation("other:counter", "SO-1")).toBeNull();
    expect([...rows.values()][0]).not.toContain("manager_pin_token");
    clearCancellation("waiter:counter", "SO-1");
    expect(readCancellation("waiter:counter", "SO-1")).toBeNull();
  });

  it("fails safely if recovery storage is broken rather than allowing an untracked cancellation", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => "<html>login</html>",
      setItem: () => {
        throw new Error("Quota");
      },
    });
    expect(() => readCancellation("waiter:counter", "SO-1")).toThrow();
    expect(() => saveCancellation("waiter:counter", saved)).toThrow(
      "No request was sent"
    );
    expect(() => saveCancellation(null, saved)).toThrow(
      "Wait for your POS Profile"
    );
  });

  it("sends only a quantity cancellation command, not replacement item rates or stock entries", async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ message: { ok: true, data: saved.quote } });
    await previewItemCancellation(call, "SO-1");
    expect(call).toHaveBeenLastCalledWith({ order: "SO-1" });
    await cancelOrderItems(call, {
      ...saved.command,
      manager_pin_token: "approval",
    });
    expect(call).toHaveBeenLastCalledWith({
      ...saved.command,
      manager_pin_token: "approval",
    });
  });

  it("only offers a new cancellation to a permitted role", () => {
    expect(
      renderToStaticMarkup(
        <CancelOrderItems order="SO-1" allowed={false} onChanged={() => {}} />
      )
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <CancelOrderItems order="SO-1" allowed onChanged={() => {}} />
      )
    ).toContain("Cancel items");
  });

  it("distinguishes cancelled quantities from meals still preparing or ready", () => {
    const line = {
      item_name: "Burger",
      accepted_qty: 3,
      preparing_qty: 1,
      ready_to_serve_qty: 2,
      cancelled_qty: 1,
    } as KitchenTicketDTO["items"][number];
    const html = renderToStaticMarkup(<KitchenLineProgress line={line} />);
    expect(html).toContain("1 cancelled");
    expect(html).toContain("1 preparing");
    expect(html).toContain("2 ready to serve");
  });
});
