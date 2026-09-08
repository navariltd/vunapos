import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from 'react-native-paper';

import { KeyboardAwareFormScroll } from '@/components/layout/KeyboardAwareFormScroll';
import { useCreateInvoiceReturn } from '@/features/pos/hooks/useCreateInvoiceReturn';
import { useInvoiceReturnPreview } from '@/features/pos/hooks/useInvoiceReturnPreview';
import { PosInvoiceReturn, PosInvoiceReturnPreviewItem } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosInvoiceReturnPreviewSheetProps = {
  currency: string;
  invoiceName: string;
  onComplete: (returnInvoice: PosInvoiceReturn) => void;
  onDismiss: () => void;
  posProfile: string;
  visible: boolean;
};

type SelectedReturnItem = { qty: number; row_name: string };

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { currency, currencyDisplay: 'code', maximumFractionDigits: 2, minimumFractionDigits: 2, style: 'currency' }).format(amount);
}

function formatQuantity(quantity: number, uom?: string | null) {
  return `${quantity} ${uom || ''}`.trim();
}

function quantityFor(item: PosInvoiceReturnPreviewItem, quantities: Record<string, string>) {
  const quantity = Number(quantities[item.row_name] || 0);
  return Number.isFinite(quantity) ? quantity : 0;
}

