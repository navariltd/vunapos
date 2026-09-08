import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';

import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { KeyboardAwareFormScroll } from '@/components/layout/KeyboardAwareFormScroll';
import { usePosCheckoutPreview, useSubmitPosCheckout } from '@/features/pos/hooks/usePosCheckout';
import {
  allocateAllToMode,
  allocatePaymentRemainderToNextMode,
  buildPaymentInputs,
  calculatePaymentAllocation,
  canCompletePaymentAllocation,
  createInitialPaymentAmounts,
  currencyScale,
  minorUnitsToInput,
  totalToMinorUnits,
} from '@/features/pos/paymentAllocation';
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

function formatCurrency(amount: number, currency: string, precision = 2) {
  return new Intl.NumberFormat(undefined, { currency, currencyDisplay: 'code', maximumFractionDigits: precision, minimumFractionDigits: precision, style: 'currency' }).format(amount);
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
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const [isCreditSale, setIsCreditSale] = useState(false);
  const appliedSaleTypeDefault = useRef(false);
  const initializedPaymentKey = useRef<string | null>(null);
  const [dueDate, setDueDate] = useState(today());
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitConfirmationVisible, setIsSubmitConfirmationVisible] = useState(false);

  const profile = bootstrap.data?.pos_profile;
  const manualModes = (bootstrap.data?.payment_modes ?? []).filter((mode) => !mode.payment_gateway);
  const total = isInvoice
    ? (preview.data?.totals.rounded_total ?? preview.data?.totals.grand_total ?? 0)
    : subtotal;
  const precision = profile?.currency_precision ?? 2;
  const totalMinor = totalToMinorUnits(total, precision);
  const allocation = calculatePaymentAllocation(manualModes, paymentAmounts, totalMinor, precision);
  const paymentInputs = buildPaymentInputs(manualModes, paymentAmounts, precision);
  const paymentModeKey = manualModes.map((mode) => mode.mode_of_payment).join('|');
  const hasNonCashOverpayment = allocation.nonCashMinor > totalMinor;
  const canUseCredit = Boolean(isInvoice && profile?.allow_credit_sales);
  const canSubmitPayment = Boolean(
    !isInvoice || isCreditSale || (manualModes.length && canCompletePaymentAllocation(allocation, totalMinor, Boolean(profile?.allow_partial_payment))),
  );
  const isPaymentOverpaid = allocation.remainingMinor < 0;
  const paymentBalanceLabel = isPaymentOverpaid
    ? 'Change'
    : isCreditSale || (allocation.remainingMinor > 0 && profile?.allow_partial_payment)
      ? 'Outstanding'
      : 'Remaining';
  const paymentStatus = allocation.hasInvalidAmount
    ? 'Invalid allocation'
    : hasNonCashOverpayment
      ? 'Overpayment not allowed'
      : isPaymentOverpaid
        ? 'Change due'
        : allocation.remainingMinor === 0
          ? 'Fully paid'
          : profile?.allow_partial_payment
            ? 'Partial payment'
            : 'Payment incomplete';
  const isReadyToSubmit = Boolean(
    items.length && !checkout.isSubmitting && (isInvoice ? (isCreditSale ? dueDate : canSubmitPayment) : true),
  );

  useEffect(() => {
    if (appliedSaleTypeDefault.current || !profile) return;
    setIsCreditSale(Boolean(isInvoice && profile.allow_credit_sales && profile.default_sale_type === 'Credit Sale'));
    appliedSaleTypeDefault.current = true;
  }, [isInvoice, profile]);

  useEffect(() => {
    if (!isInvoice || isCreditSale || !manualModes.length || totalMinor <= 0) return;
    const nextKey = `${paymentModeKey}:${totalMinor}`;
    if (initializedPaymentKey.current === nextKey) return;
    initializedPaymentKey.current = nextKey;
    setPaymentAmounts(createInitialPaymentAmounts(manualModes, totalMinor, precision));
  }, [isCreditSale, isInvoice, manualModes, paymentModeKey, precision, totalMinor]);

  function selectPaymentMode(mode: string) {
    setPaymentAmounts(allocateAllToMode(manualModes, mode, totalMinor, precision));
  }

  function setPaymentAmount(mode: string, amount: string) {
    setPaymentAmounts((current) => {
      const next = { ...current, [mode]: amount };
      return profile?.auto_allocate_payment_balance
        ? allocatePaymentRemainderToNextMode(manualModes, next, mode, totalMinor, precision)
        : next;
    });
  }

  function setSaleType(nextCreditSale: boolean) {
    setIsCreditSale(nextCreditSale);
    setPaymentAmounts(nextCreditSale
      ? Object.fromEntries(manualModes.map((mode) => [mode.mode_of_payment, '']))
      : createInitialPaymentAmounts(manualModes, totalMinor, precision));
    initializedPaymentKey.current = nextCreditSale ? null : `${paymentModeKey}:${totalMinor}`;
    setValidationError(null);
    checkout.clearError();
  }

  function requestSubmit() {
    setValidationError(null);
    checkout.clearError();
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
      if (!manualModes.length) {
        setValidationError('No manual payment mode is configured for this POS profile.');
        return;
      }
      if (allocation.hasInvalidAmount) {
        setValidationError('Enter valid payment amounts using the configured currency precision.');
        return;
      }
      if (hasNonCashOverpayment) {
        setValidationError('Electronic payments cannot exceed the invoice total.');
        return;
      }
      if (!canCompletePaymentAllocation(allocation, totalMinor, Boolean(profile.allow_partial_payment))) {
        setValidationError(profile.allow_partial_payment
          ? 'Allocate a payment amount greater than zero.'
          : `Payment must cover ${formatCurrency(total, currency, precision)}.`);
        return;
      }
    }

    setIsSubmitConfirmationVisible(true);
  }

  async function submit() {
    if (!profile) return;
    const result = await checkout.submit({
      customer: saleCustomer?.customer,
      dueDate: isCreditSale ? dueDate : undefined,
      isCreditSale,
      items,
      orderType,
      payments: !isCreditSale && isInvoice ? paymentInputs : [],
      posProfile: profile.name,
    });
    if (result) onComplete(result);
  }

  const submissionLabel = isInvoice ? 'sales invoice' : 'sales order';
  const customerName = saleCustomer?.customerName || 'Walk-in customer';

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
    <KeyboardAwareFormScroll contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} style={styles.scrollView}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Back to cart" disabled={checkout.isSubmitting} onPress={onBack} style={styles.backButton}>
          <MaterialCommunityIcons color={posDarkColors.onSurface} name="arrow-left" size={22} />
        </Pressable>
        <View style={styles.heading}>
          <Text style={styles.title}>{isInvoice ? 'Checkout' : 'Submit order'}</Text>
          <Text style={styles.subtitle}>{customerName} · {items.length} item{items.length === 1 ? '' : 's'}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Cart totals</Text>
        {isInvoice && preview.data ? <>
          <SummaryRow label="Items" value={formatCurrency(preview.data.totals.net_total ?? total, currency, precision)} />
          <SummaryRow label="Tax" value={formatCurrency(total - (preview.data.totals.net_total ?? total), currency, precision)} />
        </> : <Text style={styles.cardHint}>Frappe will calculate final tax and totals when this Sales Order is submitted.</Text>}
        <View style={styles.totalRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalValue}>{formatCurrency(total, currency, precision)}</Text></View>
      </View>

      {isInvoice ? <>
        {canUseCredit ? (
          <View style={styles.card}>
            <View style={styles.creditSaleRow}>
              <View style={styles.creditSaleText}>
                <Text style={styles.cardTitle}>Credit sale</Text>
                <Text style={styles.cardHint}>Record an outstanding balance with a payment due date.</Text>
              </View>
              <Switch
                accessibilityLabel="Enable credit sale"
                accessibilityRole="switch"
                accessibilityState={{ checked: isCreditSale }}
                onValueChange={setSaleType}
                thumbColor={posDarkColors.onSurface}
                trackColor={{ false: posDarkColors.border, true: '#39b976' }}
                value={isCreditSale}
              />
            </View>
            {isCreditSale ? <>
              <Text style={styles.fieldLabel}>Payment due date</Text>
              <TextInput accessibilityLabel="Credit sale due date" autoCapitalize="none" onChangeText={setDueDate} placeholder="YYYY-MM-DD" placeholderTextColor="#8f8f8f" style={styles.input} value={dueDate} />
            </> : null}
          </View>
        ) : null}

        {!isCreditSale ? <View style={styles.card}>
          <Text style={styles.cardTitle}>Payment methods</Text>
          <View style={styles.paymentSummaryRow}>
            <PaymentSummary label="Allocated" value={formatCurrency(allocation.allocatedMinor / currencyScale(precision), currency, precision)} />
            <PaymentSummary label={paymentBalanceLabel} value={formatCurrency(Math.abs(allocation.remainingMinor) / currencyScale(precision), currency, precision)} />
            <PaymentSummary label="Status" value={paymentStatus} />
          </View>
          <Text style={styles.cardHint}>Tap a payment mode to allocate the full balance, or enter amounts to split the payment.</Text>
          {manualModes.length ? <View style={styles.paymentModes}>
            {manualModes.map((mode) => {
              const amount = paymentAmounts[mode.mode_of_payment] ?? '';
              const isAll = amount === minorUnitsToInput(totalMinor, precision)
                && manualModes.every((other) => other.mode_of_payment === mode.mode_of_payment || !(paymentAmounts[other.mode_of_payment]));
              return <View key={mode.mode_of_payment} style={styles.paymentModeRow}>
                <Pressable accessibilityLabel={`Allocate all to ${mode.mode_of_payment}`} onPress={() => selectPaymentMode(mode.mode_of_payment)} style={[styles.paymentModeButton, isAll && styles.paymentModeButtonActive]}>
                  <Text style={[styles.paymentModeLabel, isAll && styles.paymentModeLabelActive]}>{mode.mode_of_payment}{mode.default ? ' · Default' : ''}</Text>
                </Pressable>
                <View style={styles.paymentAmountWrap}>
                  <Text style={styles.currencyPrefix}>{currency}</Text>
                  <TextInput
                    accessibilityLabel={`${mode.mode_of_payment} amount`}
                    inputMode="decimal"
                    keyboardType="decimal-pad"
                    onChangeText={(amountInput) => setPaymentAmount(mode.mode_of_payment, amountInput)}
                    placeholder={minorUnitsToInput(0, precision)}
                    placeholderTextColor="#8f8f8f"
                    style={styles.paymentAmountInput}
                    value={amount}
                  />
                </View>
              </View>;
            })}
          </View> : <Text style={styles.errorText}>No manual payment mode is configured for this POS profile.</Text>}
          {profile?.allow_partial_payment ? <Text style={styles.cardHint}>Partial payments are enabled for this POS profile.</Text> : null}
          {hasNonCashOverpayment ? <Text style={styles.errorText}>Only cash can exceed the total and return change.</Text> : null}
        </View> : null}
      </> : <View style={styles.card}><Text style={styles.cardTitle}>Sales Order</Text><Text style={styles.cardHint}>This order is submitted without an advance payment. Advance-payment and delivery options will follow in a dedicated order checkout increment.</Text></View>}

      {validationError || checkout.error ? <Text style={styles.errorText}>{validationError || checkout.error}</Text> : null}
      <Pressable accessibilityLabel={isInvoice ? 'Complete sale' : 'Submit sales order'} accessibilityState={{ disabled: !isReadyToSubmit }} disabled={!isReadyToSubmit} onPress={requestSubmit} style={[styles.submitButton, !isReadyToSubmit && styles.submitButtonDisabled]}>
        <Text style={styles.submitButtonLabel}>{checkout.isSubmitting ? 'Submitting…' : isInvoice ? `Complete sale · ${formatCurrency(total, currency, precision)}` : 'Submit sales order'}</Text>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => { if (!checkout.isSubmitting) setIsSubmitConfirmationVisible(false); }}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={isSubmitConfirmationVisible}
      >
        <View style={styles.confirmationModalRoot}>
          <Pressable
            accessibilityLabel="Dismiss sale confirmation"
            disabled={checkout.isSubmitting}
            onPress={() => setIsSubmitConfirmationVisible(false)}
            style={styles.confirmationBackdrop}
          />
          <View accessibilityViewIsModal style={styles.confirmationDialog}>
            {checkout.isSubmitting ? <>
              <ActivityIndicator color={posDarkColors.primary} size="small" />
              <Text style={styles.confirmationTitle}>Submitting {submissionLabel}…</Text>
              <Text style={styles.confirmationDescription}>Please wait while the sale is confirmed.</Text>
            </> : <>
              <Text style={styles.confirmationTitle}>Confirm submission of {submissionLabel} for {customerName}?</Text>
              <Text style={styles.confirmationDescription}>{isCreditSale ? 'This will submit the sale as credit with its payment due date.' : 'This will submit the sale and its selected payment allocation.'}</Text>
              {checkout.error ? <Text style={styles.errorText}>{checkout.error}</Text> : null}
              <View style={styles.confirmationActions}>
                <Pressable accessibilityLabel="Cancel sale submission" onPress={() => setIsSubmitConfirmationVisible(false)} style={styles.cancelConfirmationButton}>
                  <Text style={styles.cancelConfirmationLabel}>Cancel</Text>
                </Pressable>
                <Pressable accessibilityLabel={isInvoice ? 'Confirm sales invoice submission' : 'Confirm sales order submission'} onPress={() => void submit()} style={styles.confirmConfirmationButton}>
                  <Text style={styles.confirmConfirmationLabel}>{isInvoice ? 'Submit invoice' : 'Submit order'}</Text>
                </Pressable>
              </View>
            </>}
          </View>
        </View>
      </Modal>
    </KeyboardAwareFormScroll>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.summaryRow}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>;
}

