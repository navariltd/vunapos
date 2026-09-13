import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { spacing, typography } from "@/theme/tokens";

type AppLaunchScreenProps = {
  message: string;
  onReady?: () => void;
};

/** The brief, unbranded handoff from the native splash to application routing. */
export function AppLaunchScreen({ message, onReady }: AppLaunchScreenProps) {
  return (
    <View
      accessibilityLabel={message}
      accessibilityRole="progressbar"
      onLayout={onReady}
      style={styles.screen}
    >
      <ActivityIndicator color="#16794c" size="small" />
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: "#f8f8f8",
    flex: 1,
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  message: {
    color: "#525252",
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    textAlign: "center",
  },
});
