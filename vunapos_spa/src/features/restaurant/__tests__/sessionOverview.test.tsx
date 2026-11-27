import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionScreen } from "../components/SessionScreen";
import { newSessionRound } from "../sessionDraft";
import { addMenuItem } from "../orderDraft";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import type { RestaurantSessionDTO } from "../types";

const mocks = vi.hoisted(() => ({ session: {} as RestaurantSessionDTO, menu: vi.fn(), refresh: vi.fn(), invoice: { items: [], totals: {} }, call: vi.fn() }));
vi.mock("frappe-react-sdk", () => ({ useFrappePostCall: () => ({ call: mocks.call }) }));
vi.mock("../../pos/hooks/useBootstrapData", () => ({ useBootstrapData: () => ({ data: { currency: "KES", restaurant: { service_types: [{ name: "Dine In", service_type_name: "Dine In", requires_table: true }] } } }) }));
vi.mock("../hooks/useFloorPlan", () => ({ useFloorPlan: () => ({ plan: { floors: [] } }) }));
vi.mock("../hooks/useOrderData", () => ({ useMenu: mocks.menu, useTableStatus: () => ({ data: [] }) }));
vi.mock("../hooks/usePolledData", () => ({ usePolledData: () => ({ data: mocks.session, refresh: mocks.refresh }) }));
vi.mock("../hooks/useRestaurantPricing", () => ({ useRestaurantPricing: () => ({ invoice: mocks.invoice, accept: vi.fn() }) }));
vi.mock("../../pos/components/SellingWorkspace", () => ({ SellingWorkspace: () => <div>Item catalogue workspace</div> }));
vi.mock("../../pos/components/CartPanel", () => ({ CartPanel: () => <div>Unplaced cart</div> }));
vi.mock("../components/SessionBill", () => ({ SessionBill: () => <button>View bill</button> }));
vi.mock("../components/CancelOrderItems", () => ({ CancelOrderItems: () => null }));
vi.mock("../components/KioskOrderBanner", () => ({ KioskOrderBanner: () => <div>Kiosk payment controls</div> }));
vi.mock("../components/QrOrderBanner", () => ({ QrOrderBanner: () => <div>QR acceptance controls</div> }));
vi.mock("../stores/orderDraftStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../stores/orderDraftStore")>();
  // Static rendering normally reads Zustand's initial state, not a prepared fixture.
  const hook = Object.assign((select: (state: ReturnType<typeof actual.useOrderDraftStore.getState>) => unknown) => select(actual.useOrderDraftStore.getState()), actual.useOrderDraftStore);
  return { ...actual, useOrderDraftStore: hook };
});

const session: RestaurantSessionDTO = {
  name: "RS-1", pos_profile: "Counter", restaurant: "Cafe", branch: "Town", company: "Company", service_type: "Dine In",
  customer: "Guest", customer_name: "Walk-in Guest", waiter: "waiter@example.com", waiter_name: "Jane Wanjiku", guest_count: 2,
  status: "Open", opened_at: "2026-11-22 12:00:00", modified: "now", tables: [{ table: "T-2", table_label: "2", released_at: null }],
  rounds: [{ name: "SO-1", status: "Open", restaurant_session: "RS-1", pos_profile: "Counter", service_type: "Dine In", table: "T-2", table_label: "2", customer: "Guest", customer_name: "Walk-in Guest", pax: 2, waiter: "waiter@example.com", waiter_name: "Jane Wanjiku", opened_at: "now", order_note: null, invoice_doctype: null, invoice: null, modified: "now", grand_total: 300,
    items: [{ line_id: "tea", item_code: "Tea", item_name: "Masala Tea", qty: 2, uom: "Cup", amount: 300, note: "No sugar", added_by: "waiter@example.com", added_at: "now" }] }],
};

describe("existing restaurant order entry", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
    mocks.session = session;
    mocks.menu.mockReset().mockReturnValue({ menu: null, isLoading: false });
    useOrderDraftStore.setState({ scope: null, draft: newSessionRound(session, "round-2"), pendingPlacement: null, storageError: null });
  });

  it("opens on expanded placed items, not the catalogue or an empty cart", () => {
    const html = renderToStaticMarkup(<SessionScreen sessionName="RS-1" posProfile="Counter" />);
    for (const text of ["Current order", "Table 2", "Masala Tea", "No sugar", "Cup", "Add items", "View bill", "Placed total", "Jane Wanjiku"]) expect(html).toContain(text);
    expect(html).not.toContain("Item catalogue workspace");
    expect(html).not.toContain("Unplaced cart");
    expect(mocks.menu.mock.calls[0][5]).toBe(false);
  });

  it("retains pending items and offers a clear way to continue the new round", () => {
    useOrderDraftStore.setState({ draft: addMenuItem(newSessionRound(session, "round-2"), { item_code: "Coffee", item_name: "Coffee" }, () => "coffee") });
    const html = renderToStaticMarkup(<SessionScreen sessionName="RS-1" posProfile="Counter" />);
    expect(html).toContain("Continue adding items (1)");
    expect(html).toContain("You have unplaced items");
    expect(useOrderDraftStore.getState().draft?.unsent[0].item_code).toBe("Coffee");
  });

  it("does not offer additions while an order is settling", () => {
    mocks.session = { ...session, status: "Settling" };
    const html = renderToStaticMarkup(<SessionScreen sessionName="RS-1" posProfile="Counter" />);
    expect(html).toContain("Masala Tea");
    expect(html).not.toContain(">Add items<");
  });

  it("keeps QR acceptance controls visible and blocks additions until accepted", () => {
    mocks.session = { ...session, order_source: "QR", qr_status: "Pending" };
    const html = renderToStaticMarkup(<SessionScreen sessionName="RS-1" posProfile="Counter" />);
    expect(html).toContain("QR acceptance controls");
    expect(html).not.toContain(">Add items<");
    expect(html).not.toContain("View bill");
  });
});
