// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { POSHomePage } from "../POSHomePage";
import { useCartStore } from "../stores/cartStore";
import type {
  BootstrapData,
  CustomerAddressDTO,
} from "../types";

const { apiCall, fetchAddresses, commits } = vi.hoisted(() => ({
  apiCall: vi.fn(),
  fetchAddresses: vi.fn(),
  commits: vi.fn(),
}));

vi.mock("frappe-react-sdk", () => ({
  useFrappePostCall: () => ({
    call: apiCall,
    loading: false,
  }),
}));

vi.mock("../../../services/vunaApi", async (importOriginal) => ({
  ...await importOriginal<
    typeof import("../../../services/vunaApi")
  >(),
  getCustomerAddresses: fetchAddresses,
}));

vi.mock("../hooks/useBootstrapData", () => ({
  useBootstrapData: () => ({
    data: null,
    error: null,
    isLoading: false,
    reload: vi.fn(),
  }),
}));

vi.mock("../hooks/useCartActions", () => ({
  useCartActions: () => ({
    listHeld: async () => [],
  }),
}));

vi.mock("../hooks/useConnectivity", () => ({
  useConnectivity: () => ({ isReachable: true }),
}));

vi.mock("../hooks/useHeldInvoicesView", () => ({
  useHeldInvoicesView: () => [],
}));

