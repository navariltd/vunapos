import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("frappe-react-sdk", () => ({
  useFrappeGetCall: () => ({ data: undefined, error: undefined, isLoading: false, mutate: vi.fn() }),
  useFrappePostCall: () => ({ call: vi.fn() }),
}));

import { CustomersPage } from "../CustomersPage";
import { openCustomerFromSheet } from "../customerCreation";

describe("Customers page customer creation", () => {
  it("shows New customer only when the profile allows customer creation", () => {
    expect(renderToStaticMarkup(<CustomersPage posProfile="Nairobi" allowCustomerCreation />)).toContain("New customer");
    expect(renderToStaticMarkup(<CustomersPage posProfile="Nairobi" allowCustomerCreation={false} />)).not.toContain(
      "New customer",
    );
    expect(renderToStaticMarkup(<CustomersPage posProfile="Nairobi" />)).not.toContain("New customer");
  });

  it("opens the saved customer, or the existing one used instead, and reloads the list", () => {
    const refresh = vi.fn();
    const open = vi.fn();

    openCustomerFromSheet({ customer: "CUST-0042" }, refresh, open);

    expect(refresh).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith("CUST-0042");
  });
});
