import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { KioskApp } from "../KioskApp";

const state = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock("../../pos/hooks/useBootstrapData", () => ({ useBootstrapData: () => ({ data: state.data }) }));
vi.mock("frappe-react-sdk", () => ({
  useFrappePostCall: () => ({ call: vi.fn(() => new Promise(() => undefined)) }),
  useFrappeAuth: () => ({ logout: vi.fn() }),
}));
vi.mock("../../restaurant/hooks/useOrderData", () => ({
  useMenu: () => ({ menu: null, error: null, isLoading: false, reload: vi.fn() }),
}));

const kioskProfile = {
  pos_profile: "Kiosk 1",
  pos_mode: "Restaurant",
  currency: "KES",
  restaurant: {
    restaurant_name: "Golden Echo",
    service_types: [],
    allow_multiple_orders_per_table: false,
    require_manager_pin_order_cancel: false,
    kiosk_mode: true,
    kiosk_payment_timing: "Pay at the counter first",
    kiosk_idle_seconds: 90,
  },
};

describe("KioskApp", () => {
  it("opens on the service choice under the restaurant name, with no navigation", () => {
    state.data = kioskProfile;
    const html = renderToStaticMarkup(<KioskApp />);
    expect(html).not.toContain("Tap to order");
    expect(html).toContain('id="kiosk-service-title"');
    expect(html).toContain("Golden Echo");
    expect(html).toContain("Getting ready");
    expect(html).not.toContain("Start over");
    expect(html).not.toContain("Open Orders");
  });

  it("explains a login whose profile is not a kiosk", () => {
    state.data = { ...kioskProfile, restaurant: { ...kioskProfile.restaurant, kiosk_mode: false } };
    expect(renderToStaticMarkup(<KioskApp />)).toContain("This kiosk is not set up");
  });
});
