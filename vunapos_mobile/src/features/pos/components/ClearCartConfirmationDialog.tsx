import { Modal, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { posDarkColors, radii, spacing, typography } from "@/theme/tokens";

type ClearCartConfirmationDialogProps = {
  onConfirm: () => void;
  onDismiss: () => void;
  visible: boolean;
};

/** Confirms the cart-wide consequences before discarding a sale in progress. */
export function ClearCartConfirmationDialog({
  onConfirm,
  onDismiss,
  visible,
}: ClearCartConfirmationDialogProps) {
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

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
  },
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  cancelButton: {
    alignItems: "center",
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: spacing.md,
  },
  cancelLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  clearButton: {
    alignItems: "center",
    backgroundColor: posDarkColors.error,
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 104,
    paddingHorizontal: spacing.md,
  },
  clearLabel: {
    color: posDarkColors.background,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  description: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  dialog: {
    backgroundColor: posDarkColors.surface,
    borderColor: posDarkColors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
    width: "100%",
  },
  title: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
});
