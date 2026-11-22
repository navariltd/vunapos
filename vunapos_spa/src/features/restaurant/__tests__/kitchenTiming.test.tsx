import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KitchenTimings } from "../components/KitchenTimings";
import { kitchenCardTiming, kitchenDuration } from "../kitchenTiming";
import type { KitchenTicketDTO } from "../types";

const sent = "2026-11-22T12:00:00+03:00";
const now = new Date("2026-11-22T12:25:00+03:00");
const ticket: KitchenTicketDTO = {
  name: "KOT-1", kitchen_station: "KS-1", station_label: "Main Kitchen",
  sales_order: "SO-1", restaurant_session: "RS-1", sent_at: sent,
  sent_by: "waiter@example.com", status: "Ready",
  items: [{ line_id: "tea", item_code: "Tea", item_name: "Tea", qty: 4, uom: "Cup", stock_qty: 4, stock_uom: "Cup", modifiers: [], temporary_routing: false }],
  timing: {
    sent_at: sent, finished_at: null,
    current: { stage: "service", since: "2026-11-22T12:20:00+03:00" },
    stages: [
      { stage: "acceptance", pending: false, since: null },
      { stage: "queue", pending: false, since: null },
      { stage: "preparation", pending: false, since: null },
      { stage: "service", pending: true, since: "2026-11-22T12:20:00+03:00" },
    ],
    batches: [
      { stage: "acceptance", line_id: "tea", qty: 4, seconds: 120, started_at: sent, finished_at: "2026-11-22T12:02:00+03:00" },
      { stage: "queue", line_id: "tea", qty: 4, seconds: 180, started_at: "2026-11-22T12:02:00+03:00", finished_at: "2026-11-22T12:05:00+03:00" },
      { stage: "preparation", line_id: "tea", qty: 2, seconds: 300, started_at: "2026-11-22T12:05:00+03:00", finished_at: "2026-11-22T12:10:00+03:00" },
      { stage: "preparation", line_id: "tea", qty: 2, seconds: 900, started_at: "2026-11-22T12:05:00+03:00", finished_at: "2026-11-22T12:20:00+03:00" },
    ],
  },
};

describe("kitchen stage timers", () => {
  it("shows time in the current stage instead of the ticket's age", () => {
    expect(kitchenCardTiming(ticket, now)).toEqual({ text: "Awaiting service · 5 min", overdue: false });
  });

  it("uses explicit stage labels and the supplied outstanding quantity clock", () => {
    for (const [stage, label] of [["acceptance", "Awaiting acceptance"], ["queue", "Awaiting preparation"], ["preparation", "Preparing"], ["service", "Awaiting service"]] as const) {
      expect(kitchenCardTiming({ ...ticket, timing: { ...ticket.timing!, current: { stage, since: "2026-11-22T12:20:00+03:00" } } }, now).text).toBe(`${label} · 5 min`);
    }
  });

  it("highlights only the current wait once it reaches twenty minutes", () => {
    const old = { ...ticket, timing: { ...ticket.timing!, current: { stage: "preparation" as const, since: sent } } };
    expect(kitchenCardTiming(old, now).overdue).toBe(true);
    expect(kitchenCardTiming(ticket, now).overdue).toBe(false);
  });

  it("freezes total time on served cards even hours later", () => {
    const served = { ...ticket, status: "Served", timing: { ...ticket.timing!, current: null, finished_at: "2026-11-22T12:22:00+03:00" } };
    const expected = { text: "Served · 22 min", overdue: false };
    expect(kitchenCardTiming(served, now)).toEqual(expected);
    expect(kitchenCardTiming(served, new Date("2026-11-23T12:00:00Z"))).toEqual(expected);
  });

  it("does not invent clocks for legacy preparation states", () => {
    expect(kitchenCardTiming({ ...ticket, timing: undefined }, now).text).toBe("Awaiting service · Time not recorded");
    expect(kitchenCardTiming({ ...ticket, status: "Sent", timing: undefined }, now).text).toBe("Awaiting acceptance · 25 min");
    expect(kitchenCardTiming({ ...ticket, status: "Served", timing: undefined }, now).text).toBe("Served · Time not recorded");
  });

  it("handles invalid timestamps and clamps device-clock skew", () => {
    expect(kitchenCardTiming({ ...ticket, status: "Sent", sent_at: "bad", timing: undefined }, now).text).toContain("Time not recorded");
    expect(kitchenCardTiming(ticket, new Date(sent)).text).toBe("Awaiting service · 0 sec");
  });

  it("formats short waits and long shifts without wrapping minutes", () => {
    expect(kitchenDuration(15)).toBe("15 sec");
    expect(kitchenDuration(3660)).toBe("1 h 1 min");
    expect(kitchenDuration(null)).toBe("Time not recorded");
  });

  it("shows all four stages, batch ranges, quantities and a live total in details", () => {
    const html = renderToStaticMarkup(<KitchenTimings ticket={ticket} now={now} />);
    for (const text of ["Sent → Accepted", "Accepted → Preparing", "Preparing → Ready", "Ready → Served", "5 min – 15 min", "Awaiting service", "Total time since sent", "25 min", "Batch timings", "2", "Cup", "Tea", "recorded order"]) expect(html).toContain(text);
  });

  it("keeps completed stage durations fixed while the pending stage continues", () => {
    const later = renderToStaticMarkup(<KitchenTimings ticket={ticket} now={new Date("2026-11-22T12:30:00+03:00")} />);
    expect(later).toContain("5 min – 15 min");
    expect(later).toContain("10 min");
    expect(later).toContain("30 min");
  });

  it("never shows live ticket age as the total for closed tickets missing a finish time", () => {
    const html = renderToStaticMarkup(<KitchenTimings ticket={{ ...ticket, status: "Cancelled", timing: { ...ticket.timing!, current: null, stages: [] } }} now={now} />);
    expect(html).toContain("Sent → Closed");
    expect(html).not.toContain("25 min");
    expect(html).toContain("Time not recorded");
  });
});
