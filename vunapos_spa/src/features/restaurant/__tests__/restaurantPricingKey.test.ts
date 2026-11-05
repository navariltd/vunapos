import { describe, expect, it } from "vitest";
import { addMenuItem, newOrderDraft } from "../orderDraft";
import { restaurantPricingKey } from "../hooks/useRestaurantPricing";

const draft = addMenuItem(
  newOrderDraft({
    pos_profile: "Till",
    service_type: "Takeaway",
    customer: "Guest",
    idempotency_key: "order-key",
  }),
  { item_code: "Tea", item_name: "Tea", uom: "Cup" },
  () => "tea-line"
);

describe("restaurant pricing response identity", () => {
  it("does not reuse another customer, service type, UOM or quantity preview", () => {
    const key = restaurantPricingKey(draft, "Retail");
    expect(
      restaurantPricingKey(
        { ...draft, header: { ...draft.header, customer: "Depot" } },
        "Retail"
      )
    ).not.toBe(key);
    expect(
      restaurantPricingKey({ ...draft, service_type: "Dine In" }, "Retail")
    ).not.toBe(key);
    expect(
      restaurantPricingKey(
        { ...draft, unsent: [{ ...draft.unsent[0], uom: "Pot" }] },
        "Retail"
      )
    ).not.toBe(key);
    expect(
      restaurantPricingKey(
        { ...draft, unsent: [{ ...draft.unsent[0], qty: 3 }] },
        "Retail"
      )
    ).not.toBe(key);
    expect(restaurantPricingKey(draft, "Wholesale")).not.toBe(key);
  });

  it("invalidates cached prices when catalogue or tax configuration changes", () => {
    expect(restaurantPricingKey(draft, "Retail", "old-prices")).not.toBe(
      restaurantPricingKey(draft, "Retail", "new-prices")
    );
    expect(
      restaurantPricingKey({ ...draft, idempotency_key: "new-order" }, "Retail")
    ).not.toBe(restaurantPricingKey(draft, "Retail"));
  });
});
