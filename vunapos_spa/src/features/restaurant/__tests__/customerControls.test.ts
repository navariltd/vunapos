import { describe, expect, it } from "vitest";

import { restaurantCustomerControls } from "../customerControls";

describe("restaurant customer controls", () => {
  it("offers creation only when the POS Profile allows it", () => {
    expect(restaurantCustomerControls({ allowCreation: true, roundCount: 0, readOnly: false })).toEqual({
      disabled: false,
      allowCreate: true,
    });
    expect(restaurantCustomerControls({ allowCreation: false, roundCount: 0, readOnly: false })).toEqual({
      disabled: false,
      allowCreate: false,
    });
  });

  it("locks choosing and creating once the first round is placed", () => {
    expect(restaurantCustomerControls({ allowCreation: true, roundCount: 1, readOnly: false })).toEqual({
      disabled: true,
      allowCreate: false,
    });
  });

  it("locks the customer while the order is read-only", () => {
    expect(restaurantCustomerControls({ allowCreation: true, roundCount: 0, readOnly: true }).allowCreate).toBe(false);
  });
});
