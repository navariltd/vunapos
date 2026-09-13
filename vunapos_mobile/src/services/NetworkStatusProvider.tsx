import { NetworkState, useNetworkState } from "expo-network";
import {
  PropsWithChildren,
  createContext,
  useContext,
  useMemo,
} from "react";

export type NetworkConnectionStatus = "offline" | "online" | "unknown";

type NetworkStatusContextValue = {
  /**
   * `unknown` is deliberately distinct from `online`: until the device has
   * reported its reachability, callers must not assume a server is reachable.
   */
  connectionStatus: NetworkConnectionStatus;
  isOnline: boolean;
};

const fallbackNetworkStatus: NetworkStatusContextValue = {
  connectionStatus: "unknown",
  isOnline: false,
};

const NetworkStatusContext = createContext<NetworkStatusContextValue>(
  fallbackNetworkStatus,
);

export function getNetworkConnectionStatus(
  networkState: Pick<
    NetworkState,
    "isConnected" | "isInternetReachable"
  >,
): NetworkConnectionStatus {
  if (
    networkState.isConnected === false ||
    networkState.isInternetReachable === false
  ) {
    return "offline";
  }

  if (networkState.isInternetReachable === true) return "online";

  return "unknown";
}

export function NetworkStatusProvider({ children }: PropsWithChildren) {
  const networkState = useNetworkState();
  const connectionStatus = getNetworkConnectionStatus(networkState);
  const value = useMemo(
    () => ({
      connectionStatus,
      isOnline: connectionStatus === "online",
    }),
    [connectionStatus],
  );

  return (
    <NetworkStatusContext.Provider value={value}>
      {children}
    </NetworkStatusContext.Provider>
  );
}

export function useNetworkStatus() {
  return useContext(NetworkStatusContext);
}
