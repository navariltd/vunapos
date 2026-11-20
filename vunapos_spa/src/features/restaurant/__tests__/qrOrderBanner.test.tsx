import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { QrOrderBanner } from "../components/QrOrderBanner";
import type { RestaurantSessionDTO } from "../types";

vi.mock("frappe-react-sdk", () => ({ useFrappePostCall: () => ({ call: vi.fn() }) }));

const session = (qrStatus: "Pending" | "Accepted") =>
  ({
    name: "RS-2026-00052",
    order_source: "QR",
    qr_status: qrStatus,
    status: "Open",
    tables: [{ table: "tbl-7", table_label: "7", released_at: null }],
    rounds: [
      {
        name: "SO-0002",
        items: [
          { line_id: "a", item_code: "BURGER", item_name: "Burger", qty: 2, uom: "Nos", note: "No onions", modifiers: [{ label: "Well done" }] },
          { line_id: "b", item_code: "CHEESE", item_name: "Extra cheese", qty: 2, uom: "Nos", note: null, parent_line_id: "a" },
        ],
      },
    ],
  }) as unknown as RestaurantSessionDTO;

describe("QrOrderBanner", () => {
  it("shows a pending order's items with Accept before Reject", () => {
    const html = renderToStaticMarkup(<QrOrderBanner session={session("Pending")} posProfile="Till 1" onChanged={vi.fn()} />);
    expect(html).toContain("New QR order");
    expect(html).toContain("A guest at table 7 sent this order");
    expect(html).toContain("2 × Burger");
    expect(html).toContain("Well done");
    expect(html).toContain("No onions");
    // Add-ons sit under their dish.
    expect(html).toMatch(/class="pl-5[^"]*">2 × Extra cheese/);
    expect(html.indexOf(">Accept<")).toBeGreaterThan(-1);
    expect(html.indexOf(">Accept<")).toBeLessThan(html.indexOf(">Reject<"));
  });

  it("only labels an accepted order", () => {
    const html = renderToStaticMarkup(<QrOrderBanner session={session("Accepted")} posProfile="Till 1" onChanged={vi.fn()} />);
    expect(html).toContain("QR order");
    expect(html).toContain("Accepted");
    expect(html).not.toContain(">Accept<");
    expect(html).not.toContain("Extra cheese");
  });
});
