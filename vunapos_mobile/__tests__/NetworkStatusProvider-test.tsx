import { render } from "@testing-library/react-native";
import { ReactNode } from "react";
import { Text } from "react-native";

import { NetworkStatusBanner } from "@/components/network/NetworkStatusBanner";
import {
  NetworkStatusProvider,
  getNetworkConnectionStatus,
  useNetworkStatus,
} from "@/services/NetworkStatusProvider";

let mockNetworkState: {
  isConnected?: boolean;
  isInternetReachable?: boolean;
} =
  {};

jest.mock("expo-network", () => ({
  useNetworkState: () => mockNetworkState,
}));

jest.mock("@/theme/AppearanceProvider", () => ({
  useAppearance: () => ({
    palette: {
      error: "#b00020",
      errorSurface: "#ffeef0",
      onError: "#780019",
    },
  }),
}));

function StatusConsumer() {
  const { connectionStatus, isOnline } = useNetworkStatus();
  return <Text>{`${connectionStatus}:${isOnline}`}</Text>;
}

function Provider({ children }: { children: ReactNode }) {
  return <NetworkStatusProvider>{children}</NetworkStatusProvider>;
}

describe("network status", () => {
  afterEach(() => {
    mockNetworkState = {};
  });

  it("keeps an unresolved network state distinct from online", async () => {
    expect(getNetworkConnectionStatus({})).toBe("unknown");
    expect(getNetworkConnectionStatus({ isConnected: true })).toBe("unknown");

    const screen = await render(<StatusConsumer />, { wrapper: Provider });
    expect(screen.getByText("unknown:false")).toBeTruthy();
  });

  it("recognises explicit connection and reachability failures", () => {
    expect(getNetworkConnectionStatus({ isConnected: false })).toBe("offline");
    expect(getNetworkConnectionStatus({ isInternetReachable: false })).toBe(
      "offline",
    );
    expect(getNetworkConnectionStatus({ isInternetReachable: true })).toBe(
      "online",
    );
  });

  it("shows the reconnect notice only when the device is explicitly offline", async () => {
    const screen = await render(<NetworkStatusBanner />, { wrapper: Provider });
    expect(screen.queryByTestId("network-status-banner")).toBeNull();

    mockNetworkState = { isConnected: false, isInternetReachable: false };
    await screen.rerender(<NetworkStatusBanner />);
    expect(screen.getByTestId("network-status-banner")).toBeTruthy();
    expect(
      screen.getByText("Connection unavailable. Reconnecting…"),
    ).toBeTruthy();
  });
});
