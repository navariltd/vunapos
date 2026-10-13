import { MaterialCommunityIcons } from "@expo/vector-icons";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Text } from "react-native-paper";

import { useCreatePosCustomer } from "@/features/pos/hooks/useCreatePosCustomer";
import { usePosCustomerSearch } from "@/features/pos/hooks/usePosCustomerSearch";
import type { PosCustomerSearchResult, PosSaleCustomer } from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { AppPalette, radii, spacing, typography } from "@/theme/tokens";

type PosCustomerComboBoxProps = {
  accessibilityLabel: string;
  allowCustomerCreation: boolean;
  disabled?: boolean;
  floatingOptions?: boolean;
  invalid?: boolean;
  onOpen?: () => void;
  onSelect: (customer: PosCustomerSearchResult) => void;
  optionAccessibilityPrefix?: string;
  placeholder?: string;
  posProfile?: string;
  selectedCustomer?: PosSaleCustomer | null;
};

export type PosCustomerComboBoxHandle = { dismiss: () => void };

/** Search permitted customers inline; typed text never changes the active sale. */
export const PosCustomerComboBox = forwardRef<PosCustomerComboBoxHandle, PosCustomerComboBoxProps>(function PosCustomerComboBox({
  accessibilityLabel,
  allowCustomerCreation,
  disabled = false,
  floatingOptions = false,
  invalid = false,
  onOpen,
  onSelect,
  optionAccessibilityPrefix = "Select customer",
  placeholder = "Search and select a customer",
  posProfile,
  selectedCustomer,
}: PosCustomerComboBoxProps, ref) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const search = usePosCustomerSearch(query, isOpen && !showCreate, posProfile);
  const customerCreation = useCreatePosCustomer();
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const rows = search.rows.filter((customer) => {
    const text = [customer.customer, customer.customerName, customer.mobile, customer.email, customer.taxId]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });

  function close() {
    setIsOpen(false);
    setShowCreate(false);
    setQuery("");
    Keyboard.dismiss();
  }

  useImperativeHandle(ref, () => ({ dismiss: () => { if (isOpen) close(); } }));

  function select(customer: PosCustomerSearchResult) {
    if (customer.customer !== selectedCustomer?.customer) onSelect(customer);
    close();
  }

  async function createCustomer() {
    const customer = await customerCreation.create(customerName, posProfile);
    if (!customer) return;
    setCustomerName("");
    select(customer);
  }

  return (
    <View onTouchStart={(event) => event.stopPropagation()} style={[styles.container, floatingOptions && styles.floatingContainer]}>
      <View style={[styles.inputRow, invalid && styles.invalid, disabled && styles.disabled]} testID="customer-combobox-input-row">
        <TextInput
          ref={inputRef}
          accessibilityLabel={accessibilityLabel}
          autoCorrect={false}
          editable={!disabled}
          onChangeText={(value) => {
            if (disabled) return;
            if (!isOpen) onOpen?.();
            setQuery(value);
            setIsOpen(true);
            setShowCreate(false);
          }}
          onFocus={() => {
            if (disabled) return;
            onOpen?.();
            setQuery("");
            setIsOpen(true);
          }}
          placeholder={placeholder}
          placeholderTextColor={palette.onSurfaceMuted}
          style={styles.input}
          value={isOpen ? query : selectedCustomer?.customerName || ""}
        />
        <Pressable
          accessibilityLabel={isOpen ? "Close customer options" : "Show customer options"}
          disabled={disabled}
          onPress={() => {
            if (isOpen) close();
            else inputRef.current?.focus();
          }}
        >
          <MaterialCommunityIcons
            color={palette.onSurfaceMuted}
            name={isOpen ? "chevron-up" : "chevron-down"}
            size={20}
          />
        </Pressable>
      </View>
      {isOpen && !disabled ? (
        <View
          style={[styles.options, floatingOptions && styles.floatingOptions]}
          testID="customer-combobox-options"
        >
          {!showCreate ? (
            <ScrollView
              contentContainerStyle={styles.optionsContent}
              keyboardShouldPersistTaps="always"
              nestedScrollEnabled
              style={styles.optionsList}
            >
              {search.isLoading ? <Text style={styles.stateText}>Loading customers…</Text> : null}
              {search.error ? <Text style={styles.errorText}>{search.error}</Text> : null}
              {!search.isLoading && !search.error && !rows.length ? (
                <Text style={styles.stateText}>No customers found.</Text>
              ) : null}
              {rows.map((customer) => (
                <Pressable
                  accessibilityLabel={`${optionAccessibilityPrefix} ${customer.customerName}`}
                  accessibilityRole="button"
                  key={customer.customer}
                  onPress={() => select(customer)}
                  style={styles.option}
                >
                  <View style={styles.optionText}>
                    <Text style={styles.optionName}>{customer.customerName}</Text>
                    <Text style={styles.optionMeta}>
                      {customer.mobile || customer.email || customer.customer}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          {allowCustomerCreation ? (
            <View style={styles.createSection}>
              <Pressable
                accessibilityLabel={showCreate ? "Back to customer search" : "Create customer"}
                disabled={customerCreation.isCreating}
                onPress={() => setShowCreate((current) => !current)}
                style={styles.createToggle}
              >
                <MaterialCommunityIcons color={palette.primary} name={showCreate ? "arrow-left" : "plus"} size={19} />
                <Text style={styles.createToggleLabel}>
                  {showCreate ? "Back to search" : "Create customer"}
                </Text>
              </Pressable>
              {showCreate ? (
                <View style={styles.createForm}>
                  <TextInput
                    accessibilityLabel="New customer name"
                    autoCapitalize="words"
                    editable={!customerCreation.isCreating}
                    onChangeText={setCustomerName}
                    placeholder="Customer name"
                    placeholderTextColor={palette.onSurfaceMuted}
                    style={styles.createInput}
                    value={customerName}
                  />
                  {customerCreation.error ? (
                    <Text accessibilityRole="alert" style={styles.errorText}>{customerCreation.error}</Text>
                  ) : null}
                  <Pressable
                    accessibilityLabel="Save customer"
                    disabled={customerCreation.isCreating || !customerName.trim()}
                    onPress={() => void createCustomer()}
                    style={[styles.saveButton, (customerCreation.isCreating || !customerName.trim()) && styles.disabled]}
                  >
                    <Text style={styles.saveButtonLabel}>
                      {customerCreation.isCreating ? "Creating…" : "Save customer"}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

function createStyles(palette: AppPalette) {
  return StyleSheet.create({
    container: { gap: spacing.xs },
    floatingContainer: { zIndex: 2 },
    inputRow: {
      alignItems: "center",
      backgroundColor: palette.surfaceContainer,
      borderColor: palette.border,
      borderRadius: radii.md,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.sm,
      minHeight: 48,
      paddingHorizontal: spacing.md,
    },
    input: {
      color: palette.onSurface,
      flex: 1,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.body,
      paddingVertical: 0,
    },
    disabled: { opacity: 0.5 },
    invalid: { borderColor: palette.error },
    options: {
      backgroundColor: palette.surfaceContainer,
      borderColor: palette.border,
      borderRadius: radii.md,
      borderWidth: 1,
      padding: spacing.xs,
    },
    floatingOptions: {
      elevation: 8,
      left: 0,
      marginTop: spacing.xs,
      position: "absolute",
      right: 0,
      top: "100%",
      zIndex: 2,
    },
    optionsList: { maxHeight: 240 },
    optionsContent: { gap: spacing.xs },
    option: {
      borderColor: palette.border,
      borderRadius: radii.md,
      borderWidth: 1,
      minHeight: 48,
      padding: spacing.sm,
    },
    optionText: { gap: 2 },
    optionName: { color: palette.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
    optionMeta: { color: palette.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
    stateText: { color: palette.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, padding: spacing.sm },
    errorText: { color: palette.error, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
    createSection: { borderTopColor: palette.border, borderTopWidth: 1, gap: spacing.xs, paddingTop: spacing.xs },
    createToggle: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", gap: spacing.xs, minHeight: 40, paddingHorizontal: spacing.xs },
    createToggleLabel: { color: palette.primary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
    createForm: { gap: spacing.sm },
    createInput: { borderColor: palette.border, borderRadius: radii.md, borderWidth: 1, color: palette.onSurface, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, minHeight: 44, paddingHorizontal: spacing.sm },
    saveButton: { alignItems: "center", backgroundColor: palette.primary, borderRadius: radii.md, justifyContent: "center", minHeight: 44 },
    saveButtonLabel: { color: palette.onPrimary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  });
}
