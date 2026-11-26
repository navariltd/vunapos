import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KitchenTicketCard } from "../components/KitchenPage";
import { KitchenActions } from "../components/KitchenActions";
import { KITCHEN_ACTION_LABELS, kitchenStatusClass } from "../kitchenStatus";
import { isKitchenOnlyUser, isRestaurantPageAllowed, restaurantRoleLabel } from "../restaurantRoles";
import { isExpiredRestaurantSession } from "../hooks/usePolledData";
import { cancelKitchenOrder, kitchenAction, VunaApiError } from "../../../services/vunaApi";
import type { KitchenTicketDTO } from "../types";

vi.mock("frappe-react-sdk", () => ({ useFrappePostCall: () => ({ call: vi.fn() }), useFrappeGetCall: () => ({}), useFrappeDocumentEventListener: vi.fn(), useFrappeEventListener: vi.fn() }));

const ticket: KitchenTicketDTO = {
  name: "KOT-1", kitchen_station: "KS-1", station_label: "Main Kitchen", sales_order: "SO-1", restaurant_session: "Visit-1",
  status: "Sent", sent_at: "2026-11-05 10:00:00", sent_by: "waiter@example.com", waiter: "Waiter", table_labels: "1 + 2", order_note: "Allergy: nuts", available_actions: ["Accept"],
  items: [{ line_id: "dish", item_code: "Tea", item_name: "Tea", qty: 2, uom: "Cup", stock_qty: 2, stock_uom: "Cup", note: "No sugar", modifiers: [{ label: "Extra milk" }], temporary_routing: false }],
};