vi.mock("../hooks/useItemSearch", () => ({
  useItemSearch: () => ({
    items: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../hooks/useGatewayPayments", () => ({
  useGatewayPayments: () => ({}),
}));

vi.mock("../hooks/useConfigurationRealtime", () => ({
  useConfigurationRealtime: vi.fn(),
}));

vi.mock("../hooks/useCheckoutQueueRealtime", () => ({
  useCheckoutQueueRealtime: vi.fn(),
}));

vi.mock("../hooks/useCustomerLoyalty", () => ({
  useCustomerLoyalty: () => ({
    data: null,
    error: null,
    isLoading: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("../../../lib/stores/navigationStore", () => {
  const state = {
    activePage: "Home",
    currentPath: "/vunapos",
    setActivePage: vi.fn(),
  };

  return {
    useNavigationStore: (
      selector: (value: typeof state) => unknown,
    ) => selector(state),
    navigateToPosPage: vi.fn(),
    getCustomerFromPath: vi.fn(),
    getInvoiceFromPath: vi.fn(),
    getInvoiceDoctypeFromPath: vi.fn(),
  };
});

vi.mock("../utils", () => ({
  normalizeDefaultCustomer: () => null,
  getPaymentModes: () => [],
  getInvoiceTotal: () => 0,
}));

vi.mock("../components/SellingWorkspace", () => ({
  SellingWorkspace: ({ children }: { children: ReactNode }) =>
    children,
}));

vi.mock("../components/CartPanel", () => ({
  CartPanel: () => null,
}));

vi.mock("../components/CheckoutDialog", async () => {
  const { useLayoutEffect } = await import("react");

  return {
    CheckoutDialog: function CheckoutDialog(props: {
      customer?: { customer: string } | null;
      posProfile?: string;
      customerAddresses: CustomerAddressDTO[];
      customerAddressesLoading: boolean;
      shippingAddressName: string;
    }) {
      useLayoutEffect(() => {
        commits({
          customer: props.customer?.customer,
          profile: props.posProfile,
          addresses: props.customerAddresses.map(
            (address) => address.name,
          ),
          loading: props.customerAddressesLoading,
          shippingAddress: props.shippingAddressName,
        });
      });

      return null;
    },
  };
});

vi.mock("../components/ManagerPinDialog", () => ({
  ManagerPinDialog: () => null,
}));

vi.mock("../components/SalespersonPinLock", () => ({
  SalespersonPinLock: () => null,
}));

vi.mock("../components/VariantPickerDialog", () => ({
  VariantPickerDialog: () => null,
}));

vi.mock("../components/ProductBundleDialog", () => ({
  ProductBundleDialog: () => null,
}));

vi.mock("../components/BarcodeScannerDialog", () => ({
  BarcodeScannerDialog: () => null,
}));

vi.mock("../components/CloseShiftPage", () => ({
  CloseShiftPage: () => null,
}));

vi.mock("../components/InvoicesPage", () => ({
  InvoicesPage: () => null,
}));

vi.mock("../components/InvoiceDetailsPage", () => ({
  InvoiceDetailsPage: () => null,
}));

vi.mock("../components/UserProfilePage", () => ({
  UserProfilePage: () => null,
}));

vi.mock("../../customers/CustomersPage", () => ({
  CustomersPage: () => null,
}));

vi.mock("../../customers/CustomerDetailsPage", () => ({
  CustomerDetailsPage: () => null,
}));

vi.mock("../../payments/PaymentsPage", () => ({
  PaymentsPage: () => null,
}));

vi.mock("../../../components/ui/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

function deferredAddresses() {
  let resolve!: (addresses: CustomerAddressDTO[]) => void;

  const promise = new Promise<CustomerAddressDTO[]>((done) => {
    resolve = done;
  });

  return { promise, resolve };
}

function address(
  customer: string,
  name: string,
): CustomerAddressDTO {
  return { customer, name, is_default: true };
}

describe("POSHomePage customer address isolation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    fetchAddresses.mockReset();
    commits.mockClear();

    useCartStore.setState(
      useCartStore.getInitialState(),
      true,
    );

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();

    useCartStore.setState(
      useCartStore.getInitialState(),
      true,
    );

    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  function renderPage(profile = "Profile-A") {
    act(() => {
      root.render(
        <POSHomePage
          bootstrap={{
            data: { pos_profile: profile } as BootstrapData,
            error: null,
            isLoading: false,
            reload: vi.fn(),
          }}
        />,
      );
    });
  }

  function selectCustomer(customer: string) {
    act(() => {
      useCartStore.getState().setSelectedCustomer({
        customer,
        customer_name: customer,
      });
    });
  }

  function latestCommit() {
    return commits.mock.lastCall?.[0];
  }

  async function finishRequest(
    request: ReturnType<typeof deferredAddresses>,
    addresses: CustomerAddressDTO[],
  ) {
    await act(async () => {
      request.resolve(addresses);
      await request.promise;
    });
  }

  it("clears the previous shipping selection before children commit for another customer", async () => {
    const first = deferredAddresses();
    const second = deferredAddresses();

    fetchAddresses
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    selectCustomer("Customer-A");
    renderPage();

    await finishRequest(first, [
      address("Customer-A", "Address-A"),
    ]);

    expect(latestCommit()).toMatchObject({
      addresses: ["Address-A"],
      shippingAddress: "Address-A",
      loading: false,
    });

    commits.mockClear();
    selectCustomer("Customer-B");

    expect(commits.mock.calls[0]?.[0]).toEqual({
      customer: "Customer-B",
      profile: "Profile-A",
      addresses: [],
      shippingAddress: "",
      loading: true,
    });

    await finishRequest(second, [
      address("Customer-B", "Address-B"),
    ]);

    expect(latestCommit()).toMatchObject({
      customer: "Customer-B",
      addresses: ["Address-B"],
      shippingAddress: "Address-B",
      loading: false,
    });
  });

  it("clears addresses when the POS profile changes for the same customer", async () => {
    const first = deferredAddresses();
    const second = deferredAddresses();

    fetchAddresses
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    selectCustomer("Customer-A");
    renderPage("Profile-A");

    await finishRequest(first, [
      address("Customer-A", "Profile-A-Address"),
    ]);

    expect(latestCommit()).toMatchObject({
      addresses: ["Profile-A-Address"],
      shippingAddress: "Profile-A-Address",
      loading: false,
    });

    commits.mockClear();
    renderPage("Profile-B");

    expect(commits.mock.calls[0]?.[0]).toEqual({
      customer: "Customer-A",
      profile: "Profile-B",
      addresses: [],
      shippingAddress: "",
      loading: true,
    });

    expect(fetchAddresses).toHaveBeenLastCalledWith(
      apiCall,
      {
        pos_profile: "Profile-B",
        customer: "Customer-A",
        limit: 100,
      },
    );

    await finishRequest(second, [
      address("Customer-A", "Profile-B-Address"),
    ]);

    expect(latestCommit()).toMatchObject({
      profile: "Profile-B",
      addresses: ["Profile-B-Address"],
      shippingAddress: "Profile-B-Address",
      loading: false,
    });
  });

  it("ignores an obsolete address response arriving after the current response", async () => {
    const first = deferredAddresses();
    const second = deferredAddresses();

    fetchAddresses
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    selectCustomer("Customer-A");
    renderPage();

    selectCustomer("Customer-B");

    await finishRequest(second, [
      address("Customer-B", "Address-B"),
    ]);

    const expected = {
      customer: "Customer-B",
      profile: "Profile-A",
      addresses: ["Address-B"],
      shippingAddress: "Address-B",
      loading: false,
    };

    expect(latestCommit()).toEqual(expected);

    await finishRequest(first, [
      address("Customer-A", "Address-A"),
    ]);

    expect(latestCommit()).toEqual(expected);
    expect(fetchAddresses).toHaveBeenCalledTimes(2);
  });
});