function PaymentSummary({ label, value }: { label: string; value: string }) {
  return <View style={styles.paymentSummary}><Text style={styles.paymentSummaryLabel}>{label}</Text><Text numberOfLines={1} style={styles.paymentSummaryValue}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  backButton: { alignItems: 'center', borderColor: posDarkColors.border, borderRadius: radii.pill, borderWidth: 1, height: 40, justifyContent: 'center', width: 40 },
  backToCartButton: { borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  backToCartLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  card: { backgroundColor: posDarkColors.surface, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  cardHint: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny, lineHeight: typography.lineHeight.body },
  cardTitle: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  cancelConfirmationButton: { alignItems: 'center', borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.sm },
  cancelConfirmationLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  confirmConfirmationButton: { alignItems: 'center', backgroundColor: posDarkColors.primary, borderRadius: radii.md, flex: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.sm },
  confirmConfirmationLabel: { color: posDarkColors.onPrimary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  confirmationActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  confirmationBackdrop: { backgroundColor: 'rgba(0, 0, 0, 0.68)', ...StyleSheet.absoluteFill },
  confirmationDescription: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, lineHeight: typography.lineHeight.body },
  confirmationDialog: { backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.lg, borderWidth: 1, gap: spacing.md, marginHorizontal: spacing.lg, padding: spacing.lg },
  confirmationModalRoot: { flex: 1, justifyContent: 'center' },
  confirmationTitle: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 19, lineHeight: typography.lineHeight.body },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  creditSaleRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  creditSaleText: { flex: 1, gap: 3 },
  errorText: { color: posDarkColors.error, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body },
  fieldLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small, marginTop: spacing.xs },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  heading: { flex: 1, gap: 2 },
  input: { backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, color: posDarkColors.onSurface, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  currencyPrefix: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.medium, fontSize: typography.size.tiny },
  paymentAmountInput: { color: posDarkColors.onSurface, flex: 1, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm, textAlign: 'right' },
  paymentAmountWrap: { alignItems: 'center', backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, flexDirection: 'row', minHeight: 46, paddingLeft: spacing.sm },
  paymentModeButton: { alignItems: 'center', backgroundColor: posDarkColors.surfaceContainerHigh, borderColor: 'transparent', borderRadius: radii.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: spacing.sm },
  paymentModeButtonActive: { backgroundColor: posDarkColors.primary, borderColor: posDarkColors.primary },
  paymentModeLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small, textAlign: 'center' },
  paymentModeLabelActive: { color: posDarkColors.onPrimary },
  paymentModeRow: { flexDirection: 'row', gap: spacing.sm },
  paymentModes: { gap: spacing.sm },
  paymentSummary: { flex: 1, gap: 2 },
  paymentSummaryLabel: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  paymentSummaryRow: { backgroundColor: posDarkColors.surfaceContainer, borderRadius: radii.sm, flexDirection: 'row', gap: spacing.xs, padding: spacing.sm },
  paymentSummaryValue: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  scrollView: { flex: 1 },
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