describe("kitchen display", () => {
  it("labels the current-stage timer instead of displaying total ticket age", () => {
    const ready: KitchenTicketDTO = { ...ticket, status: "Ready", timing: { sent_at: "2026-11-05T10:00:00Z", current: { stage: "service", since: "2026-11-05T10:20:00Z" }, finished_at: null } };
    const html = renderToStaticMarkup(<KitchenTicketCard ticket={ready} now={new Date("2026-11-05T10:25:00Z")} onOpen={() => {}} onChanged={() => {}} />);
    expect(html).toContain("Awaiting service · 5 min");
    expect(html).not.toContain("25 min");
    expect(html).not.toContain("font-semibold text-error");
  });
  it("shows the waiter's full name instead of the user email", () => {
    const html = renderToStaticMarkup(<KitchenTicketCard ticket={{ ...ticket, waiter: "waiter@example.com", waiter_name: "Jane Wanjiku" }} now={new Date()} onOpen={() => {}} onChanged={() => {}} />);
    expect(html).toContain("Waiter: Jane Wanjiku");
    expect(html).not.toContain("waiter@example.com");
  });

  it("highlights acceptance with the existing primary accent without changing other ticket actions", () => {
    const accept = renderToStaticMarkup(<KitchenActions ticket={ticket} onChanged={() => {}} />);
    expect(accept).toContain("bg-primary text-on-primary");
    const start = renderToStaticMarkup(<KitchenActions ticket={{ ...ticket, available_actions: ["Start"] }} onChanged={() => {}} />);
    expect(start).toContain("bg-surface-container text-on-surface");
    expect(start).not.toContain("bg-primary text-on-primary");
  });

  it("accepts and starts the whole ticket without per-dish quantity inputs", () => {
    for (const action of ["Accept", "Start"] as const) {
      const current = { ...ticket, modified: "version", available_actions: [action], items: [
        { ...ticket.items[0], qty: 4, available_quantities: { [action]: 4 } },
      ] };
      const html = renderToStaticMarkup(<KitchenTicketCard ticket={current} now={new Date()} onOpen={() => {}} onChanged={() => {}} />);
      expect(html).toContain(action === "Accept" ? "Accept ticket" : "Start preparing");
      expect(html).not.toContain('type="number"');
      expect(html).not.toContain(`${action} Tea`);
    }
  });

  it("finishes accepting a legacy partially accepted ticket before offering Start", () => {
    const current = { ...ticket, modified: "version", available_actions: ["Accept", "Start"] as KitchenTicketDTO["available_actions"], items: [
      { ...ticket.items[0], qty: 4, available_quantities: { Accept: 2, Start: 2 } },
    ] };
    const html = renderToStaticMarkup(<KitchenTicketCard ticket={current} now={new Date()} onOpen={() => {}} onChanged={() => {}} />);
    expect(html).toContain("Accept ticket");
    expect(html).not.toContain("Start preparing");
    expect(html).not.toContain('type="number"');
  });

  it("offers partial quantities without removing one-click bulk actions", () => {
    const partial = { ...ticket, modified: "2026-11-13 10:00:00.123456", status: "Preparing", available_actions: ["Ready", "Serve"] as const,
      items: [{ ...ticket.items[0], accepted_qty: 2, preparing_qty: 1, ready_to_serve_qty: 1, available_quantities: { Ready: 1, Serve: 1 } }] };
    const html = renderToStaticMarkup(<KitchenTicketCard ticket={{ ...partial, available_actions: [...partial.available_actions] }} now={new Date()} onOpen={() => {}} onChanged={() => {}} />);
    for (const text of ["Ready all", "Serve all", "Ready Tea", "Served Tea", "type=\"number\"", "max=\"1\"", "1 preparing", "1 ready to serve"]) expect(html).toContain(text);
    expect(html).not.toContain("Choose quantities");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("Correct served quantity");
  });

  it("shows preparation context, elapsed time and controls without prices", () => {
    const html = renderToStaticMarkup(<KitchenTicketCard ticket={ticket} now={new Date("2026-11-05T10:25:00")} onOpen={() => {}} onChanged={() => {}} />);
    for (const text of ["Main Kitchen", "Table 1 + 2", "25", "No sugar", "Extra milk", "Allergy: nuts", "Accept"]) expect(html).toContain(text);
    expect(html).not.toContain("Grand total");
    expect(html).not.toContain("Mark ready");
  });

  it("renders only the server-permitted action for the current state", () => {
    const html = renderToStaticMarkup(<KitchenActions ticket={{ ...ticket, status: "Ready", available_actions: ["Serve"] }} onChanged={() => {}} />);
    expect(html).toContain("Serve all");
    expect(html).not.toContain("Accept");
    expect(html).not.toContain("Mark ready");
  });

  it("keeps corrections off the live board and exposes them in ticket details only", () => {
    const completed = { ...ticket, status: "Served", available_actions: ["Undo Serve"] as KitchenTicketDTO["available_actions"] };
    const board = renderToStaticMarkup(<KitchenTicketCard ticket={completed} now={new Date()} onOpen={() => {}} onChanged={() => {}} />);
    expect(board).not.toContain("Correct served quantity");
    const details = renderToStaticMarkup(<KitchenActions ticket={completed} onChanged={() => {}} />);
    expect(details).toContain("Correct served quantity");
  });

  it("never gives add-ons their own quantity actions or offers quantities unavailable on that line", () => {
    const mixed = { ...ticket, modified: "version", available_actions: ["Ready"] as KitchenTicketDTO["available_actions"], items: [
      { ...ticket.items[0], available_quantities: { Ready: 2 } },
      { ...ticket.items[0], line_id: "other", item_name: "Coffee", available_quantities: { Ready: 0 } },
      { ...ticket.items[0], line_id: "addon", parent_line_id: "dish", item_name: "Milk", available_quantities: { Ready: 2 } },
    ] };
    const html = renderToStaticMarkup(<KitchenTicketCard ticket={mixed} now={new Date()} onOpen={() => {}} onChanged={() => {}} />);
    expect(html).toContain("Ready Tea");
    expect(html).not.toContain("Ready Coffee");
    expect(html).not.toContain("Ready Milk");
    expect(html).toContain('value="2"');
  });

  it("has distinct status colors and clear native-manufacture action labels", () => {
    expect(kitchenStatusClass("Preparing")).not.toBe(kitchenStatusClass("Ready"));
    expect(kitchenStatusClass("Cancelled")).toContain("error");
    expect(KITCHEN_ACTION_LABELS.Start).toBe("Start preparing");
  });

  it("routes kitchen-only users to kitchen/profile, without restricting combined roles", () => {
    expect(isKitchenOnlyUser(["VunaPOS Kitchen User"])).toBe(true);
    expect(isKitchenOnlyUser(["VunaPOS Kitchen User", "VunaPOS Waiter"])).toBe(false);
    expect(isKitchenOnlyUser(["VunaPOS Kitchen User"], true)).toBe(false);
    expect(restaurantRoleLabel(["VunaPOS Kitchen User"])).toBe("Kitchen");
    expect(isRestaurantPageAllowed("Kitchen", false, { kitchenOnly: true })).toBe(true);
    expect(isRestaurantPageAllowed("Home", false, { kitchenOnly: true })).toBe(false);
  });

  it("identifies expired authentication so protected polling can stop", () => {
    expect(isExpiredRestaurantSession(new VunaApiError("Sign in", "HTTP_401"))).toBe(true);
    expect(isExpiredRestaurantSession({ httpStatus: 401 })).toBe(true);
    expect(isExpiredRestaurantSession(new Error("Temporary network error"))).toBe(false);
  });

  it("sends stable retry keys and expected state without accepting production inputs", async () => {
    const call = vi.fn().mockResolvedValue({ message: { ok: true, data: ticket } });
    await kitchenAction(call, { ticket: "KOT-1", action: "Ready", request_key: "retry", expected_status: "Preparing" });
    expect(call).toHaveBeenCalledWith({ ticket: "KOT-1", action: "Ready", request_key: "retry", expected_status: "Preparing" });
    await cancelKitchenOrder(call, { ticket: "KOT-1", request_key: "cancel-key", expected_status: "Sent", reason: "Customer left", manager_pin_token: "approval" });
    expect(call.mock.lastCall?.[0]).toMatchObject({ reason: "Customer left", manager_pin_token: "approval" });
  });
});
