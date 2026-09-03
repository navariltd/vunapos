import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';

import { PosInvoiceHistoryFilters } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

const statusOptions: { label: string; value: PosInvoiceHistoryFilters['status'] }[] = [
  { label: 'All statuses', value: '' },
  { label: 'Paid', value: 'Paid' },
  { label: 'Partly paid', value: 'Partly Paid' },
  { label: 'Unpaid', value: 'Unpaid' },
  { label: 'Overdue', value: 'Overdue' },
  { label: 'Cancelled', value: 'Cancelled' },
  { label: 'Credit note', value: 'Credit Note' },
];

const saleTypeOptions: { label: string; value: PosInvoiceHistoryFilters['saleType'] }[] = [
  { label: 'All sales', value: '' },
  { label: 'Cash sale', value: 'Cash Sale' },
  { label: 'Credit sale', value: 'Credit Sale' },
];

type DateFilterField = 'fromDate' | 'toDate';
type SelectableFilterField = 'paymentMode' | 'saleType' | 'status';

type FilterOption = {
  label: string;
  value: string;
};

type FilterSelection = {
  field: SelectableFilterField;
  label: string;
  options: FilterOption[];
  value: string;
};

function formatFilterDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

function parseFilterDate(value: string) {
  const date = value ? new Date(`${value}T12:00:00`) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatDateLabel(value: string, placeholder: string) {
  if (!value) {
    return placeholder;
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parseFilterDate(value));
}

type PosInvoiceFiltersSheetProps = {
  filters: PosInvoiceHistoryFilters;
  onApply: () => void;
  onChange: <Key extends keyof PosInvoiceHistoryFilters>(field: Key, value: PosInvoiceHistoryFilters[Key]) => void;
  onClear: () => void;
  onDismiss: () => void;
  paymentModes: string[];
  visible: boolean;
};

type FilterSelectProps<Value extends string> = {
  accessibilityLabel: string;
  label: string;
  onPress: () => void;
  options: { label: string; value: Value }[];
  value: Value;
};

function FilterSelect<Value extends string>({ accessibilityLabel, label, onPress, options, value }: FilterSelectProps<Value>) {
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
        <Text numberOfLines={1} style={styles.selectValue}>{selectedLabel}</Text>
        <MaterialCommunityIcons color={posDarkColors.onSurfaceMuted} name="chevron-down" size={20} />
      </Pressable>
    </View>
  );
}

type FilterSelectionDialogProps = {
  onDismiss: () => void;
  onSelect: (value: string) => void;
  selection: FilterSelection | null;
};

