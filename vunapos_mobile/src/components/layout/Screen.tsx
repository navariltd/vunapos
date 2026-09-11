import { PropsWithChildren } from "react";
import { StyleProp, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppearance } from "@/theme/AppearanceProvider";

type ScreenProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
}>;

export function Screen({ children, style }: ScreenProps) {
  const { palette } = useAppearance();
  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={[{ backgroundColor: palette.background, flex: 1 }, style]}
    >
      {children}
    </SafeAreaView>
  );
}
