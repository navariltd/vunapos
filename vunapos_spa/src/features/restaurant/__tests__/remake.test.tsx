import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RemakeItems } from "../components/RemakeItems";
import { KitchenTicketCard } from "../components/KitchenPage";
import { KitchenLineProgress } from "../components/KitchenLineProgress";
import {
  readRemake,
  saveRemake,
  clearRemake,
  type SavedRemake,
} from "../remakeCommand";
import {
  pendingKitchenTickets,
  readKitchenCommand,
  saveKitchenCommand,
} from "../kitchenCommand";
import type { KitchenTicketDTO } from "../types";

vi.mock("frappe-react-sdk", () => ({
  useFrappePostCall: () => ({ call: vi.fn() }),
  FrappeContext: { Provider: () => null },
}));
afterEach(() => vi.unstubAllGlobals());
const saved: SavedRemake = {
  command: {
    ticket: "KOT-1",
    quantities: { meal: 1 },
    fingerprint: "review",
    request_key: "same-key",
    reason: "Burnt",
    disposition: "Discard",
  },
  quote: {
    ticket: "KOT-1",
    fingerprint: "review",
    lines: [{ line_id: "meal", item_name: "Burger", uom: "Nos", max_qty: 2 }],
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
  return rows;
}
describe("remake controls and recovery", () => {
  it("keeps the reviewed quantity, disposition, reason and retry key scoped to this user and profile", () => {
    storage();
    saveRemake("manager:counter", saved);
    expect(readRemake("manager:counter", "KOT-1")).toEqual(saved);
    expect(readRemake("waiter:counter", "KOT-1")).toBeNull();
    clearRemake("manager:counter", "KOT-1");
    expect(readRemake("manager:counter", "KOT-1")).toBeNull();
  });
  it("fails closed for invalid saved quantities or a missing disposition", () => {
    for (const command of [
      { ...saved.command, quantities: {} },
      { ...saved.command, disposition: "" },
      { ...saved.command, quantities: { meal: -1 } },
    ]) {
      vi.stubGlobal("sessionStorage", {
        getItem: () => JSON.stringify({ ...saved, command }),
      });
      expect(() => readRemake("manager:counter", "KOT-1")).toThrow(
        "saved remake request could not be read"
      );
    }
  });
  it("does not send an unrecoverable remake when storage fails", () => {
    vi.stubGlobal("sessionStorage", {
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(() => saveRemake(null, saved)).toThrow("Wait for your POS Profile");
    expect(() => saveRemake("manager:counter", saved)).toThrow(
      "No request was sent"
    );
  });
  it("shows a secondary remake action only when the server permits it", () => {
    expect(
      renderToStaticMarkup(
        <RemakeItems ticket="KOT-1" allowed={false} onChanged={() => {}} />
      )
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <RemakeItems ticket="KOT-1" allowed onChanged={() => {}} />
      )
    ).toContain("Remake items");
  });
  it("preserves an unknown cancellation result as the original kitchen command", () => {
    storage();
    const command = {
      ticket: "KOT-2",
      action: "Cancel Remake" as const,
      request_key: "key",
      expected_status: "Sent",
      expected_modified: "date",
      reason: "Guest left",
    };
    saveKitchenCommand("manager:counter", command);
    expect(readKitchenCommand("manager:counter", "KOT-2")).toEqual(command);
  });
  it("keeps unknown remakes discoverable when the original disappears from the active board", () => {
    storage();
    saveRemake("manager:counter", saved);
    expect(pendingKitchenTickets("manager:counter")).toEqual(["KOT-1"]);
    expect(pendingKitchenTickets("waiter:counter")).toEqual([]);
  });
  it("identifies replacement cards without replacing the normal kitchen action", () => {
    const ticket = {
      name: "KOT-2",
      sales_order: "SO-1",
      restaurant_session: "Visit",
      remake_of: "KOT-1",
      status: "Sent",
      station_label: "Kitchen",
      kitchen_station: "KS-1",
      sent_at: "2026-11-16 09:00:00",
      sent_by: "chef",
      items: [],
      available_actions: ["Accept"],
    } as KitchenTicketDTO;
    const html = renderToStaticMarkup(
      <KitchenTicketCard
        ticket={ticket}
        now={new Date("2026-11-16T09:01:00")}
        onOpen={() => {}}
        onChanged={() => {}}
      />
    );
    expect(html).toContain("Remake · ");
    expect(html).toContain("KOT-1");
    expect(html).toContain("Accept ticket");
  });
  it("distinguishes replaced originals from food actually served", () => {
    const line = {
      item_name: "Burger",
      accepted_qty: 2,
      ready_to_serve_qty: 0,
      served_qty: 0,
      retired_qty: 2,
      remade_qty: 2,
    } as KitchenTicketDTO["items"][number];
    const html = renderToStaticMarkup(<KitchenLineProgress line={line} />);
    expect(html).toContain("replaced before service");
    expect(html).not.toContain(">served<");
  });
});
