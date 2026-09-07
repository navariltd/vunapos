import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';

import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { usePosCheckoutPreview, useSubmitPosCheckout } from '@/features/pos/hooks/usePosCheckout';
import { PosCartItem, PosCheckoutResult, PosOrderType, PosSaleCustomer } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosCheckoutScreenProps = {
  currency: string;
  items: PosCartItem[];
  onBack: () => void;
  onComplete: (result: PosCheckoutResult) => void;
  orderType: PosOrderType;
  saleCustomer: PosSaleCustomer | null;
  subtotal: number;
};

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { currency, currencyDisplay: 'code', maximumFractionDigits: 2, minimumFractionDigits: 2, style: 'currency' }).format(amount);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Final online-only checkout. Invoice totals are previewed by Frappe before
 * payment is entered; the submit endpoint repeats all stock and pricing checks.
 */
export function PosCheckoutScreen({ currency, items, onBack, onComplete, orderType, saleCustomer, subtotal }: PosCheckoutScreenProps) {
  const bootstrap = usePosBootstrap();
  const isInvoice = orderType === 'Invoice';
  const preview = usePosCheckoutPreview(isInvoice && bootstrap.data
    ? { customer: saleCustomer?.customer, items, posProfile: bootstrap.data.pos_profile.name }
    : null);
  const checkout = useSubmitPosCheckout();
  const [paymentMode, setPaymentMode] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [isCreditSale, setIsCreditSale] = useState(false);
  const [dueDate, setDueDate] = useState(today());
  const [validationError, setValidationError] = useState<string | null>(null);

  const profile = bootstrap.data?.pos_profile;
  const manualModes = (bootstrap.data?.payment_modes ?? []).filter((mode) => !mode.payment_gateway);
  const total = isInvoice
    ? (preview.data?.totals.rounded_total ?? preview.data?.totals.grand_total ?? 0)
    : subtotal;
  const selectedMode = paymentMode || manualModes.find((mode) => mode.default)?.mode_of_payment || manualModes[0]?.mode_of_payment || null;
  const enteredPayment = Number(paymentAmount || total);
  const canUseCredit = Boolean(isInvoice && profile?.allow_credit_sales && saleCustomer);

  function selectPaymentMode(mode: string) {
    setPaymentMode(mode);
    if (!paymentAmount) setPaymentAmount(String(total));
  }

  function setSaleType(nextCreditSale: boolean) {
    setIsCreditSale(nextCreditSale);
    setValidationError(null);
  }

  function requestSubmit() {
    setValidationError(null);
    if (!profile) {
      setValidationError('Could not load your POS profile. Return to the cart and try again.');
      return;
    }
    if (isInvoice && !preview.data) {
      setValidationError(preview.error || 'Waiting for the server to calculate this sale.');
      return;
    }
    if (isCreditSale && !dueDate) {
      setValidationError('Select a due date for this credit sale.');
      return;
    }
    if (!isCreditSale && isInvoice) {
      if (!selectedMode) {
        setValidationError('No manual payment mode is configured for this POS profile.');
        return;
      }
      if (!Number.isFinite(enteredPayment) || enteredPayment <= 0) {
        setValidationError('Enter a payment amount greater than zero.');
        return;
      }
      if (!profile.allow_partial_payment && enteredPayment < total) {
        setValidationError(`Payment must cover ${formatCurrency(total, currency)}.`);
        return;
      }
    }

    Alert.alert(
      isInvoice ? 'Complete sale?' : 'Submit sales order?',
      isInvoice
        ? `Frappe will confirm stock, prices, tax, and a payment of ${formatCurrency(isCreditSale ? 0 : enteredPayment, currency)} before submitting.`
        : 'Frappe will confirm stock, prices, and tax before submitting this order.',
      [
        { style: 'cancel', text: 'Cancel' },
        {
          onPress: () => void submit(),
          text: isInvoice ? 'Complete sale' : 'Submit order',
        },
      ],
    );
  }

  async function submit() {
    if (!profile) return;
    const result = await checkout.submit({
      customer: saleCustomer?.customer,
      dueDate: isCreditSale ? dueDate : undefined,
      isCreditSale,
      items,
      orderType,
      payments: !isCreditSale && isInvoice && selectedMode ? [{ amount: enteredPayment, mode_of_payment: selectedMode }] : [],
      posProfile: profile.name,
    });
    if (result) onComplete(result);
  }

  if (bootstrap.isLoading || (isInvoice && preview.isLoading)) {
    return <View style={styles.state}><Text style={styles.stateText}>Confirming current prices and stock…</Text></View>;
  }

  if (bootstrap.error || (isInvoice && preview.error)) {
    return (
      <View style={styles.state}>
        <Text style={styles.errorText}>{bootstrap.error || preview.error}</Text>
        <Pressable accessibilityLabel="Back to cart" onPress={onBack} style={styles.backToCartButton}><Text style={styles.backToCartLabel}>Back to cart</Text></Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Back to cart" disabled={checkout.isSubmitting} onPress={onBack} style={styles.backButton}>
          <MaterialCommunityIcons color={posDarkColors.onSurface} name="arrow-left" size={22} />
        </Pressable>
        <View style={styles.heading}>
          <Text style={styles.title}>{isInvoice ? 'Checkout' : 'Submit order'}</Text>
          <Text style={styles.subtitle}>{saleCustomer?.customerName || 'Walk-in customer'} · {items.length} item{items.length === 1 ? '' : 's'}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Server-confirmed totals</Text>
        {isInvoice && preview.data ? <>
          <SummaryRow label="Items" value={formatCurrency(preview.data.totals.net_total ?? total, currency)} />
          <SummaryRow label="Tax" value={formatCurrency(total - (preview.data.totals.net_total ?? total), currency)} />
        </> : <Text style={styles.cardHint}>Frappe will calculate final tax and totals when this Sales Order is submitted.</Text>}
        <View style={styles.totalRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalValue}>{formatCurrency(total, currency)}</Text></View>
      </View>

      {isInvoice ? <>
        {canUseCredit ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sale type</Text>
            <View style={styles.optionRow}>
              <Option active={!isCreditSale} label="Cash sale" onPress={() => setSaleType(false)} />
              <Option active={isCreditSale} label="Credit sale" onPress={() => setSaleType(true)} />
            </View>
            {isCreditSale ? <>
              <Text style={styles.fieldLabel}>Payment due date</Text>
              <TextInput accessibilityLabel="Credit sale due date" autoCapitalize="none" onChangeText={setDueDate} placeholder="YYYY-MM-DD" placeholderTextColor="#8f8f8f" style={styles.input} value={dueDate} />
            </> : null}
          </View>
        ) : null}

        {!isCreditSale ? <View style={styles.card}>
          <Text style={styles.cardTitle}>Payment</Text>
          <Text style={styles.cardHint}>Choose a manual payment mode. Gateway payments are completed separately and are not submitted from this screen.</Text>
          {manualModes.length ? <View style={styles.optionRow}>{manualModes.map((mode) => <Option active={selectedMode === mode.mode_of_payment} key={mode.mode_of_payment} label={mode.mode_of_payment} onPress={() => selectPaymentMode(mode.mode_of_payment)} />)}</View> : <Text style={styles.errorText}>No manual payment mode is configured for this POS profile.</Text>}
          <Text style={styles.fieldLabel}>Amount received</Text>
          <TextInput accessibilityLabel="Checkout payment amount" inputMode="decimal" keyboardType="decimal-pad" onChangeText={setPaymentAmount} placeholder={total.toFixed(2)} placeholderTextColor="#8f8f8f" style={styles.input} value={paymentAmount || String(total)} />
          {profile?.allow_partial_payment ? <Text style={styles.cardHint}>Partial payments are enabled for this POS profile.</Text> : null}
        </View> : null}
      </> : <View style={styles.card}><Text style={styles.cardTitle}>Sales Order</Text><Text style={styles.cardHint}>This order is submitted without an advance payment. Advance-payment and delivery options will follow in a dedicated order checkout increment.</Text></View>}

      {validationError || checkout.error ? <Text style={styles.errorText}>{validationError || checkout.error}</Text> : null}
      <Pressable accessibilityLabel={isInvoice ? 'Complete sale' : 'Submit sales order'} disabled={checkout.isSubmitting || !items.length} onPress={requestSubmit} style={[styles.submitButton, checkout.isSubmitting && styles.submitButtonDisabled]}>
        <Text style={styles.submitButtonLabel}>{checkout.isSubmitting ? 'Submitting…' : isInvoice ? `Complete sale · ${formatCurrency(total, currency)}` : 'Submit sales order'}</Text>
      </Pressable>
    </ScrollView>
  );
}

