import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { KioskOrderBanner } from "../components/KioskOrderBanner";
import type { RestaurantSessionDTO } from "../types";

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../../pos/hooks/useBootstrapData", () => ({ useBootstrapData: () => ({ data: state.data }) }));
vi.mock("frappe-react-sdk", () => ({ useFrappePostCall: () => ({ call: vi.fn() }) }));

const till = { pos_profile: "Till 1", restaurant: { require_manager_pin_order_cancel: false } };

const session = (kioskStatus: "Awaiting Payment" | "Sent to Kitchen") =>
  ({ name: "RS-2026-00041", order_number: 47, kiosk_status: kioskStatus }) as RestaurantSessionDTO;

describe("KioskOrderBanner", () => {
  const banner = (kioskStatus: "Awaiting Payment" | "Sent to Kitchen", rights: Record<string, boolean>) => {
    state.data = { ...till, ...rights };
    return renderToStaticMarkup(<KioskOrderBanner session={session(kioskStatus)} posProfile="Till 1" onChanged={vi.fn()} />);
  };

  it("lets a cashier confirm payment or cancel an order awaiting payment", () => {
    const html = banner("Awaiting Payment", { can_take_payment: true });
    expect(html).toContain("Kiosk order 47");
    expect(html).toContain("Awaiting payment");
    expect(html).toContain("Confirm payment");
    expect(html).toContain("Cancel order");
  });

  it("lets a manager cancel but not confirm, and a waiter do neither", () => {
    const manager = banner("Awaiting Payment", { can_manage_restaurant: true });
    expect(manager).not.toContain("Confirm payment");
    expect(manager).toContain("Cancel order");
    const waiter = banner("Awaiting Payment", {});
    expect(waiter).toContain("A cashier confirms the payment.");
    expect(waiter).not.toContain("Cancel order");
  });

  it("only labels an order already sent to the kitchen", () => {
    const html = banner("Sent to Kitchen", { can_take_payment: true });
    expect(html).toContain("Sent to kitchen");
    expect(html).not.toContain("Confirm payment");
  });
});
