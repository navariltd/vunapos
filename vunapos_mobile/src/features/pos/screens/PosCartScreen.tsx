import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';

import { PosCustomerPickerSheet } from '@/features/pos/components/PosCustomerPickerSheet';
import { KeyboardAwareFormScroll } from '@/components/layout/KeyboardAwareFormScroll';
import { PosCartItem, PosCartTax, PosCartTotals, PosCustomerSearchResult, PosOrderType, PosSaleCustomer } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosCartScreenProps = {
  currency: string;
  error: string | null;
  isUpdating: boolean;
  items: PosCartItem[];
  onBack: () => void;
  onCheckout: () => void;
  onClearSaleCustomer: () => void;
  onSelectSaleCustomer: (customer: PosCustomerSearchResult) => void;
  onClear: () => void;
  onRemove: (itemCode: string) => void;
  onRetry: () => void;
  onUpdateQuantity: (itemCode: string, quantity: number) => void;
  orderType: PosOrderType;
  requiresCustomer: boolean;
  saleCustomer: PosSaleCustomer | null;
  subtotal: number;
  taxes: PosCartTax[];
  totals: PosCartTotals;
};

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { currency, currencyDisplay: 'code', minimumFractionDigits: 2, maximumFractionDigits: 2, style: 'currency' }).format(amount);
}

function CartLine({ currency, disabled, item, onRemove, onUpdateQuantity }: { currency: string; disabled: boolean; item: PosCartItem; onRemove: () => void; onUpdateQuantity: (quantity: number) => void }) {
  const [draftQuantity, setDraftQuantity] = useState(String(item.qty));
  const maximum = item.is_stock_item && !item.allow_negative_stock && item.available_qty !== null ? item.available_qty : null;

  function changeQuantity(value: string) {
    if (/^\d*\.?\d*$/.test(value)) setDraftQuantity(value);
  }

  function commitQuantity() {
    const quantity = Number(draftQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setDraftQuantity(String(item.qty));
      return;
    }
    onUpdateQuantity(quantity);
  }

  return (
    <View style={styles.item}>
      <View style={styles.itemHeader}>
        <View style={styles.itemMain}>
          <Text numberOfLines={2} style={styles.itemName}>{item.item_name}</Text>
          <Text style={styles.itemCode}>{item.item_code}</Text>
          <Text style={styles.itemRate}>{formatCurrency(item.rate, currency)} · {item.uom || 'Unit'}</Text>
        </View>
        <Pressable accessibilityLabel={`Remove ${item.item_name} from cart`} disabled={disabled} onPress={onRemove} style={[styles.removeButton, disabled && styles.controlDisabled]}>
          <MaterialCommunityIcons color={posDarkColors.error} name="trash-can-outline" size={19} />
        </Pressable>
      </View>
      <View style={styles.itemFooter}>
        <View style={styles.quantityControl}>
          <Pressable accessibilityLabel={`Decrease quantity for ${item.item_name}`} disabled={disabled} onPress={() => onUpdateQuantity(item.qty - 1)} style={[styles.quantityButton, disabled && styles.controlDisabled]}>
            <MaterialCommunityIcons color={posDarkColors.onSurface} name="minus" size={18} />
          </Pressable>
          <TextInput
            accessibilityLabel={`Quantity for ${item.item_name}`}
            inputMode="decimal"
            keyboardType="decimal-pad"
            editable={!disabled}
            onBlur={commitQuantity}
            onChangeText={changeQuantity}
            selectTextOnFocus
            style={styles.quantityInput}
            value={draftQuantity}
          />
          <Pressable accessibilityLabel={`Increase quantity for ${item.item_name}`} disabled={disabled || (maximum !== null && item.qty >= maximum)} onPress={() => onUpdateQuantity(item.qty + 1)} style={[styles.quantityButton, (disabled || (maximum !== null && item.qty >= maximum)) && styles.quantityButtonDisabled]}>
            <MaterialCommunityIcons color={posDarkColors.onSurface} name="plus" size={18} />
          </Pressable>
        </View>
        <View style={styles.lineTotal}>
          <Text style={styles.lineTotalLabel}>Line total</Text>
          <Text style={styles.lineTotalAmount}>{formatCurrency(item.amount ?? item.qty * item.rate, currency)}</Text>
        </View>
      </View>
      {maximum !== null ? <Text style={styles.stockHint}>Available {maximum} {item.uom || ''}</Text> : null}
    </View>
  );
}

