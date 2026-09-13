import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "react-native-paper";

import { PosCustomerDirectoryFilters } from "@/features/pos/types";
import { posDarkColors, radii, spacing, typography } from "@/theme/tokens";

type FilterField = keyof PosCustomerDirectoryFilters;
type FilterOption = { label: string; value: string };
type FilterSelection = {
  field: FilterField;
  label: string;
  options: FilterOption[];
  value: string;
};

type PosCustomerFiltersSheetProps = {
  customerGroups: string[];
  filters: PosCustomerDirectoryFilters;
  onApply: () => void;
  onChange: <Key extends FilterField>(
    field: Key,
    value: PosCustomerDirectoryFilters[Key],
  ) => void;
  onClear: () => void;
  onDismiss: () => void;
  territories: string[];
  visible: boolean;
};

function FilterSelect({
  accessibilityLabel,
  label,
  onPress,
  options,
  value,
}: {
  accessibilityLabel: string;
  label: string;
  onPress: () => void;
  options: FilterOption[];
  value: string;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? label;
  return (
    <View style={styles.selectWrapper}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={onPress}
        style={styles.selectButton}
      >
        <Text numberOfLines={1} style={styles.selectValue}>
          {selectedLabel}
        </Text>
        <MaterialCommunityIcons
          color={posDarkColors.onSurfaceMuted}
          name="chevron-down"
          size={20}
        />
      </Pressable>
    </View>
  );
}

function FilterSelectionDialog({
  onDismiss,
  onSelect,
  selection,
}: {
  onDismiss: () => void;
  onSelect: (value: string) => void;
  selection: FilterSelection | null;
}) {
  if (!selection) return null;
  return (
    <View accessibilityViewIsModal style={styles.selectionOverlay}>
      <Pressable
        accessibilityLabel={`Dismiss ${selection.label} options`}
        onPress={onDismiss}
        style={styles.selectionScrim}
      />
      <View style={styles.selectionDialog}>
        <View style={styles.selectionHeader}>
          <Text style={styles.selectionTitle}>
            Select {selection.label.toLowerCase()}
          </Text>
          <Pressable
            accessibilityLabel="Close options"
            onPress={onDismiss}
            style={styles.closeButton}
          >
            <MaterialCommunityIcons
              color={posDarkColors.onSurface}
              name="close"
              size={20}
            />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.selectionOptions}
          showsVerticalScrollIndicator={false}
        >
          {selection.options.map((option) => (
            <Pressable
              key={option.value || option.label}
              onPress={() => onSelect(option.value)}
              style={[
                styles.selectionOption,
                option.value === selection.value && styles.selectionOptionActive,
              ]}
            >
              <Text style={styles.selectionOptionLabel}>{option.label}</Text>
              {option.value === selection.value ? (
                <MaterialCommunityIcons
                  color={posDarkColors.onSurface}
                  name="check"
                  size={20}
                />
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

/** Uses the same draft/apply bottom-sheet interaction as invoice filters. */
export function PosCustomerFiltersSheet({
  customerGroups,
  filters,
  onApply,
  onChange,
  onClear,
  onDismiss,
  territories,
  visible,
}: PosCustomerFiltersSheetProps) {
  const insets = useSafeAreaInsets();
  const [selection, setSelection] = useState<FilterSelection | null>(null);
  const groupOptions = [
    { label: "All groups", value: "" },
    ...customerGroups.map((value) => ({ label: value, value })),
  ];
  const typeOptions = [
    { label: "All types", value: "" },
    { label: "Individual", value: "Individual" },
    { label: "Company", value: "Company" },
  ];
  const territoryOptions = [
    { label: "All territories", value: "" },
    ...territories.map((value) => ({ label: value, value })),
  ];

  function openSelection(
    field: FilterField,
    label: string,
    options: FilterOption[],
  ) {
    setSelection({ field, label, options, value: filters[field] });
  }

  function selectOption(value: string) {
    if (!selection) return;
    if (selection.field === "customerType") {
      onChange("customerType", value as PosCustomerDirectoryFilters["customerType"]);
    } else {
      onChange(selection.field, value);
    }
    setSelection(null);
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={() => (selection ? setSelection(null) : onDismiss())}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.modalRoot}>
        <Pressable
          accessibilityLabel="Dismiss customer filters"
          onPress={onDismiss}
          style={styles.backdrop}
        />
        <View
          accessibilityViewIsModal
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
        >
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeading}>
              <Text style={styles.title}>Filter customers</Text>
              <Text style={styles.subtitle}>
                Choose criteria, then apply them to the customer directory.
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Close customer filters"
              onPress={onDismiss}
              style={styles.closeButton}
            >
              <MaterialCommunityIcons
                color={posDarkColors.onSurface}
                name="close"
                size={20}
              />
            </Pressable>
          </View>
          <View style={styles.content}>
            <FilterSelect
              accessibilityLabel="Select customer group"
              label="Customer group"
              onPress={() => openSelection("customerGroup", "Customer group", groupOptions)}
              options={groupOptions}
              value={filters.customerGroup}
            />
            <FilterSelect
              accessibilityLabel="Select customer type"
              label="Customer type"
              onPress={() => openSelection("customerType", "Customer type", typeOptions)}
              options={typeOptions}
              value={filters.customerType}
            />
            <FilterSelect
              accessibilityLabel="Select customer territory"
              label="Territory"
              onPress={() => openSelection("territory", "Territory", territoryOptions)}
              options={territoryOptions}
              value={filters.territory}
            />
          </View>
          <View style={styles.footer}>
            <Pressable onPress={onClear} style={styles.clearButton}>
              <Text style={styles.clearButtonLabel}>Clear filters</Text>
            </Pressable>
            <Pressable onPress={onApply} style={styles.applyButton}>
              <Text style={styles.applyButtonLabel}>Apply filters</Text>
            </Pressable>
          </View>
        </View>
      </View>
      <FilterSelectionDialog
        onDismiss={() => setSelection(null)}
        onSelect={selectOption}
        selection={selection}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  applyButton: { alignItems: "center", backgroundColor: posDarkColors.primary, borderRadius: radii.md, flex: 1, justifyContent: "center", minHeight: 48 },
  applyButtonLabel: { color: posDarkColors.onPrimary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  backdrop: { backgroundColor: "rgba(0, 0, 0, 0.62)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  clearButton: { alignItems: "center", borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 48 },
  clearButtonLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  closeButton: { alignItems: "center", borderColor: posDarkColors.border, borderRadius: radii.pill, borderWidth: 1, height: 36, justifyContent: "center", width: 36 },
  content: { gap: spacing.sm, padding: spacing.lg },
  footer: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  handle: { alignSelf: "center", backgroundColor: posDarkColors.border, borderRadius: radii.pill, height: 4, marginTop: spacing.sm, width: 48 },
  label: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.medium, fontSize: typography.size.small },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  selectButton: { alignItems: "center", backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: "row", gap: spacing.sm, height: 44, justifyContent: "space-between", paddingHorizontal: spacing.sm },
  selectValue: { color: posDarkColors.onSurface, flex: 1, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body },
  selectWrapper: { gap: spacing.xs },
  selectionDialog: { backgroundColor: posDarkColors.surface, borderColor: posDarkColors.border, borderRadius: radii.lg, borderWidth: 1, margin: spacing.lg, maxHeight: "70%", padding: spacing.md },
  selectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  selectionOption: { alignItems: "center", borderRadius: radii.md, flexDirection: "row", justifyContent: "space-between", padding: spacing.sm },
  selectionOptionActive: { backgroundColor: posDarkColors.surfaceContainer },
  selectionOptionLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body },
  selectionOptions: { gap: spacing.xs, paddingTop: spacing.sm },
  selectionOverlay: { alignItems: "center", bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  selectionScrim: { backgroundColor: "rgba(0, 0, 0, 0.38)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  selectionTitle: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  sheet: { backgroundColor: posDarkColors.surface, borderColor: posDarkColors.border, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, borderWidth: 1, gap: spacing.md, maxHeight: "80%", paddingTop: spacing.sm },
  sheetHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md, justifyContent: "space-between", paddingHorizontal: spacing.lg },
  sheetHeading: { flex: 1, gap: 2 },
  subtitle: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body },
  title: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
});