function Option({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityLabel={label} onPress={onPress} style={[styles.option, active && styles.optionActive]}><Text style={[styles.optionLabel, active && styles.optionLabelActive]}>{label}</Text></Pressable>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.summaryRow}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  backButton: { alignItems: 'center', borderColor: posDarkColors.border, borderRadius: radii.pill, borderWidth: 1, height: 40, justifyContent: 'center', width: 40 },
  backToCartButton: { borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  backToCartLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  card: { backgroundColor: posDarkColors.surface, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  cardHint: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny, lineHeight: typography.lineHeight.body },
  cardTitle: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  errorText: { color: posDarkColors.error, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body },
  fieldLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small, marginTop: spacing.xs },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  heading: { flex: 1, gap: 2 },
  input: { backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, color: posDarkColors.onSurface, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  option: { borderColor: posDarkColors.border, borderRadius: radii.pill, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 7 },
  optionActive: { backgroundColor: posDarkColors.primary, borderColor: posDarkColors.primary },
  optionLabel: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.medium, fontSize: typography.size.tiny },
  optionLabelActive: { color: posDarkColors.onPrimary },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  state: { alignItems: 'center', flex: 1, gap: spacing.md, justifyContent: 'center', padding: spacing.xl },
  stateText: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, textAlign: 'center' },
  submitButton: { alignItems: 'center', backgroundColor: posDarkColors.primary, borderRadius: radii.md, justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.md },
  submitButtonDisabled: { opacity: 0.45 },
  submitButtonLabel: { color: posDarkColors.onPrimary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  subtitle: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
  summaryLabel: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryValue: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.medium, fontSize: typography.size.small },
  title: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
  totalLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  totalRow: { borderTopColor: posDarkColors.border, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm },
  totalValue: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
});
