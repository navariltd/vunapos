import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockInvalidateSession = jest.fn();

jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: () => ({
    authState: "signedIn",
    companyUrl: "https://vuna.example.com",
    invalidateSession: mockInvalidateSession,
    sessionId: "sid-1",
  }),
}));
jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => ({ connectionStatus: "online" }),
}));
jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
  postVunaMethod: jest.fn(),
}));
jest.mock("@/services/posCacheInvalidation", () => ({
  invalidateSaleCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/services/posInventoryRefresh", () => ({
  refreshSoldItemStock: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/sync/queuedCheckoutRegistry", () => ({
  registerQueuedCheckout: jest.fn(),
}));
jest.mock("@/features/pos/hooks/usePosCustomerLoyalty", () => ({
  usePosCustomerLoyalty: () => ({ data: null, error: null, isLoading: false }),
}));
jest.mock("@/features/pos/hooks/useGatewayPayment", () => ({
  useGatewayPayment: () => ({
    attachC2B: jest.fn(), cancel: jest.fn(), clearError: jest.fn(),
    error: null, getStatus: jest.fn(), initiate: jest.fn(), isWorking: false,
    resolveCustomerPhone: jest.fn(), searchC2B: jest.fn(),
  }),
}));
jest.mock("@/features/pos/hooks/useGatewayPaymentRealtime", () => ({
  useGatewayPaymentRealtime: () => undefined,
}));

import type { PosBootstrapState } from "@/features/pos/hooks/usePosBootstrap";
import { PosCheckoutScreen } from "@/features/pos/screens/PosCheckoutScreen";
import { getVunaMethod, postVunaMethod } from "@/services/frappeClient";
import {
  PosBootstrapSnapshotBoundary,
  useRootPosBootstrapSnapshot,
} from "@/sync/PosBootstrapSnapshot";

const mockPreview = jest.mocked(getVunaMethod);
const mockSubmit = jest.mocked(postVunaMethod);
const item = {
  allow_negative_stock: false,
  available_qty: 4,
  is_stock_item: true,
  item_code: "ITEM-001",
  item_name: "Stock item",
  qty: 1,
  rate: 100,
  uom: "Nos",
};

function Checkout() {
  const snapshot = useRootPosBootstrapSnapshot();
  const session = snapshot?.data?.pos_session;
  return <PosCheckoutScreen
    bootstrapData={snapshot?.data}
    currency="KES"
    items={[item]}
    onBack={jest.fn()}
    onComplete={jest.fn()}
    orderType="Invoice"
    saleCustomer={{ customer: "CUST-001", customerName: "ABC Corps" }}
    sessionVerificationKey={session?.opening_entry || ""}
    subtotal={100}
    transactionReady={Boolean(session?.ready && !snapshot?.isScopeInvalidated)}
  />;
}

function snapshot(ready: boolean): PosBootstrapState {
  return {
    data: {
      payment_modes: [{ default: true, mode_of_payment: "Cash" }],
      pos_profile: { allow_credit_sales: true, name: "POS-001" },
      pos_session: {
        has_opening_entry: ready,
        opening_entry: ready ? "OPEN-001" : undefined,
        ready,
        status: ready ? "OPEN" : "OPENING_REQUIRED",
      },
    },
    error: null,
    isLoading: false,
    reload: jest.fn(),
  } as PosBootstrapState;
}

it("keeps checkout mounted but never submits across closure until a new server preview succeeds", async () => {
  mockPreview.mockResolvedValue({ items: [], totals: { grand_total: 116, net_total: 100 } } as never);
  mockPreview.mockResolvedValueOnce({ items: [], totals: { grand_total: 116, net_total: 100 } } as never);
  const view = await render(
    <PosBootstrapSnapshotBoundary authState="signedIn" value={snapshot(true)}>
      <Checkout />
    </PosBootstrapSnapshotBoundary>,
  );
  await waitFor(() => expect(screen.getByLabelText("Complete sale").props.accessibilityState.disabled).toBe(false));
  expect(mockPreview).toHaveBeenCalledTimes(1);

  await view.rerender(
    <PosBootstrapSnapshotBoundary authState="signedIn" value={snapshot(false)}>
      <Checkout />
    </PosBootstrapSnapshotBoundary>,
  );
  expect(screen.getByLabelText("Complete sale").props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByLabelText("Complete sale"));
  expect(mockSubmit).not.toHaveBeenCalled();

  let finishPreview!: (value: unknown) => void;
  mockPreview.mockImplementationOnce(() => new Promise((resolve) => {
    finishPreview = resolve;
  }));
  await view.rerender(
    <PosBootstrapSnapshotBoundary authState="signedIn" value={snapshot(true)}>
      <Checkout />
    </PosBootstrapSnapshotBoundary>,
  );
  await waitFor(() => expect(mockPreview).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText("Complete sale").props.accessibilityState.disabled).toBe(true);
  expect(mockSubmit).not.toHaveBeenCalled();

  await act(async () => finishPreview({ items: [], totals: { grand_total: 116, net_total: 100 } }));
  await waitFor(() => expect(screen.getByLabelText("Complete sale").props.accessibilityState.disabled).toBe(false));
  expect(mockSubmit).not.toHaveBeenCalled();
  mockSubmit.mockResolvedValueOnce({ doctype: "Sales Invoice", name: "SINV-001" } as never);
  await fireEvent.press(screen.getByLabelText("Complete sale"));
  await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1));
});
