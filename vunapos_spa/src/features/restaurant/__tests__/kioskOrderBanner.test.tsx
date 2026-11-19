import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { KioskOrderBanner } from "../components/KioskOrderBanner";
import type { RestaurantSessionDTO } from "../types";

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../../pos/hooks/useBootstrapData", () => ({ useBootstrapData: () => ({ data: state.data }) }));
vi.mock("frappe-react-sdk", () => ({ useFrappePostCall: () => ({ call: vi.fn() }) }));

const till = { pos_profile: "Till 1", restaurant: { require_manager_pin_order_cancel: false } };

type Status = "Awaiting Payment" | "Paid" | "Sent to Kitchen";

const session = (kioskStatus: Status, released: string | null = null) =>
  ({
    name: "RS-2026-00041",
    order_number: 47,
    kiosk_status: kioskStatus,
    status: "Open",
    rounds: [{ name: "SO-0001", status: "Draft" }],
    tables: [{ table: "tbl-4", table_label: "4", released_at: released }],
  }) as unknown as RestaurantSessionDTO;

describe("KioskOrderBanner", () => {
  const banner = (kioskStatus: Status, rights: Record<string, unknown>, released: string | null = null) => {
    state.data = { ...till, ...rights };
    return renderToStaticMarkup(
      <KioskOrderBanner session={session(kioskStatus, released)} posProfile="Till 1" onChanged={vi.fn()} />,
    );
  };

  it("shows a cashier Confirm payment first, then Cancel order, on an order awaiting payment", () => {
    const html = banner("Awaiting Payment", { can_take_payment: true });
    expect(html).toContain("Kiosk order 47");
    expect(html).toContain("Awaiting payment");
    expect(html).toContain("Confirm payment takes the payment");
    expect(html.indexOf(">Confirm payment<")).toBeGreaterThan(-1);
    expect(html.indexOf(">Confirm payment<")).toBeLessThan(html.indexOf(">Cancel order<"));
  });

  it("lets a manager cancel, and a waiter neither take the payment nor cancel", () => {
    const manager = banner("Awaiting Payment", { can_manage_restaurant: true });
    expect(manager).toContain("A cashier takes the payment.");
    expect(manager).toContain("Cancel order");
    expect(manager).not.toContain(">Confirm payment<");
    const waiter = banner("Awaiting Payment", {});
    expect(waiter).toContain("A cashier takes the payment.");
    expect(waiter).not.toContain("Cancel order");
  });

  it("offers Clear table on a paid order still holding its table", () => {
    const html = banner("Paid", { restaurant_roles: ["VunaPOS Waiter"] });
    expect(html).toContain("Paid");
    expect(html).toContain("Clear table");
    expect(banner("Paid", { restaurant_roles: ["VunaPOS Kitchen User"] })).not.toContain("Clear table");
    expect(banner("Paid", { restaurant_roles: ["VunaPOS Waiter"] }, "2026-11-17 15:00:00")).not.toContain(
      "Clear table",
    );
  });

  it("only labels an order already sent to the kitchen", () => {
    const html = banner("Sent to Kitchen", { can_take_payment: true });
    expect(html).toContain("Sent to kitchen");
    expect(html).not.toContain("Cancel order");
    expect(html).not.toContain("Clear table");
  });
});
