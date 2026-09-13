import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { useAppearance } from "@/theme/AppearanceProvider";
import { AppPalette, spacing, typography } from "@/theme/tokens";

type AppLaunchScreenProps = {
  message: string;
  onReady?: () => void;
};

/** The brief, unbranded handoff from the native splash to application routing. */
export function AppLaunchScreen({ message, onReady }: AppLaunchScreenProps) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  return (
    <View
      accessibilityLabel={message}
      accessibilityRole="progressbar"
      onLayout={onReady}
      style={styles.screen}
    >
      <ActivityIndicator color={palette.primary} size="small" />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

function createStyles(palette: AppPalette) {
  return StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: palette.background,
    flex: 1,
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  message: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    textAlign: "center",
  },
  });
}
