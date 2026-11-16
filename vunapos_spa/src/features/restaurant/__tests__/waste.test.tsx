import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordWaste } from "../components/RecordWaste";
import {
  readWaste,
  saveWaste,
  clearWaste,
  type SavedWaste,
} from "../wasteCommand";

vi.mock("frappe-react-sdk", () => ({
  useFrappePostCall: () => ({ call: vi.fn() }),
}));
afterEach(() => vi.unstubAllGlobals());
const saved: SavedWaste = {
  command: {
    ticket: "KOT-1",
    quantities: { meal: 1 },
    fingerprint: "review-1",
    request_key: "key-1",
    reason: "Dropped",
  },
  quote: {
    ticket: "KOT-1",
    fingerprint: "review-1",
    invoice: "INV-1",
    invoice_doctype: "Sales Invoice",
    lines: [{ line_id: "meal", item_name: "Burger", uom: "Nos", max_qty: 2 }],
  },
};
describe("restaurant waste recovery", () => {
  it("preserves the original approved command across reloads, isolated by user and profile", () => {
    const rows = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => rows.get(key) || null,
      setItem: (key: string, value: string) => rows.set(key, value),
      removeItem: (key: string) => rows.delete(key),
    });
    saveWaste("manager:counter", saved);
    expect(readWaste("manager:counter", "KOT-1")).toEqual(saved);
    expect(readWaste("waiter:counter", "KOT-1")).toBeNull();
    clearWaste("manager:counter", "KOT-1");
    expect(readWaste("manager:counter", "KOT-1")).toBeNull();
  });
  it("does not send an unrecoverable request when storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(() => saveWaste(null, saved)).toThrow("Wait for your POS Profile");
    expect(() => saveWaste("manager:counter", saved)).toThrow(
      "No request was sent"
    );
  });
  it("fails closed for corrupt or incomplete saved requests", () => {
    for (const raw of [
      "<html>",
      JSON.stringify({ command: saved.command }),
      JSON.stringify({
        ...saved,
        command: { ...saved.command, quantities: [] },
      }),
    ]) {
      vi.stubGlobal("sessionStorage", { getItem: () => raw });
      expect(() => readWaste("manager:counter", "KOT-1")).toThrow(
        "saved waste request could not be read"
      );
    }
  });
  it("shows a secondary action only when the server allows it", () => {
    expect(
      renderToStaticMarkup(
        <RecordWaste ticket="KOT-1" allowed={false} onChanged={() => {}} />
      )
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <RecordWaste ticket="KOT-1" allowed onChanged={() => {}} />
      )
    ).toContain("Record waste");
  });
});
