import { MaterialCommunityIcons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import { Text } from "react-native-paper";

import { PosCheckoutFieldDefinition } from "@/features/pos/types";
import { useCheckoutLinkOptions } from "@/features/pos/hooks/useCheckoutLinkOptions";
import { useAppearance } from "@/theme/AppearanceProvider";
import { AppPalette, radii, spacing, typography } from "@/theme/tokens";

export type PosCheckoutFieldValues = Record<string, string>;

type Props = {
  disabled?: boolean;
  fields?: PosCheckoutFieldDefinition[];
  onChange: (fieldname: string, value: string) => void;
  transactionDoctype: PosCheckoutFieldDefinition["doctype"];
  values: PosCheckoutFieldValues;
};

function dateFromInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(dateFromInput(value));
}

/** Native fields supplied by the server-approved POS checkout configuration. */
export function PosCheckoutFieldsCard({
  disabled,
  fields,
  onChange,
  transactionDoctype,
  values,
}: Props) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  const configuredFields = useMemo(
    () =>
      (fields ?? [])
        .filter((field) => field.doctype === transactionDoctype)
        .sort(
          (left, right) =>
            (left.order ?? 0) - (right.order ?? 0) ||
            left.label.localeCompare(right.label),
        ),
    [fields, transactionDoctype],
  );
  const [dateField, setDateField] = useState<PosCheckoutFieldDefinition>();
  const [selectField, setSelectField] = useState<PosCheckoutFieldDefinition>();

  if (!configuredFields.length) return null;

  const selectOptions = (selectField?.options ?? "")
    .split("\n")
    .map((option) => option.trim())
    .filter(Boolean);

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Additional details</Text>
      <Text style={styles.cardHint}>
        Complete the details configured for this {transactionDoctype}.
      </Text>
      {configuredFields.map((field) => {
        const value = values[field.fieldname] ?? "";
        const isCheck = field.fieldtype === "Check";
        const isDate = field.fieldtype === "Date";
        const isSelect = field.fieldtype === "Select";
        const isLongText = field.fieldtype === "Long Text";
        const isLink = field.fieldtype === "Link";

        return (
          <View
            key={`${field.doctype}-${field.fieldname}`}
            style={styles.field}
          >
            {isCheck ? (
              <View style={styles.checkRow}>
                <View style={styles.checkText}>
                  <Text style={styles.fieldLabel}>
                    {field.label}
                    {field.required ? " *" : ""}
                  </Text>
                  {field.help_text ? (
                    <Text style={styles.fieldHelp}>{field.help_text}</Text>
                  ) : null}
                </View>
                <Switch
                  accessibilityLabel={`Enable ${field.label}`}
                  disabled={disabled}
                  onValueChange={(checked) =>
                    onChange(field.fieldname, checked ? "1" : "0")
                  }
                  thumbColor={palette.onSurface}
                  trackColor={{ false: palette.border, true: palette.success }}
                  value={value === "1" || value === "true"}
                />
              </View>
            ) : (
              <>
                <Text style={styles.fieldLabel}>
                  {field.label}
                  {field.required ? " *" : ""}
                </Text>
                {isDate ? (
                  <Pressable
                    accessibilityLabel={`Choose ${field.label}`}
                    disabled={disabled}
                    onPress={() => setDateField(field)}
                    style={[styles.selectButton, disabled && styles.disabled]}
                  >
                    <MaterialCommunityIcons
                      color={palette.onSurfaceMuted}
                      name="calendar-month-outline"
                      size={20}
                    />
                    <Text style={styles.selectButtonLabel}>
                      {value
                        ? formatDate(value)
                        : field.placeholder || `Select ${field.label}`}
                    </Text>
                  </Pressable>
                ) : isSelect ? (
                  <Pressable
                    accessibilityLabel={`Choose ${field.label}`}
                    disabled={disabled}
                    onPress={() => setSelectField(field)}
                    style={[styles.selectButton, disabled && styles.disabled]}
                  >
                    <Text style={styles.selectButtonLabel}>
                      {value || field.placeholder || `Select ${field.label}`}
                    </Text>
                    <MaterialCommunityIcons
                      color={palette.onSurfaceMuted}
                      name="chevron-down"
                      size={20}
                    />
                  </Pressable>
                ) : isLink ? (
                  <PosCheckoutLinkEditor
                    disabled={disabled}
                    field={field}
                    onChange={onChange}
                    value={value}
                  />
                ) : (
                  <TextInput
                    accessibilityLabel={field.label}
                    editable={!disabled}
                    multiline={isLongText}
                    numberOfLines={isLongText ? 4 : 1}
                    onChangeText={(nextValue) =>
                      onChange(field.fieldname, nextValue)
                    }
                    placeholder={field.placeholder || `Enter ${field.label}`}
                    placeholderTextColor={palette.onSurfaceMuted}
                    style={[styles.input, isLongText && styles.longTextInput]}
                    value={value}
                  />
                )}
                {field.help_text ? (
                  <Text style={styles.fieldHelp}>{field.help_text}</Text>
                ) : null}
              </>
            )}
          </View>
        );
      })}

      {dateField ? (
        <DateTimePicker
          mode="date"
          negativeButton={{ label: "Cancel" }}
          onDismiss={() => setDateField(undefined)}
          onValueChange={(_event, selectedDate) => {
            onChange(dateField.fieldname, dateInputValue(selectedDate));
            setDateField(undefined);
          }}
          positiveButton={{ label: "Select" }}
          value={dateFromInput(
            values[dateField.fieldname] || dateInputValue(new Date()),
          )}
        />
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setSelectField(undefined)}
        transparent
        visible={Boolean(selectField)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select {selectField?.label}</Text>
            {selectOptions.map((option) => (
              <Pressable
                key={option}
                onPress={() => {
                  if (selectField) onChange(selectField.fieldname, option);
                  setSelectField(undefined);
                }}
                style={styles.option}
              >
                <Text style={styles.optionLabel}>{option}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setSelectField(undefined)}
              style={styles.cancelButton}
            >
              <Text style={styles.cancelButtonLabel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PosCheckoutLinkEditor({
  disabled,
  field,
  onChange,
  value,
}: {
  disabled?: boolean;
  field: PosCheckoutFieldDefinition;
  onChange: (fieldname: string, value: string) => void;
  value: string;
}) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  const [isFocused, setIsFocused] = useState(false);
  const linkSearch = useCheckoutLinkOptions(
    isFocused ? field : undefined,
    value,
  );

  return (
    <>
      <TextInput
        accessibilityLabel={field.label}
        editable={!disabled}
        onChangeText={(nextValue) => onChange(field.fieldname, nextValue)}
        onFocus={() => setIsFocused(true)}
        placeholder={field.placeholder || `Search ${field.label}`}
        placeholderTextColor={palette.onSurfaceMuted}
        style={styles.input}
        value={value}
      />
      {isFocused ? (
        <View style={styles.linkResults}>
          {linkSearch.isLoading ? (
            <Text style={styles.fieldHelp}>Searching…</Text>
          ) : linkSearch.error ? (
            <Text style={styles.errorText}>{linkSearch.error}</Text>
          ) : linkSearch.options.length ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              style={styles.linkResultsScroll}
            >
              {linkSearch.options.map((option) => (
                <Pressable
                  accessibilityLabel={`Select ${option.label}`}
                  key={option.value}
                  onPress={() => {
                    onChange(field.fieldname, option.value);
                    setIsFocused(false);
                  }}
                  style={styles.linkOption}
                >
                  <Text style={styles.optionLabel}>{option.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.fieldHelp}>No matching records.</Text>
          )}
        </View>
      ) : null}
    </>
  );
}

function createStyles(palette: AppPalette) {
  return StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  cardHint: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.compact,
  },
  cardTitle: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  cancelButton: { alignItems: "center", padding: spacing.md },
  cancelButtonLabel: {
    color: palette.primary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  checkRow: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  checkText: { flex: 1, gap: spacing.xs },
  disabled: { opacity: 0.55 },
  errorText: {
    color: palette.error,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.compact,
  },
  field: { gap: spacing.xs, marginTop: spacing.sm },
  fieldHelp: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.compact,
  },
  fieldLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  input: {
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: palette.onSurface,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  longTextInput: {
    minHeight: 104,
    paddingTop: spacing.sm,
    textAlignVertical: "top",
  },
  linkOption: {
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  linkResults: {
    backgroundColor: palette.surfaceContainer,
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    maxHeight: 192,
    overflow: "hidden",
    padding: spacing.xs,
  },
  linkResultsScroll: { maxHeight: 176 },
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: palette.scrim,
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    maxHeight: "80%",
    padding: spacing.lg,
    width: "100%",
  },
  modalTitle: {
    color: palette.onSurface,
    marginBottom: spacing.sm,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  option: {
    borderBottomColor: palette.border,
    borderBottomWidth: 1,
    paddingVertical: spacing.md,
  },
  optionLabel: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  selectButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  selectButtonLabel: {
    color: palette.onSurface,
    flex: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  });
}
