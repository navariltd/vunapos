import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { SharedRestaurantPages } from "../components/SharedRestaurantPages";
import type { BootstrapData } from "../../pos/types";
import { useConnectivityStore } from "../../../lib/stores/connectivityStore";

const mocks = vi.hoisted(() => ({
  history: vi.fn<(props: unknown) => ReactElement>(() => (
    <div>Sales history</div>
  )),
  invoice: vi.fn<(props: unknown) => ReactElement>(() => (
    <div>Invoice detail</div>
  )),
  payments: vi.fn<(props: unknown) => ReactElement>(() => <div>Payments</div>),
  customers: vi.fn<(props: unknown) => ReactElement>(() => (
    <div>Customers</div>
  )),
  customer: vi.fn<(props: unknown) => ReactElement>(() => (
    <div>Customer detail</div>
  )),
  get: vi.fn(),
}));
vi.mock("frappe-react-sdk", () => ({ useFrappeGetCall: mocks.get }));
vi.mock("../../pos/components/InvoicesPage", () => ({
  InvoicesPage: mocks.history,
}));
vi.mock("../../pos/components/InvoiceDetailsPage", () => ({
  InvoiceDetailsPage: mocks.invoice,
}));
vi.mock("../../payments/PaymentsPage", () => ({
  PaymentsPage: mocks.payments,
}));
vi.mock("../../customers/CustomersPage", () => ({
  CustomersPage: mocks.customers,
}));
vi.mock("../../customers/CustomerDetailsPage", () => ({
  CustomerDetailsPage: mocks.customer,
}));

const bootstrap = {
  pos_profile: "Restaurant Till",
  currency: "KES",
  modes_of_payment: [{ mode_of_payment: "Cash" }],
  allow_returns: false,
  allow_payment_reconciliation: false,
} as BootstrapData;

describe("restaurant shared pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("navigator", { onLine: true });
    useConnectivityStore.setState({ state: "reachable" });
    mocks.get.mockReturnValue({
      data: { message: { ok: true, data: [] } },
      isLoading: false,
    });
  });

  it("opens shared Sales History with profile-scoped draft loading", () => {
    expect(
      renderToStaticMarkup(
        <SharedRestaurantPages
          page="Invoices"
          path="/vunapos/invoices"
          bootstrap={bootstrap}
        />
      )
    ).toContain("Sales history");
    expect(mocks.get.mock.calls[0][1]).toEqual({
      pos_profile: "Restaurant Till",
    });
    expect(mocks.history.mock.calls[0][0]).toMatchObject({
      posProfile: "Restaurant Till",
      heldInvoices: [],
    });
  });

  it("opens invoice detail URLs without initializing a retail cart", () => {
    renderToStaticMarkup(
      <SharedRestaurantPages
        page="Invoices"
        path="/vunapos/invoices/SINV-1"
        bootstrap={bootstrap}
      />
    );
    expect(mocks.invoice.mock.calls[0][0]).toMatchObject({
      invoice: "SINV-1",
      allowReturns: false,
      posProfile: "Restaurant Till",
    });
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("passes payment configuration and connectivity to the existing page", () => {
    useConnectivityStore.setState({ state: "unreachable" });
    renderToStaticMarkup(
      <SharedRestaurantPages
        page="Payments"
        path="/vunapos/payments"
        bootstrap={bootstrap}
      />
    );
    expect(mocks.payments.mock.calls[0][0]).toMatchObject({
      posProfile: "Restaurant Till",
      isOnline: false,
      allowReconciliation: false,
      paymentModes: bootstrap.modes_of_payment,
    });
  });

  it("opens both customer list and customer detail URLs", () => {
    renderToStaticMarkup(
      <SharedRestaurantPages
        page="Customers"
        path="/vunapos/customers"
        bootstrap={bootstrap}
      />
    );
    renderToStaticMarkup(
      <SharedRestaurantPages
        page="Customers"
        path="/vunapos/customers/Factory%20Depot"
        bootstrap={bootstrap}
      />
    );
    expect(mocks.customers).toHaveBeenCalled();
    expect(mocks.customer.mock.calls[0][0]).toMatchObject({
      customer: "Factory Depot",
      posProfile: "Restaurant Till",
    });
  });

  it("shows malformed draft response errors rather than an empty success", () => {
    mocks.get.mockReturnValue({
      data: { message: { ok: false, errors: [{ message: "Not permitted" }] } },
      isLoading: false,
    });
    expect(
      renderToStaticMarkup(
        <SharedRestaurantPages
          page="Invoices"
          path="/vunapos/invoices"
          bootstrap={bootstrap}
        />
      )
    ).toContain("Not permitted");
  });
});