/** Creates a server-validated credit note from the returnable rows on an invoice. */
export function PosInvoiceReturnPreviewSheet({ currency, invoiceName, onComplete, onDismiss, posProfile, visible }: PosInvoiceReturnPreviewSheetProps) {
  const insets = useSafeAreaInsets();
  const preview = useInvoiceReturnPreview({ enabled: visible, invoiceName, posProfile });
  const { create, error: createError, isSubmitting } = useCreateInvoiceReturn();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [selectedRows, setSelectedRows] = useState<Record<string, true>>({});
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [createdReturn, setCreatedReturn] = useState<PosInvoiceReturn | null>(null);
  const displayCurrency = preview.data?.currency || currency;
  const returnableItems = preview.data?.items.filter((item) => item.returnable_qty > 0) ?? [];
  const selectedItems = returnableItems.flatMap((item): SelectedReturnItem[] => {
    const qty = quantityFor(item, quantities);
    return qty > 0 ? [{ qty, row_name: item.row_name }] : [];
  });
  const estimatedCredit = returnableItems.reduce((total, item) => total + (quantityFor(item, quantities) * item.rate), 0);

  function updateQuantity(item: PosInvoiceReturnPreviewItem, value: string) {
    if (!/^\d*\.?\d*$/.test(value)) return;
    const quantity = Number(value || 0);
    const nextValue = Number.isFinite(quantity) && quantity > item.returnable_qty ? String(item.returnable_qty) : value;
    setQuantities((current) => ({ ...current, [item.row_name]: nextValue }));
    setValidationError(null);
  }

  function toggleItem(item: PosInvoiceReturnPreviewItem) {
    const isSelected = Boolean(selectedRows[item.row_name]);
    setSelectedRows((current) => {
      if (!isSelected) return { ...current, [item.row_name]: true };
      const { [item.row_name]: _removed, ...remaining } = current;
      return remaining;
    });
    setQuantities((current) => ({ ...current, [item.row_name]: isSelected ? '' : String(item.returnable_qty) }));
    setValidationError(null);
  }

  function returnAllAvailableItems() {
    setSelectedRows(Object.fromEntries(returnableItems.map((item) => [item.row_name, true])));
    setQuantities(Object.fromEntries(returnableItems.map((item) => [item.row_name, String(item.returnable_qty)])));
    setValidationError(null);
  }

  async function createReturn() {
    const result = await create({ invoiceName, items: selectedItems, posProfile, reason: reason.trim() });
    if (!result) return;

    setCreatedReturn({
      docstatus: result.invoice.docstatus,
      grand_total: result.invoice.totals.rounded_total || result.invoice.totals.grand_total || 0,
      name: result.invoice.name,
      posting_date: result.invoice.posting_date,
    });
  }

  function confirmReturn() {
    setValidationError(null);
    if (!selectedItems.length) {
      setValidationError('Add at least one item to this return.');
      return;
    }
    if (!reason.trim()) {
      setValidationError('Enter a reason for this return.');
      return;
    }
    if (selectedItems.some((selected) => {
      const item = returnableItems.find((candidate) => candidate.row_name === selected.row_name);
      return !item || !Number.isFinite(selected.qty) || selected.qty > item.returnable_qty;
    })) {
      setValidationError('One or more quantities are no longer available. Review the selected items.');
      return;
    }

    Alert.alert(
      'Create credit note?',
      `This will return ${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'} for an estimated ${formatCurrency(estimatedCredit, displayCurrency)}.`,
      [
        { style: 'cancel', text: 'Cancel' },
        { onPress: () => void createReturn(), style: 'destructive', text: 'Create credit note' },
      ],
    );
  }

  return (
    <Modal animationType="slide" onRequestClose={isSubmitting ? undefined : onDismiss} presentationStyle="overFullScreen" statusBarTranslucent transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="Dismiss return items" disabled={isSubmitting} onPress={onDismiss} style={styles.backdrop} />
        <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding', default: undefined })} style={styles.keyboardView}>
          <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.heading}>
                <Text style={styles.title}>Return items</Text>
                <Text style={styles.subtitle}>Create a credit note against {invoiceName}.</Text>
              </View>
              <Pressable accessibilityLabel="Close return items" disabled={isSubmitting} onPress={onDismiss} style={styles.closeButton}><Text style={styles.closeButtonLabel}>Close</Text></Pressable>
            </View>

            {createdReturn ? (
              <View style={styles.successState}>
                <Text style={styles.successTitle}>{createdReturn.name} created</Text>
                <Text style={styles.successText}>The credit note has been submitted successfully.</Text>
                <Pressable accessibilityLabel="View created credit note" onPress={() => onComplete(createdReturn)} style={styles.submitButton}>
                  <Text style={styles.submitButtonLabel}>View credit note</Text>
                </Pressable>
              </View>
            ) : preview.isLoading ? <View style={styles.state}><Text style={styles.stateText}>Preparing return…</Text></View> : null}
            {!createdReturn && preview.error ? <View style={styles.state}><Text style={styles.errorText}>{preview.error}</Text></View> : null}
            {!createdReturn && preview.data ? (
              <KeyboardAwareFormScroll contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} showsVerticalScrollIndicator={false} style={styles.formScroll}>
                {returnableItems.length ? returnableItems.map((item) => {
                  const selected = Boolean(selectedRows[item.row_name]);

                  return (
                    <View key={item.row_name} style={[styles.item, selected && styles.itemSelected]}>
                      <View style={styles.itemHeading}>
                        <View style={styles.itemMain}>
                          <Text style={styles.itemName}>{item.item_name}</Text>
                          <Text style={styles.itemCode}>{item.item_code}</Text>
                        </View>
                        <Text style={styles.itemAmount}>{formatCurrency(item.return_amount, displayCurrency)}</Text>
                      </View>
                      <View style={styles.quantities}>
                        <Text style={styles.quantity}>Sold {formatQuantity(item.sold_qty, item.uom)}</Text>
                        <Text style={styles.quantity}>Returned {formatQuantity(item.returned_qty, item.uom)}</Text>
                        <Text style={styles.available}>Available {formatQuantity(item.returnable_qty, item.uom)}</Text>
                      </View>
                      <Pressable accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${item.item_name} ${selected ? 'from' : 'to'} return`} disabled={isSubmitting} onPress={() => toggleItem(item)} style={[styles.itemAction, selected && styles.itemActionSelected]}>
                        <Text style={[styles.itemActionLabel, selected && styles.itemActionLabelSelected]}>{selected ? 'Remove item' : 'Add to return'}</Text>
                      </Pressable>
                      {selected ? (
                        <View style={styles.quantityEditor}>
                          <Text style={styles.quantityLabel}>Return quantity</Text>
                          <TextInput
                            accessibilityLabel={`Return quantity for ${item.item_name}`}
                            editable={!isSubmitting}
                            inputMode="decimal"
                            keyboardType="decimal-pad"
                            onChangeText={(value) => updateQuantity(item, value)}
                            placeholder="0"
                            placeholderTextColor="#8f8f8f"
                            style={styles.quantityInput}
                            value={quantities[item.row_name] || ''}
                          />
                          <Text style={styles.quantityHint}>Maximum {formatQuantity(item.returnable_qty, item.uom)}</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                }) : <View style={styles.state}><Text style={styles.stateText}>All items on this invoice have already been returned.</Text></View>}

                {returnableItems.length ? (
                  <>
                    <Pressable accessibilityLabel="Return all available items" disabled={isSubmitting} onPress={returnAllAvailableItems} style={styles.returnAllButton}>
                      <Text style={styles.returnAllButtonLabel}>Return all available items</Text>
                    </Pressable>
                    <Text style={styles.reasonLabel}>Reason for return</Text>
                    <TextInput
                      accessibilityLabel="Reason for return"
                      editable={!isSubmitting}
                      multiline
                      onChangeText={setReason}
                      placeholder="Damaged item, wrong product, customer return…"
                      placeholderTextColor="#8f8f8f"
                      style={styles.reasonInput}
                      textAlignVertical="top"
                      value={reason}
                    />
                    <View style={styles.summary}>
                      <Text style={styles.summaryLabel}>Estimated credit</Text>
                      <Text style={styles.summaryAmount}>{formatCurrency(estimatedCredit, displayCurrency)}</Text>
                    </View>
                    {validationError || createError ? <Text style={styles.errorText}>{validationError || createError}</Text> : null}
                    <Pressable accessibilityLabel="Create return credit note" disabled={!selectedItems.length || !reason.trim() || isSubmitting} onPress={confirmReturn} style={[styles.submitButton, (!selectedItems.length || !reason.trim() || isSubmitting) && styles.submitButtonDisabled]}>
                      <Text style={styles.submitButtonLabel}>{isSubmitting ? 'Creating credit note…' : 'Create credit note'}</Text>
                    </Pressable>
                  </>
                ) : null}
              </KeyboardAwareFormScroll>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  available: { color: '#86efac', fontFamily: typography.fontFamily.semibold, fontSize: typography.size.tiny },
  backdrop: { backgroundColor: 'rgba(0, 0, 0, 0.6)', ...StyleSheet.absoluteFill },
  closeButton: { borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  closeButtonLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.tiny },
  content: { gap: spacing.sm, paddingTop: spacing.md },
  errorText: { color: posDarkColors.error, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body, textAlign: 'center' },
  formScroll: { flex: 1 },
  handle: { alignSelf: 'center', backgroundColor: '#555', borderRadius: radii.pill, height: 4, marginTop: spacing.xs, width: 40 },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md },
  heading: { flex: 1, gap: 4 },
  item: { borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.sm },
  itemAction: { alignSelf: 'flex-start', borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  itemActionLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.tiny },
  itemActionLabelSelected: { color: posDarkColors.onPrimary },
  itemActionSelected: { backgroundColor: posDarkColors.primary, borderColor: posDarkColors.primary },
  itemAmount: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  itemCode: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  itemHeading: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  itemMain: { flex: 1, gap: 2 },
  itemName: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.medium, fontSize: typography.size.small },
  itemSelected: { borderColor: posDarkColors.primary },
  keyboardView: { justifyContent: 'flex-end', maxHeight: '100%' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  quantities: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  quantity: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  quantityEditor: { gap: spacing.xs },
  quantityHint: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  quantityInput: { backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, color: posDarkColors.onSurface, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, height: 44, paddingHorizontal: spacing.sm },
  quantityLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  reasonInput: { backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, color: posDarkColors.onSurface, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, minHeight: 92, padding: spacing.sm },
  reasonLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small, marginTop: spacing.sm },
  returnAllButton: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  returnAllButtonLabel: { color: posDarkColors.primary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  sheet: { backgroundColor: posDarkColors.surface, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, flexShrink: 1, maxHeight: '88%', paddingHorizontal: spacing.md },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl },
  stateText: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body, textAlign: 'center' },
  submitButton: { alignItems: 'center', backgroundColor: posDarkColors.primary, borderRadius: radii.md, justifyContent: 'center', minHeight: 48, paddingHorizontal: spacing.md },
  submitButtonDisabled: { opacity: 0.45 },
  submitButtonLabel: { color: posDarkColors.onPrimary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  subtitle: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body },
  successState: { gap: spacing.md, paddingVertical: spacing.xl },
  successText: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, lineHeight: typography.lineHeight.body },
  successTitle: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
  summary: { borderTopColor: posDarkColors.border, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm, paddingTop: spacing.md },
  summaryAmount: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  summaryLabel: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
  title: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
});