function FilterSelectionDialog({ onDismiss, onSelect, selection }: FilterSelectionDialogProps) {
  if (!selection) {
    return null;
  }

  return (
    <View accessibilityViewIsModal style={styles.selectionOverlay}>
      <Pressable accessibilityLabel={`Dismiss ${selection.label} options`} onPress={onDismiss} style={styles.selectionScrim} />
      <View style={styles.selectionDialog}>
        <View style={styles.selectionHeader}>
          <Text style={styles.selectionTitle}>Select {selection.label.toLowerCase()}</Text>
          <Pressable accessibilityLabel="Close options" onPress={onDismiss} style={styles.selectionCloseButton}>
            <MaterialCommunityIcons color={posDarkColors.onSurface} name="close" size={20} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.selectionOptions} showsVerticalScrollIndicator={false}>
          {selection.options.map((option) => (
            <Pressable
              key={option.value || option.label}
              onPress={() => onSelect(option.value)}
              style={[styles.selectionOption, option.value === selection.value && styles.selectionOptionActive]}
            >
              <Text style={styles.selectionOptionLabel}>{option.label}</Text>
              {option.value === selection.value ? <MaterialCommunityIcons color={posDarkColors.onSurface} name="check" size={20} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

type DatePickerFieldProps = {
  accessibilityLabel: string;
  onPress: () => void;
  placeholder: string;
  value: string;
};

function DatePickerField({ accessibilityLabel, onPress, placeholder, value }: DatePickerFieldProps) {
  return (
    <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress} style={styles.datePickerField}>
      <Text numberOfLines={1} style={[styles.datePickerValue, !value && styles.datePickerPlaceholder]}>{formatDateLabel(value, placeholder)}</Text>
      <MaterialCommunityIcons color={posDarkColors.onSurfaceMuted} name="calendar-month-outline" size={19} />
    </Pressable>
  );
}

export function PosInvoiceFiltersSheet({
  filters,
  onApply,
  onChange,
  onClear,
  onDismiss,
  paymentModes,
  visible,
}: PosInvoiceFiltersSheetProps) {
  const insets = useSafeAreaInsets();
  const [datePickerField, setDatePickerField] = useState<DateFilterField | null>(null);
  const [selection, setSelection] = useState<FilterSelection | null>(null);
  const paymentModeOptions: { label: string; value: PosInvoiceHistoryFilters['paymentMode'] }[] = [
    { label: 'All payments', value: '' },
    ...paymentModes.map((paymentMode) => ({ label: paymentMode, value: paymentMode })),
  ];
  const selectedDate = datePickerField ? parseFilterDate(filters[datePickerField]) : new Date();

  function selectDate(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS === 'android') {
      setDatePickerField(null);
    }

    if (event.type === 'set' && selectedDate && datePickerField) {
      onChange(datePickerField, formatFilterDate(selectedDate));
    }
  }

  function openSelection(field: SelectableFilterField, label: string, options: FilterOption[], value: string) {
    setSelection({ field, label, options, value });
  }

  function selectFilterOption(value: string) {
    if (!selection) {
      return;
    }

    if (selection.field === 'status') {
      onChange('status', value as PosInvoiceHistoryFilters['status']);
    } else if (selection.field === 'paymentMode') {
      onChange('paymentMode', value);
    } else {
      onChange('saleType', value as PosInvoiceHistoryFilters['saleType']);
    }

    setSelection(null);
  }

  return (
    <Modal animationType="slide" onRequestClose={() => selection ? setSelection(null) : onDismiss()} presentationStyle="overFullScreen" statusBarTranslucent transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="Dismiss filters" onPress={onDismiss} style={styles.backdrop} />
        <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', default: undefined })} style={styles.keyboardView}>
          <View accessibilityViewIsModal style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.title}>Filter invoices</Text>
                <Text style={styles.subtitle}>Choose criteria, then apply them to sales history.</Text>
              </View>
              <Pressable accessibilityLabel="Close filters" onPress={onDismiss} style={styles.closeButton}>
                <MaterialCommunityIcons color={posDarkColors.onSurface} name="close" size={20} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>Invoice number</Text>
              <TextInput
                accessibilityLabel="Filter by invoice number"
                autoCapitalize="characters"
                onChangeText={(value) => onChange('invoice', value)}
                placeholder="Invoice number"
                placeholderTextColor="#8f8f8f"
                style={styles.input}
                value={filters.invoice}
              />

              <Text style={styles.label}>Customer ID</Text>
              <TextInput
                accessibilityLabel="Filter by customer ID"
                autoCapitalize="none"
                onChangeText={(value) => onChange('customer', value)}
                placeholder="Customer ID"
                placeholderTextColor="#8f8f8f"
                style={styles.input}
                value={filters.customer}
              />

              <Text style={styles.label}>Date range</Text>
              <View style={styles.dateRow}>
                <DatePickerField
                  accessibilityLabel="Select from date"
                  onPress={() => setDatePickerField('fromDate')}
                  placeholder="From date"
                  value={filters.fromDate}
                />
                <DatePickerField
                  accessibilityLabel="Select to date"
                  onPress={() => setDatePickerField('toDate')}
                  placeholder="To date"
                  value={filters.toDate}
                />
              </View>

              <View style={styles.selectRow}>
                <FilterSelect
                  accessibilityLabel="Select invoice status"
                  label="Status"
                  onPress={() => openSelection('status', 'Status', statusOptions, filters.status)}
                  options={statusOptions}
                  value={filters.status}
                />
                <FilterSelect
                  accessibilityLabel="Select payment mode"
                  label="Payment mode"
                  onPress={() => openSelection('paymentMode', 'Payment mode', paymentModeOptions, filters.paymentMode)}
                  options={paymentModeOptions}
                  value={filters.paymentMode}
                />
              </View>

              <View style={styles.selectRow}>
                <FilterSelect
                  accessibilityLabel="Select sale type"
                  label="Sale type"
                  onPress={() => openSelection('saleType', 'Sale type', saleTypeOptions, filters.saleType)}
                  options={saleTypeOptions}
                  value={filters.saleType}
                />
                <View style={styles.currentShiftField}>
                  <Text style={styles.label}>Current shift only</Text>
                  <View style={styles.currentShiftControl}>
                    <Text style={styles.currentShiftValue}>{filters.currentShift ? 'On' : 'Off'}</Text>
                    <Switch
                      accessibilityLabel="Current shift only"
                      onValueChange={(value) => onChange('currentShift', value)}
                      thumbColor={filters.currentShift ? posDarkColors.primary : posDarkColors.onSurfaceMuted}
                      trackColor={{ false: posDarkColors.surfaceContainerHigh, true: '#5f5f5f' }}
                      value={filters.currentShift}
                    />
                  </View>
                </View>
              </View>
            </ScrollView>

            {datePickerField ? (
              <DateTimePicker
                display={Platform.select({ android: 'default', ios: 'compact' })}
                maximumDate={datePickerField === 'fromDate' && filters.toDate ? parseFilterDate(filters.toDate) : new Date()}
                minimumDate={datePickerField === 'toDate' && filters.fromDate ? parseFilterDate(filters.fromDate) : undefined}
                mode="date"
                onChange={selectDate}
                value={selectedDate}
              />
            ) : null}

            <View style={[styles.footer, { paddingBottom: Math.max(spacing.md, insets.bottom) }]}>
              <Pressable onPress={onClear} style={styles.clearButton}>
                <Text style={styles.clearButtonLabel}>Clear filters</Text>
              </Pressable>
              <Pressable onPress={onApply} style={styles.applyButton}>
                <Text style={styles.applyButtonLabel}>Apply filters</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
        <FilterSelectionDialog onDismiss={() => setSelection(null)} onSelect={selectFilterOption} selection={selection} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  applyButton: {
    alignItems: 'center',
    backgroundColor: posDarkColors.primary,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  applyButtonLabel: {
    color: posDarkColors.onPrimary,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  clearButton: {
    alignItems: 'center',
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  clearButtonLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  closeButton: {
    alignItems: 'center',
    borderColor: posDarkColors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  content: {
    gap: spacing.sm,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  currentShiftControl: {
    alignItems: 'center',
    backgroundColor: posDarkColors.surfaceContainer,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    height: 44,
    justifyContent: 'space-between',
    paddingLeft: spacing.sm,
    paddingRight: 2,
  },
  currentShiftField: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  currentShiftValue: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
  },
  dateRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  datePickerField: {
    alignItems: 'center',
    backgroundColor: posDarkColors.surfaceContainer,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    height: 44,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  datePickerPlaceholder: {
    color: '#8f8f8f',
  },
  datePickerValue: {
    color: posDarkColors.onSurface,
    flex: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  footer: {
    backgroundColor: posDarkColors.surface,
    borderTopColor: posDarkColors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: posDarkColors.border,
    borderRadius: radii.pill,
    height: 4,
    marginTop: spacing.sm,
    width: 40,
  },
  input: {
    backgroundColor: posDarkColors.surfaceContainer,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    height: 44,
    paddingHorizontal: spacing.sm,
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  label: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  modalRoot: {
    flex: 1,
  },
  sheet: {
    backgroundColor: posDarkColors.surface,
    borderColor: posDarkColors.border,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderTopWidth: 1,
    maxHeight: '88%',
  },
  sheetHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  selectButton: {
    alignItems: 'center',
    backgroundColor: posDarkColors.surfaceContainer,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    height: 44,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
  },
  selectionCloseButton: {
    alignItems: 'center',
    borderColor: posDarkColors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  selectionDialog: {
    backgroundColor: posDarkColors.surfaceContainerHigh,
    borderColor: posDarkColors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    elevation: 24,
    maxHeight: '72%',
    overflow: 'hidden',
    width: '100%',
  },
  selectionHeader: {
    alignItems: 'center',
    borderBottomColor: posDarkColors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  selectionOption: {
    alignItems: 'center',
    borderBottomColor: posDarkColors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  selectionOptionActive: {
    backgroundColor: '#3a3a3a',
  },
  selectionOptionLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.body,
  },
  selectionOptions: {
    paddingBottom: spacing.xs,
  },
  selectionOverlay: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: spacing.lg,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
  },
  selectionScrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  selectionTitle: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 18,
  },
  selectRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  selectValue: {
    color: posDarkColors.onSurface,
    flex: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
  },
  selectWrapper: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
    position: 'relative',
  },
  subtitle: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
    marginTop: 2,
    maxWidth: 280,
  },
  title: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 19,
  },
});
