import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { KitchenRoutingPicker } from "../components/KitchenRoutingPicker";
import {
  kitchenRoutingComplete,
  parseKitchenRoutingIssue,
} from "../kitchenRouting";
import { addMenuItem, newOrderDraft } from "../orderDraft";
import { newSessionRound } from "../sessionDraft";
import type { KitchenRoutingIssue, RestaurantSessionDTO } from "../types";
import { createSessionRound } from "../../../services/vunaApi";

const issue: KitchenRoutingIssue = {
  items: [
    {
      item_code: "Tea",
      item_group: "Drinks",
      reason: "missing",
      candidates: [],
    },
  ],
  stations: [{ name: "KS-1", station_name: "Bar" }],
};

describe("temporary kitchen routing", () => {
  it("validates error metadata before rendering a picker", () => {
    expect(parseKitchenRoutingIssue(issue)).toEqual(issue);
    expect(
      parseKitchenRoutingIssue({ items: "<html>login</html>", stations: [] })
    ).toBeNull();
    expect(parseKitchenRoutingIssue({ ...issue, items: [null] })).toBeNull();
    expect(parseKitchenRoutingIssue({ ...issue, stations: [{}] })).toBeNull();
    expect(
      parseKitchenRoutingIssue({
        ...issue,
        items: [{ ...issue.items[0], reason: "unknown" }],
      })
    ).toBeNull();
  });
  it("requires a permitted station for every unresolved item", () => {
    expect(kitchenRoutingComplete(issue, {})).toBe(false);
    expect(kitchenRoutingComplete(issue, { Tea: "Foreign" })).toBe(false);
    expect(kitchenRoutingComplete(issue, { Tea: "KS-1" })).toBe(true);
  });
  it("renders a clear picker without altering permanent routing", () => {
    const html = renderToStaticMarkup(
      <KitchenRoutingPicker
        issue={issue}
        onConfirm={() => {}}
        onRetry={() => {}}
        onClose={() => {}}
      />
    );
    expect(html).toContain("Choose kitchen stations");
    expect(html).toContain("this round only");
    expect(html).toContain("Bar");
    expect(html).toContain("Use stations");
    expect(html).toContain("disabled");
  });
  it("explains when no stations are configured", () => {
    const html = renderToStaticMarkup(
      <KitchenRoutingPicker
        issue={{ ...issue, stations: [] }}
        onConfirm={() => {}}
        onRetry={() => {}}
        onClose={() => {}}
      />
    );
    expect(html).toContain("Ask a manager");
    expect(html).toContain("Check again");
  });
  it("does not carry temporary choices into the next round", () => {
    const initial = addMenuItem(
      newOrderDraft({
        pos_profile: "Till",
        service_type: "Takeaway",
        idempotency_key: "key",
      }),
      { item_code: "Tea", item_name: "Tea" },
      () => "line"
    );
    const current = { ...initial, kitchen_routing: { Tea: "KS-1" } };
    expect(current.kitchen_routing.Tea).toBe("KS-1");
    const session = {
      name: "RS-1",
      pos_profile: "Till",
      service_type: "Takeaway",
      customer: "Guest",
      customer_name: "Guest",
      guest_count: 0,
      tables: [],
    } as unknown as RestaurantSessionDTO;
    expect(newSessionRound(session, "next").kitchen_routing).toBeUndefined();
  });
  it("serializes overrides with the same retry key and items", async () => {
    let body: Record<string, unknown> = {};
    await createSessionRound(
      async (params) => {
        body = params;
        return { message: { ok: true, data: { name: "SO-1" } } };
      },
      {
        session: "RS-1",
        items: [{ line_id: "line", item_code: "Tea", qty: 1 }],
        idempotency_key: "retry",
        kitchen_routing: { Tea: "KS-1" },
      }
    );
    expect(body.idempotency_key).toBe("retry");
    expect(JSON.parse(body.kitchen_routing as string)).toEqual({ Tea: "KS-1" });
    expect(JSON.parse(body.items as string)[0].line_id).toBe("line");
  });
});
