import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { useAppearance } from "@/theme/AppearanceProvider";
import { AppPalette, radii, spacing, typography } from "@/theme/tokens";

type ClearCartConfirmationDialogProps = {
  isOffline?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  visible: boolean;
};

/** Confirms the cart-wide consequences before discarding a sale in progress. */
export function ClearCartConfirmationDialog({
  isOffline = false,
  onConfirm,
  onDismiss,
  visible,
}: ClearCartConfirmationDialogProps) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  return (
    <Modal
      animationType="fade"
      onRequestClose={onDismiss}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Dismiss clear cart confirmation"
          onPress={onDismiss}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.dialog}>
          <Text style={styles.title}>Clear the current cart?</Text>
          <Text style={styles.description}>
            Every item, quantity, payment allocation, batch or serial selection,
            discount, and note in this cart will be removed.
          </Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="Cancel clear cart"
              onPress={onDismiss}
              style={styles.cancelButton}
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Confirm clear cart"
              disabled={isOffline}
              onPress={onConfirm}
              style={styles.clearButton}
            >
              <Text style={styles.clearLabel}>Clear cart</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(palette: AppPalette) {
  return StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
  },
  backdrop: {
    alignItems: "center",
    backgroundColor: palette.scrim,
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  cancelButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: spacing.md,
  },
  cancelLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  clearButton: {
    alignItems: "center",
    backgroundColor: palette.error,
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 104,
    paddingHorizontal: spacing.md,
  },
  clearLabel: {
    color: palette.background,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  description: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  dialog: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
    width: "100%",
  },
  title: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
  });
}
