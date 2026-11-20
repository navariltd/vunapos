import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KitchenLineProgress } from "../components/KitchenLineProgress";
import {
  clearKitchenCommand,
  kitchenLines,
  pendingKitchenTickets,
  positiveKitchenQuantities,
  readKitchenCommand,
  saveKitchenCommand,
  type KitchenCommand,
} from "../kitchenCommand";
import type { KitchenTicketDTO } from "../types";

afterEach(() => vi.unstubAllGlobals());

function storage() {
  const rows = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    get length() {
      return rows.size;
    },
    key: (index: number) => [...rows.keys()][index] ?? null,
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key),
  });
  return rows;
}

describe("partial kitchen quantities", () => {
  it("keeps the original request, version and quantities after remount, isolated by user/profile", () => {
    storage();
    const command: KitchenCommand = {
      ticket: "KOT-1",
      action: "Ready",
      request_key: "stable-key",
      expected_status: "Preparing",
      expected_modified: "2026-11-13 10:01:00.123456",
      quantities: { meal: 1 },
    };
    saveKitchenCommand("chef:counter", command);
    expect(pendingKitchenTickets("chef:counter")).toEqual(["KOT-1"]);
    expect(pendingKitchenTickets("other:counter")).toEqual([]);
    expect(readKitchenCommand("chef:counter", "KOT-1")).toEqual(command);
    expect(readKitchenCommand("other:counter", "KOT-1")).toBeNull();
    clearKitchenCommand("chef:counter", "KOT-1");
    expect(pendingKitchenTickets("chef:counter")).toEqual([]);
    expect(readKitchenCommand("chef:counter", "KOT-1")).toBeNull();
  });

  it("preserves the reason when recovering a service correction", () => {
    storage();
    const command: KitchenCommand = {
      ticket: "KOT-1",
      action: "Undo Serve",
      request_key: "correction",
      expected_status: "Served",
      reason: "Wrong table selected",
      quantities: { meal: 1 },
    };
    saveKitchenCommand("manager:counter", command);
    expect(readKitchenCommand("manager:counter", "KOT-1")).toEqual(command);
  });

  it("does not silently discard an unreadable command or send without durable browser storage", () => {
    const rows = storage();
    rows.set("chef:counter:kitchen-command:KOT-1", "<html>login</html>");
    expect(() => readKitchenCommand("chef:counter", "KOT-1")).toThrow();
    vi.stubGlobal("sessionStorage", {
      setItem: () => {
        throw new Error("Quota");
      },
    });
    expect(() =>
      saveKitchenCommand("chef:counter", {
        ticket: "KOT-1",
        action: "Ready",
        request_key: "key",
        expected_status: "Preparing",
      })
    ).toThrow("no action was sent");
  });

  it("zero leaves a dish unchanged and add-ons cannot advance independently", () => {
    expect(
      positiveKitchenQuantities({ meal: 2, other: 0, bad: NaN, negative: -1 })
    ).toEqual({ meal: 2 });
    const ticket = {
      items: [
        { line_id: "meal", available_quantities: { Ready: 2 } },
        {
          line_id: "addon",
          parent_line_id: "meal",
          available_quantities: { Ready: 2 },
        },
        { line_id: "waiting", available_quantities: { Ready: 0 } },
      ],
    } as unknown as KitchenTicketDTO;
    expect(kitchenLines(ticket, "Ready").map((line) => line.line_id)).toEqual([
      "meal",
    ]);
  });

  it("shows distinct current buckets instead of presenting cumulative counts as separate meals", () => {
    const line = {
      accepted_qty: 4,
      waiting_qty: 1,
      preparing_qty: 1,
      ready_to_serve_qty: 1,
      served_qty: 1,
    };
    const html = renderToStaticMarkup(
      <KitchenLineProgress line={line as KitchenTicketDTO["items"][number]} />
    );
    for (const text of [
      "1 waiting",
      "1 preparing",
      "1 ready to serve",
      "1 served",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("4 accepted");
  });
});
