import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { PosSession } from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

/** Blocks selling after a close until ERPNext reports an active opening entry. */
export function PosSessionGateScreen({ session }: { session: PosSession }) {
  const { palette } = useAppearance();
  const closingFailed = session.status === "CLOSING_FAILED";
  const closingInProgress = session.status === "CLOSING";
  const title = closingFailed
    ? "POS closing needs attention"
    : closingInProgress
      ? "POS closing in progress"
      : "A new POS shift is required";
  const message = closingFailed
    ? `Closing entry ${session.closing_entry || ""} needs a supervisor review before sales can resume.`
    : closingInProgress
      ? "ERPNext is consolidating this shift. Sales remain blocked until it completes."
      : "Open a new POS Opening Entry in ERPNext before making another sale.";

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <View
        accessibilityRole="alert"
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Text style={[styles.title, { color: palette.onSurface }]}>
          {title}
        </Text>
        <Text style={[styles.message, { color: palette.onSurfaceMuted }]}>
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  container: { flex: 1, justifyContent: "center", padding: spacing.lg },
  message: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  title: { fontFamily: typography.fontFamily.semibold, fontSize: 20 },
});
