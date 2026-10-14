import { createContext, PropsWithChildren, useContext } from "react";
import { View } from "react-native";

/** The initial launch layer is dismissed only after its destination has laid out. */
export const LaunchReadyContext = createContext<() => void>(() => {});

export function useLaunchRouteReady() {
  return useContext(LaunchReadyContext);
}

export function LaunchReadyRoute({ children }: PropsWithChildren) {
  const markReady = useLaunchRouteReady();
  return <View onLayout={markReady} style={{ flex: 1 }}>{children}</View>;
}
