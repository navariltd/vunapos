import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BottomNav, Sidebar } from "../Sidebar";

afterEach(() => vi.unstubAllGlobals());

describe("restaurant navigation layout", () => {
  it("renders Close Shift after Customers and before Collapse, matching retail", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
    for (const mode of ["Retail", "Restaurant"] as const) {
      const html = renderToStaticMarkup(<Sidebar mode={mode} features={{ canTakePayment: true }} />);
      expect(html.indexOf(">Customers<")).toBeLessThan(html.indexOf(">Close Shift<"));
      expect(html.indexOf(">Close Shift<")).toBeLessThan(html.indexOf(">Collapse<"));
    }
  });
  it("renders Floor after Collapse and before the user profile", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
    const html = renderToStaticMarkup(
      <Sidebar
        mode="Restaurant"
        cashier="Waiter One"
        features={{ canTakePayment: false }}
      />
    );
    expect(html).toContain("Sales History");
    expect(html).toContain(">Open Orders<");
    expect(html.indexOf(">Collapse<")).toBeLessThan(html.indexOf(">Floor<"));
    expect(html.indexOf(">Floor<")).toBeLessThan(html.indexOf("Waiter One"));
    expect(html).not.toContain("Close Shift");
  });

  it("keeps a maximum of five mobile destinations with More for secondary pages", () => {
    const html = renderToStaticMarkup(
      <BottomNav mode="Restaurant" features={{ canTakePayment: true }} />
    );
    expect(html).toContain(">More<");
    expect(html).toContain(">Open Orders<");
    expect(html).toContain("repeat(5, minmax(0, 1fr))");
    expect(html).toContain("/vunapos/invoices");
    expect(html).not.toContain("/vunapos/floor");
  });
});
