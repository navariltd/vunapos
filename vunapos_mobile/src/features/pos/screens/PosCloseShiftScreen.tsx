import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PosCloseShiftScreenProps = {
  onBackToPos: () => void;
  posProfile?: string;
};

/**
 * Entry point for the server-authoritative POS closing workflow. The preview
 * and reconciliation stages are added here incrementally.
 */
export function PosCloseShiftScreen({
  onBackToPos,
  posProfile,
}: PosCloseShiftScreenProps) {
  const { palette } = useAppearance();

  if (!posProfile) {
    return (
      <View
        accessibilityRole="progressbar"
        style={[styles.state, { backgroundColor: palette.background }]}
      >
        <ActivityIndicator color={palette.primary} />
        <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
          Loading POS profile for shift closing…
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.content, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={[styles.title, { color: palette.onSurface }]}>
            Close POS Shift
          </Text>
          <Text style={[styles.description, { color: palette.onSurfaceMuted }]}>
            Reconcile the till and close {posProfile}.
          </Text>
        </View>
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

      <View
        style={[
          styles.preparingCard,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Text style={[styles.preparingTitle, { color: palette.onSurface }]}>
          Preparing shift reconciliation
        </Text>
        <Text style={[styles.description, { color: palette.onSurfaceMuted }]}>
          The current shift totals and payment counts will be loaded from the
          server here.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: "center",
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
  content: { flex: 1, gap: spacing.lg, padding: spacing.md },
  description: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  header: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md },
  heading: { flex: 1, gap: 4 },
  preparingCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  preparingTitle: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  state: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
  stateText: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  title: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.heading,
  },
});
