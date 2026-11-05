import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KitchenTicketSheet } from "../components/KitchenTicketSheet";

const sdk = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("frappe-react-sdk", () => ({ useFrappeGetCall: sdk.get }));

describe("read-only kitchen ticket", () => {
  beforeEach(() => vi.clearAllMocks());
  it("shows preparation instructions, quantities and add-ons without financial controls", () => {
    sdk.get.mockReturnValue({
      data: {
        message: {
          ok: true,
          data: {
            name: "KOT-1",
            station_label: "Main Kitchen",
            status: "Sent",
            sales_order: "SO-1",
            service_type: "Dine In",
            table_labels: "1, 2",
            sent_at: "2026-11-04 12:30:00",
            sent_by: "waiter@example.com",
            order_note: "Allergy: nuts",
            items: [
              {
                line_id: "dish",
                item_name: "Tea",
                qty: 2,
                uom: "Box",
                stock_qty: 48,
                stock_uom: "Pcs",
                note: "No sugar",
                modifiers: [{ label: "Extra milk" }],
                temporary_routing: true,
              },
              {
                line_id: "extra",
                parent_line_id: "dish",
                item_name: "Milk",
                qty: 2,
                uom: "Cup",
                stock_qty: 2,
                stock_uom: "Cup",
                modifiers: [],
                temporary_routing: true,
              },
            ],
          },
        },
      },
    });
    const html = renderToStaticMarkup(
      <KitchenTicketSheet name="KOT-1" onClose={() => {}} />
    );
    expect(html).toContain("Main Kitchen");
    expect(html).toContain("Tables: 1, 2");
    expect(html).toContain("No sugar");
    expect(html).toContain("Extra milk");
    expect(html).toContain("48 Pcs");
    expect(html).toContain("Add-on");
    expect(html).toContain("Temporary station selection");
    expect(html).not.toContain("Grand total");
  });
  it("handles error envelopes and HTML responses safely", () => {
    sdk.get.mockReturnValue({
      data: {
        message: {
          ok: false,
          errors: [{ code: "PermissionError", message: "Not permitted" }],
        },
      },
    });
    expect(
      renderToStaticMarkup(
        <KitchenTicketSheet name="KOT-1" onClose={() => {}} />
      )
    ).toContain("Not permitted");
    sdk.get.mockReturnValue({ data: "<html>Login</html>" });
    const html = renderToStaticMarkup(
      <KitchenTicketSheet name="KOT-1" onClose={() => {}} />
    );
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Loading kitchen ticket");
  });
});
