import { describe, expect, it } from "vitest";
import {
  getPosPageFromPath,
  getRestaurantSessionFromPath,
  getOrderFromPath,
} from "../../../lib/stores/navigationStore";
import { newSessionRound, committedSessionTotal } from "../sessionDraft";
import { deriveTableStatuses } from "../tableStatus";
import { addMenuItem, planSave } from "../orderDraft";
import type { RestaurantSessionDTO, RestaurantOrderDTO } from "../types";

const session: RestaurantSessionDTO = {
  name: "RS-1",
  pos_profile: "Counter",
  restaurant: "Cafe",
  branch: "Town",
  company: "Company",
  service_type: "Dine In",
  customer: "Guest",
  customer_name: "Guest",
  waiter: "waiter@example.com",
  waiter_name: "Waiter",
  guest_count: 3,
  status: "Open",
  opened_at: "2026-11-04 10:00:00",
  modified: "now",
  tables: [
    { table: "old", table_label: "1", released_at: "2026-11-04" },
    { table: "current", table_label: "2", released_at: null },
  ],
  rounds: [],
};

describe("restaurant session rounds", () => {
  it("uses active tables and visit context but never copies submitted items into a new round", () => {
    const draft = newSessionRound(session, "round-key");
    expect(draft.restaurant_session).toBe("RS-1");
    expect(draft.table).toBe("current");
    expect(draft.header.pax).toBe(3);
    expect(draft.order).toBeNull();
    expect(draft.unsent).toEqual([]);
  });
  it("sends only new items using a stable retry key", () => {
    const draft = addMenuItem(
      newSessionRound(session, "retry-key"),
      { item_code: "Tea", item_name: "Tea" },
      () => "line-1"
    );
    const step = planSave(draft)[0];
    expect(step.kind).toBe("create");
    if (step.kind === "create") {
      expect(step.params.idempotency_key).toBe("retry-key");
      expect(step.params.items.map((line) => line.item_code)).toEqual(["Tea"]);
    }
  });
  it("excludes cancelled rounds from committed total", () => {
    const rounds = [
      { status: "Open", grand_total: 150 },
      { status: "Cancelled", grand_total: 90 },
    ] as RestaurantOrderDTO[];
    expect(committedSessionTotal({ ...session, rounds })).toBe(150);
  });
  it("keeps a session-owned table occupied even before the first round", () => {
    const status = deriveTableStatuses([
      {
        table: "current",
        table_label: "2",
        floor: "main",
        seats: 4,
        status: "Occupied",
        orders: [],
        session: { ...session, tables: [] },
      },
    ]);
    expect(status.get("current")?.kind).toBe("occupied");
    expect(status.get("current")?.guests).toBe(3);
  });
  it("session deep links use the restaurant screen, not a Sales Order name", () => {
    const path = "/vunapos/order/session/RS-2026-00001";
    expect(getPosPageFromPath(path)).toBe("Order");
    expect(getRestaurantSessionFromPath(path)).toBe("RS-2026-00001");
    expect(getOrderFromPath(path)).toBeNull();
  });
});