export function PosCartScreen({ currency, error, isUpdating, items, onBack, onCheckout, onClear, onClearSaleCustomer, onRemove, onRetry, onSelectSaleCustomer, onUpdateQuantity, orderType, requiresCustomer, saleCustomer, subtotal, taxes, totals }: PosCartScreenProps) {
  const [customerPickerVisible, setCustomerPickerVisible] = useState(false);

  return (
    <KeyboardAwareFormScroll contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} style={styles.scrollView}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Back to items" onPress={onBack} style={styles.backButton}>
          <MaterialCommunityIcons color={posDarkColors.onSurface} name="arrow-left" size={22} />
        </Pressable>
        <View style={styles.heading}>
          <Text style={styles.title}>Cart</Text>
          <Text style={styles.subtitle}>{orderType}</Text>
        </View>
        {items.length ? <Pressable accessibilityLabel="Clear cart" disabled={isUpdating} onPress={onClear} style={[styles.clearButton, isUpdating && styles.controlDisabled]}><Text style={styles.clearButtonLabel}>Clear</Text></Pressable> : null}
      </View>

      {items.length ? (
        <>
          <Pressable accessibilityHint="Opens a searchable customer list" accessibilityLabel="Select sale customer" disabled={isUpdating} onPress={() => setCustomerPickerVisible(true)} style={[styles.customerSelector, isUpdating && styles.controlDisabled]}>
            <View style={styles.customerSelectorMain}>
              <Text numberOfLines={1} style={styles.customerSelectorValue}>{saleCustomer?.customerName || 'Select customer'}</Text>
              <Text numberOfLines={1} style={styles.customerSelectorMeta}>{saleCustomer?.customer || 'Search or choose from the list'}</Text>
            </View>
            <MaterialCommunityIcons color={posDarkColors.onSurfaceMuted} name="chevron-down" size={20} />
          </Pressable>
          {saleCustomer ? <Pressable accessibilityLabel="Clear sale customer" disabled={isUpdating} onPress={onClearSaleCustomer} style={[styles.clearCustomerButton, isUpdating && styles.controlDisabled]}><Text style={styles.clearCustomerButtonLabel}>Clear customer</Text></Pressable> : null}
          <View style={styles.itemList}>
            {items.map((item) => <CartLine currency={currency} disabled={isUpdating} item={item} key={item.item_code} onRemove={() => onRemove(item.item_code)} onUpdateQuantity={(quantity) => onUpdateQuantity(item.item_code, quantity)} />)}
          </View>
          {isUpdating ? <Text style={styles.updatingText}>Updating cart…</Text> : null}
          {error ? <View style={styles.errorState}><Text style={styles.errorText}>{error}</Text><Pressable accessibilityLabel="Retry updating cart" onPress={onRetry} style={styles.retryButton}><Text style={styles.retryButtonLabel}>Try again</Text></Pressable></View> : null}
          {requiresCustomer ? <Text style={styles.customerRequired}>Select a customer to calculate current pricing, tax, and stock before checkout.</Text> : null}
          <View style={styles.summary}>
            <Text style={styles.summaryLabel}>Net total</Text>
            <Text style={styles.summaryAmount}>{formatCurrency(subtotal, currency)}</Text>
          </View>
          {taxes.map((tax, index) => <View key={`${tax.account_head || tax.description || 'tax'}-${index}`} style={styles.summaryRow}><Text style={styles.summaryRowLabel}>{`${tax.description || tax.account_head || 'Tax'}${tax.rate !== undefined ? ` (${tax.rate}%)` : ''}${tax.included_in_print_rate ? ' · included' : ''}`}</Text><Text style={styles.summaryRowAmount}>{formatCurrency(tax.tax_amount || 0, currency)}</Text></View>)}
          {totals.total_taxes_and_charges !== undefined ? <View style={styles.summaryRow}><Text style={styles.summaryRowLabel}>Total taxes and charges</Text><Text style={styles.summaryRowAmount}>{formatCurrency(totals.total_taxes_and_charges, currency)}</Text></View> : null}
          <View style={styles.grandTotal}><Text style={styles.grandTotalLabel}>Grand total</Text><Text style={styles.grandTotalAmount}>{formatCurrency(totals.grand_total ?? subtotal, currency)}</Text></View>
          {totals.rounded_total !== undefined && totals.rounded_total !== totals.grand_total ? <View style={styles.summaryRow}><Text style={styles.summaryRowLabel}>Rounded total</Text><Text style={styles.summaryRowAmount}>{formatCurrency(totals.rounded_total, currency)}</Text></View> : null}
          <Text style={styles.checkoutNote}>Payment is collected at checkout.</Text>
          <Pressable accessibilityLabel="Proceed to checkout" disabled={isUpdating || Boolean(error) || requiresCustomer} onPress={onCheckout} style={[styles.checkoutButton, (isUpdating || error || requiresCustomer) && styles.checkoutButtonDisabled]}><Text style={styles.checkoutButtonLabel}>Proceed to checkout</Text></Pressable>
        </>
      ) : (
        <View style={styles.emptyState}>
          <MaterialCommunityIcons color={posDarkColors.onSurfaceMuted} name="cart-outline" size={42} />
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptyText}>Add items from the catalogue to start this {orderType.toLowerCase()}.</Text>
          {error ? <View style={styles.errorState}><Text style={styles.errorText}>{error}</Text><Pressable accessibilityLabel="Retry adding item to cart" onPress={onRetry} style={styles.retryButton}><Text style={styles.retryButtonLabel}>Try again</Text></Pressable></View> : null}
          <Pressable accessibilityLabel="Browse items" onPress={onBack} style={styles.browseButton}><Text style={styles.browseButtonLabel}>Browse items</Text></Pressable>
        </View>
      )}
      <PosCustomerPickerSheet
        onDismiss={() => setCustomerPickerVisible(false)}
        onSelect={(customer) => {
          onSelectSaleCustomer(customer);
          setCustomerPickerVisible(false);
        }}
        visible={customerPickerVisible}
      />
    </KeyboardAwareFormScroll>
  );
}

