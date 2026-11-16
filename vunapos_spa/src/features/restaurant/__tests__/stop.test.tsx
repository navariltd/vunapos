import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StopPreparation } from "../components/StopPreparation";
import { readStop, saveStop, clearStop, type SavedStop } from "../stopCommand";
import { pendingKitchenTickets } from "../kitchenCommand";

vi.mock("frappe-react-sdk", () => ({
  useFrappePostCall: () => ({ call: vi.fn() }),
}));
afterEach(() => vi.unstubAllGlobals());
const saved: SavedStop = {
  command: {
    ticket: "KOT-1",
    fingerprint: "review",
    request_key: "key",
    line_ids: ["meal"],
    used: { raw: 1 },
    reason: "Guest cancelled",
    charge: "Remove charge",
  },
  quote: {
    ticket: "KOT-1",
    fingerprint: "review",
    lines: [
      {
        line_id: "meal",
        item_name: "Pizza",
        uom: "Nos",
        qty: 2,
        ready_qty: 1,
        materials: [
          {
            id: "raw",
            item_name: "Flour",
            item_code: "flour",
            warehouse: "Kitchen",
            uom: "Kg",
            max_qty: 2,
            kind: "WIP",
          },
        ],
      },
    ],
  },
};
describe("stopping preparation recovery", () => {
  it("retains the exact material review and key within the user's profile", () => {
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
    saveStop("manager:counter", saved);
    expect(readStop("manager:counter", "KOT-1")).toEqual(saved);
    expect(readStop("waiter:counter", "KOT-1")).toBeNull();
    expect(pendingKitchenTickets("manager:counter")).toEqual(["KOT-1"]);
    clearStop("manager:counter", "KOT-1");
    expect(readStop("manager:counter", "KOT-1")).toBeNull();
  });
  it("fails closed for incomplete, excessive or corrupted review decisions", () => {
    for (const command of [
      { ...saved.command, used: {} },
      { ...saved.command, used: { raw: 3 } },
      { ...saved.command, used: { raw: -1 } },
      { ...saved.command, charge: "" },
      { ...saved.command, line_ids: ["meal", "meal"] },
      { ...saved.command, fingerprint: "different" },
      { ...saved.command, request_key: {} },
    ]) {
      vi.stubGlobal("sessionStorage", {
        getItem: () => JSON.stringify({ ...saved, command }),
      });
      expect(() => readStop("manager:counter", "KOT-1")).toThrow(
        "saved preparation stop could not be read"
      );
    }
  });
  it("does not send a stop without durable recovery storage", () => {
    vi.stubGlobal("sessionStorage", {
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(() => saveStop(null, saved)).toThrow("Wait for your POS Profile");
    expect(() => saveStop("manager:counter", saved)).toThrow(
      "No request was sent"
    );
  });
  it("only exposes the secondary action when allowed by the server", () => {
    expect(
      renderToStaticMarkup(
        <StopPreparation ticket="KOT-1" allowed={false} onChanged={() => {}} />
      )
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <StopPreparation ticket="KOT-1" allowed onChanged={() => {}} />
      )
    ).toContain("Stop preparation");
  });
});
