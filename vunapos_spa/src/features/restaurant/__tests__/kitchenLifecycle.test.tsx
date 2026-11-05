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
  it("shows preparation context, elapsed time and controls without prices", () => {
    const html = renderToStaticMarkup(<KitchenTicketCard ticket={ticket} now={new Date("2026-11-05T10:25:00")} onOpen={() => {}} onChanged={() => {}} />);
    for (const text of ["Main Kitchen", "Table 1 + 2", "25", "No sugar", "Extra milk", "Allergy: nuts", "Accept"]) expect(html).toContain(text);
    expect(html).not.toContain("Grand total");
    expect(html).not.toContain("Mark ready");
  });

  it("renders only the server-permitted action for the current state", () => {
    const html = renderToStaticMarkup(<KitchenActions ticket={{ ...ticket, status: "Ready", available_actions: ["Serve"] }} onChanged={() => {}} />);
    expect(html).toContain("Mark served");
    expect(html).not.toContain("Accept");
    expect(html).not.toContain("Mark ready");
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
