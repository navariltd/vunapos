import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "react-native-paper";

import { PosItemUom } from "@/features/pos/types";
import { posDarkColors, radii, spacing, typography } from "@/theme/tokens";

type Props = {
  isOffline?: boolean;
  itemName: string;
  onDismiss: () => void;
  onSelect: (uom: string) => void;
  options: PosItemUom[];
  selectedUom?: string | null;
  visible: boolean;
};

/** Selects only UOMs configured on the Item; the subsequent cart preview validates the choice. */
export function PosUomPickerSheet({
  isOffline = false,
  itemName,
  onDismiss,
  onSelect,
  options,
  selectedUom,
  visible,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onDismiss}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityLabel="Dismiss unit picker"
          onPress={onDismiss}
          style={styles.backdrop}
        />
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) },
          ]}
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.heading}>
              <Text style={styles.title}>Unit of measure</Text>
              <Text numberOfLines={1} style={styles.subtitle}>
                {itemName}
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Close unit picker"
              onPress={onDismiss}
              style={styles.closeButton}
            >
              <Text style={styles.closeButtonLabel}>Close</Text>
            </Pressable>
          </View>
          {options.map((option) => {
            const active = selectedUom === option.uom;
            return (
              <Pressable
                accessibilityLabel={`Use unit ${option.uom}`}
                disabled={isOffline}
                key={option.uom}
                onPress={() => onSelect(option.uom)}
                style={[styles.option, active && styles.optionActive]}
              >
                <View style={styles.optionContent}>
                  <Text style={styles.optionName}>{option.uom}</Text>
                  <Text style={styles.optionMeta}>
                    Conversion factor: {option.conversion_factor}
                  </Text>
                </View>
                <Text style={styles.optionCheck}>{active ? "✓" : ""}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    ...StyleSheet.absoluteFill,
  },
  closeButton: {
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  closeButtonLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: "#555",
    borderRadius: radii.pill,
    height: 4,
    marginBottom: spacing.md,
    width: 40,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  heading: { flex: 1, gap: 2 },
  option: {
    alignItems: "center",
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
  },
  optionActive: { borderColor: posDarkColors.primary },
  optionCheck: {
    color: posDarkColors.primary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
    minWidth: 20,
    textAlign: "center",
  },
  optionContent: { flex: 1, gap: 2 },
  optionMeta: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  optionName: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  root: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: posDarkColors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  subtitle: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  title: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
});
