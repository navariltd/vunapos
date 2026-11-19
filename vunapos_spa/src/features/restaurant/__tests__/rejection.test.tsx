import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RejectPreparedItems } from "../components/RejectPreparedItems";
import { KitchenLineProgress } from "../components/KitchenLineProgress";
import { pendingKitchenTickets } from "../kitchenCommand";
import {
  readRejection,
  saveRejection,
  clearRejection,
  type SavedRejection,
} from "../rejectionCommand";
import type { KitchenTicketDTO } from "../types";

vi.mock("frappe-react-sdk", () => ({
  useFrappePostCall: () => ({ call: vi.fn() }),
}));
afterEach(() => vi.unstubAllGlobals());
const saved: SavedRejection = {
  command: {
    ticket: "KOT-1",
    quantities: { meal: 1 },
    fingerprint: "review",
    request_key: "key",
    reason: "Burnt food",
    charge: "Remove charge",
  },
  quote: {
    ticket: "KOT-1",
    fingerprint: "review",
    lines: [{ line_id: "meal", item_name: "Pizza", uom: "Nos", max_qty: 2 }],
  },
};
function storage() {
  const rows = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => rows.get(key) || null,
    setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key),
    get length() {
      return rows.size;
    },
    key: (index: number) => [...rows.keys()][index] || null,
  });
}
describe("prepared food rejection", () => {
  it("preserves the explicit charge decision and key, scoped to the manager's profile", () => {
    storage();
    saveRejection("manager:counter", saved);
    expect(readRejection("manager:counter", "KOT-1")).toEqual(saved);
    expect(readRejection("waiter:counter", "KOT-1")).toBeNull();
    expect(pendingKitchenTickets("manager:counter")).toEqual(["KOT-1"]);
    clearRejection("manager:counter", "KOT-1");
    expect(readRejection("manager:counter", "KOT-1")).toBeNull();
  });
  it("rejects corrupted recovery instead of guessing a charge policy", () => {
    for (const command of [
      { ...saved.command, charge: "" },
      { ...saved.command, quantities: [] },
      { ...saved.command, quantities: { meal: -1 } },
      { ...saved.command, fingerprint: "different" },
    ]) {
      vi.stubGlobal("sessionStorage", {
        getItem: () => JSON.stringify({ ...saved, command }),
      });
      expect(() => readRejection("manager:counter", "KOT-1")).toThrow(
        "saved rejection could not be read"
      );
    }
  });
  it("does not send a request that cannot be saved for recovery", () => {
    vi.stubGlobal("sessionStorage", {
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(() => saveRejection(null, saved)).toThrow(
      "Wait for your POS Profile"
    );
    expect(() => saveRejection("manager:counter", saved)).toThrow(
      "No request was sent"
    );
  });
  it("only offers the secondary action when the server permits it", () => {
    expect(
      renderToStaticMarkup(
        <RejectPreparedItems
          ticket="KOT-1"
          allowed={false}
          onChanged={() => {}}
        />
      )
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <RejectPreparedItems ticket="KOT-1" allowed onChanged={() => {}} />
      )
    ).toContain("Reject prepared items");
  });
  it("separates rejected food from served food without calling it a replacement", () => {
    const line = {
      item_name: "Pizza",
      accepted_qty: 4,
      served_qty: 2,
      retired_qty: 1,
      rejected_qty: 2,
      rejected_served_qty: 1,
    } as KitchenTicketDTO["items"][number];
    const html = renderToStaticMarkup(<KitchenLineProgress line={line} />);
    expect(html).toContain("rejected");
    expect(html).toContain("served");
    expect(html).not.toContain("replaced before service");
  });
});
