import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PosCustomersScreenProps = {
  customerManagementEnabled: boolean;
  onBackToPos: () => void;
  posProfile?: string;
};

/**
 * Customer-tab access boundary. The directory is introduced separately, but
 * this screen prevents an unavailable profile from exposing customer data.
 */
export function PosCustomersScreen({
  customerManagementEnabled,
  onBackToPos,
  posProfile,
}: PosCustomersScreenProps) {
  const { palette } = useAppearance();

  if (!posProfile) {
    return (
      <View
        accessibilityRole="progressbar"
        style={[styles.state, { backgroundColor: palette.background }]}
      >
        <ActivityIndicator color={palette.primary} />
        <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
          Loading POS Profile for customers…
        </Text>
      </View>
    );
  }

  if (!customerManagementEnabled) {
    return (
      <View style={[styles.state, { backgroundColor: palette.background }]}>
        <View
          accessibilityRole="alert"
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.title, { color: palette.onSurface }]}>
            Customer management disabled
          </Text>
          <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
            Customer management is disabled for this POS Profile.
          </Text>
          <Pressable
            accessibilityLabel="Back to POS"
            accessibilityRole="button"
            onPress={onBackToPos}
            style={[styles.backButton, { borderColor: palette.border }]}
          >
            <Text style={[styles.backButtonLabel, { color: palette.onSurface }]}>
              Back to POS
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.state, { backgroundColor: palette.background }]}>
      <View
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Text style={[styles.title, { color: palette.onSurface }]}>Customers</Text>
        <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
          Customer directory
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButtonLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
    width: "100%",
  },
  state: { flex: 1, gap: spacing.sm, justifyContent: "center", padding: spacing.lg },
  stateText: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  title: { fontFamily: typography.fontFamily.semibold, fontSize: 20 },
});