const styles = StyleSheet.create({
  backButton: { alignItems: 'center', borderColor: posDarkColors.border, borderRadius: radii.pill, borderWidth: 1, height: 40, justifyContent: 'center', width: 40 },
  browseButton: { borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  browseButtonLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  checkoutButton: { alignItems: 'center', backgroundColor: posDarkColors.primary, borderRadius: radii.md, justifyContent: 'center', minHeight: 48 },
  checkoutButtonDisabled: { backgroundColor: posDarkColors.disabled, opacity: 0.5 },
  checkoutButtonLabel: { color: posDarkColors.onPrimary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  checkoutNote: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny, lineHeight: typography.lineHeight.body, textAlign: 'center' },
  clearButton: { borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  clearButtonLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.tiny },
  clearCustomerButton: { alignItems: 'center', borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  clearCustomerButtonLabel: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.tiny },
  controlDisabled: { opacity: 0.5 },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  customerSelector: { alignItems: 'center', backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 54, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  customerSelectorMain: { flex: 1, gap: 1 },
  customerSelectorMeta: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  customerSelectorValue: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  customerRequired: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny, lineHeight: typography.lineHeight.body, textAlign: 'center' },
  emptyState: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xxl },
  errorState: { alignItems: 'center', backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.error, borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.sm },
  errorText: { color: posDarkColors.error, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, textAlign: 'center' },
  emptyText: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, lineHeight: typography.lineHeight.body, textAlign: 'center' },
  emptyTitle: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  heading: { flex: 1, gap: 2 },
  item: { backgroundColor: posDarkColors.surface, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  itemCode: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  itemFooter: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  itemHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  itemList: { gap: spacing.sm },
  itemMain: { flex: 1, gap: 2 },
  itemName: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  itemRate: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  lineTotal: { alignItems: 'flex-end', gap: 2 },
  lineTotalAmount: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  lineTotalLabel: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  quantityButton: { alignItems: 'center', borderColor: posDarkColors.border, borderRadius: radii.sm, borderWidth: 1, height: 34, justifyContent: 'center', width: 34 },
  quantityButtonDisabled: { opacity: 0.4 },
  quantityControl: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs },
  retryButton: { borderColor: posDarkColors.border, borderRadius: radii.sm, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  retryButtonLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.tiny },
  quantityInput: { backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.sm, borderWidth: 1, color: posDarkColors.onSurface, fontFamily: typography.fontFamily.medium, fontSize: typography.size.small, height: 34, includeFontPadding: false, lineHeight: typography.lineHeight.compact, minWidth: 52, paddingHorizontal: spacing.xs, paddingVertical: 0, textAlign: 'center', textAlignVertical: 'center' },
  removeButton: { alignItems: 'center', borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, height: 36, justifyContent: 'center', width: 36 },
  stockHint: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  scrollView: { flex: 1 },
  subtitle: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
  summary: { borderTopColor: posDarkColors.border, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.md },
  summaryAmount: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
  summaryLabel: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryRowAmount: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.medium, fontSize: typography.size.small },
  summaryRowLabel: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
  title: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
  updatingText: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny, textAlign: 'center' },
  grandTotal: { borderTopColor: posDarkColors.border, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm },
  grandTotalAmount: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
  grandTotalLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
});
