import { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

import { useAppearance } from "@/theme/AppearanceProvider";
import { spacing } from "@/theme/tokens";

/** Keeps page navigation visible while the page body scrolls. */
export function PosFixedPageHeader({ children }: PropsWithChildren) {
  const { palette } = useAppearance();
  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
});
