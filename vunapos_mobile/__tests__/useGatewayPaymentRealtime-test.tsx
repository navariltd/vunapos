import { cleanup, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("socket.io-client", () => ({
  io: jest.fn(),
}));
jest.mock("@/sync/frappeRealtimeClient", () => {
  const actual = jest.requireActual("@/sync/frappeRealtimeClient");
  return {
    ...actual,
    frappeRealtimeClient: { subscribeGatewayPayment: jest.fn() },
  };
});

import {
  useGatewayPaymentRealtime,
} from "@/features/pos/hooks/useGatewayPaymentRealtime";
import { io } from "socket.io-client";
import { frappeRealtimeClient } from "@/sync/frappeRealtimeClient";

const mockIo = jest.mocked(io);
const subscribeGatewayPayment = jest.mocked(frappeRealtimeClient.subscribeGatewayPayment);

describe("gateway payment realtime hook", () => {
  const unsubscribe = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    subscribeGatewayPayment.mockReturnValue(unsubscribe);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("observes the root socket without opening another connection", async () => {
    const onChange = jest.fn();
    renderHook(() => useGatewayPaymentRealtime(onChange));

    await waitFor(() => expect(subscribeGatewayPayment).toHaveBeenCalledTimes(1));
    const listener = subscribeGatewayPayment.mock.calls[0][0];
    const payment = { name: "GATEWAY-001", status: "Paid" };
    listener(payment);
    listener(null);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(payment);
    expect(mockIo).not.toHaveBeenCalled();

    await cleanup();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

});
