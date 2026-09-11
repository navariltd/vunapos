import { MaterialCommunityIcons } from '@expo/vector-icons';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';

import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { usePosCustomerLoyalty } from '@/features/pos/hooks/usePosCustomerLoyalty';
import { useGatewayPayment } from '@/features/pos/hooks/useGatewayPayment';
import { useGatewayPaymentRealtime } from '@/features/pos/hooks/useGatewayPaymentRealtime';
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
  parsePaymentAmount,
  totalToMinorUnits,
} from '@/features/pos/paymentAllocation';
import { PosC2BGatewayPayment, PosCartItem, PosCheckoutResult, PosGatewayPaymentLink, PosOrderType, PosPaymentMode, PosSaleCustomer } from '@/features/pos/types';
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

function dateFromInput(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(dateFromInput(value));
}

function taxLabel(description?: string, accountHead?: string, rate?: number, included?: boolean) {
  const name = description || accountHead || 'Tax';
  const rateLabel = rate === undefined || rate === null ? '' : ` · ${rate}%${included ? ' included' : ''}`;
  return `${name}${rateLabel}`;
}

function isSuccessfulGatewayPayment(link?: PosGatewayPaymentLink) {
  return link?.status === 'Authorized' || link?.status === 'Paid';
}

function isPendingGatewayPayment(link?: PosGatewayPaymentLink) {
  return link?.status === 'Draft' || link?.status === 'Pending';
}

function createGatewayIdempotencyKey(modeOfPayment: string) {
  return `mobile-gateway-${modeOfPayment}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Final online-only checkout. Invoice totals are previewed by Frappe before
 * payment is entered; the submit endpoint repeats all stock and pricing checks.
 */
export function PosCheckoutScreen({ currency, items, onBack, onComplete, orderType, saleCustomer, subtotal }: PosCheckoutScreenProps) {
  const bootstrap = usePosBootstrap();
  const isInvoice = orderType === 'Invoice';
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [loyaltyInput, setLoyaltyInput] = useState('');
  const [loyaltyError, setLoyaltyError] = useState<string | null>(null);
  const [isApplyingLoyalty, setIsApplyingLoyalty] = useState(false);
  const [checkoutTaxId, setCheckoutTaxId] = useState('');
  const preview = usePosCheckoutPreview(isInvoice && bootstrap.data
    ? { customer: saleCustomer?.customer, items, loyaltyPoints, posProfile: bootstrap.data.pos_profile.name }
    : null);
  const checkout = useSubmitPosCheckout();
  const gatewayPayment = useGatewayPayment();
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const [paymentReferences, setPaymentReferences] = useState<Record<string, { referenceDate: string; referenceNo: string }>>({});
  const [gatewayLinks, setGatewayLinks] = useState<Record<string, PosGatewayPaymentLink | undefined>>({});
  const [activeGatewayMode, setActiveGatewayMode] = useState<PosPaymentMode | null>(null);
  const [gatewayPhone, setGatewayPhone] = useState('');
  const [gatewayMethod, setGatewayMethod] = useState<'STK' | 'C2B'>('STK');
  const [c2bQuery, setC2bQuery] = useState('');
  const [c2bResults, setC2bResults] = useState<PosC2BGatewayPayment[]>([]);
  const [isC2bSearching, setIsC2bSearching] = useState(false);
  const [hasC2bSearched, setHasC2bSearched] = useState(false);
  const [isCreditSale, setIsCreditSale] = useState(false);
  const appliedSaleTypeDefault = useRef(false);
  const initializedPaymentKey = useRef<string | null>(null);
  const gatewayIdempotencyKeys = useRef<Record<string, string>>({});
  const [dueDate, setDueDate] = useState(today());
  const [deliveryDate, setDeliveryDate] = useState(today());
  const [isDueDatePickerVisible, setIsDueDatePickerVisible] = useState(false);
  const [isDeliveryDatePickerVisible, setIsDeliveryDatePickerVisible] = useState(false);
  const [referenceDateMode, setReferenceDateMode] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitConfirmationVisible, setIsSubmitConfirmationVisible] = useState(false);

  const updateGatewayPaymentFromRealtime = useCallback((payment: PosGatewayPaymentLink) => {
    setGatewayLinks((current) => {
      const currentLink = current[payment.mode_of_payment];
      if (!currentLink || currentLink.name !== payment.name) return current;
      return { ...current, [payment.mode_of_payment]: { ...currentLink, ...payment } };
    });
  }, []);
  useGatewayPaymentRealtime(updateGatewayPaymentFromRealtime);

  const profile = bootstrap.data?.pos_profile;
  const customerLoyalty = usePosCustomerLoyalty(isInvoice ? saleCustomer?.customer : undefined, profile?.name);
  const profilePaymentModes = profile?.modes_of_payment ?? [];
  const manualModes = (bootstrap.data?.payment_modes ?? [])
    .filter((mode) => !mode.payment_gateway)
    .map((mode) => ({
      ...mode,
      requires_reference: mode.requires_reference
        ?? profilePaymentModes.find((profileMode) => profileMode.mode_of_payment === mode.mode_of_payment)?.requires_reference,
    }));
  const gatewayModes = (bootstrap.data?.payment_modes ?? []).filter((mode) => Boolean(mode.payment_gateway));
  const paymentModes = [...manualModes, ...gatewayModes];
  const invoiceTotal = isInvoice
    ? (preview.data?.totals.rounded_total ?? preview.data?.totals.grand_total ?? 0)
    : subtotal;
  const loyaltyAmount = isInvoice ? (preview.data?.loyalty_amount ?? 0) : 0;
  const total = Math.max(invoiceTotal - loyaltyAmount, 0);
  const netTotal = preview.data?.totals.net_total ?? invoiceTotal;
  const grandTotal = preview.data?.totals.grand_total ?? invoiceTotal;
  const roundedTotal = preview.data?.totals.rounded_total;
  const taxTotal = preview.data?.totals.total_taxes_and_charges ?? Math.max(grandTotal - netTotal, 0);
  const postingDate = preview.data?.posting_date ?? today();
  const precision = profile?.currency_precision ?? 2;
  const totalMinor = totalToMinorUnits(total, precision);
  const availableLoyaltyPoints = Math.max(Math.floor(customerLoyalty.data?.points ?? 0), 0);
  const loyaltyConversionFactor = Math.max(customerLoyalty.data?.conversion_factor ?? 0, 0);
  const maximumLoyaltyPoints = loyaltyConversionFactor > 0
    ? Math.min(availableLoyaltyPoints, Math.floor(invoiceTotal / loyaltyConversionFactor))
    : 0;
  const loyaltyInputPoints = /^\d+$/.test(loyaltyInput) ? Number(loyaltyInput) : null;
  const loyaltyInputError = Boolean(loyaltyInput && (!loyaltyInputPoints || loyaltyInputPoints > maximumLoyaltyPoints));
  const appliedLoyaltyPoints = Math.floor(preview.data?.loyalty_points ?? 0);
  const isLoyaltySelectionValid = appliedLoyaltyPoints <= maximumLoyaltyPoints;
  const isWalkinCustomer = Boolean(saleCustomer?.isWalkin);
  const allocation = calculatePaymentAllocation(paymentModes, paymentAmounts, totalMinor, precision);
  const allocationInputs = buildPaymentInputs(paymentModes, paymentAmounts, precision, paymentReferences);
  const paymentInputs = allocationInputs.map((payment) => {
    const gatewayLink = gatewayLinks[payment.mode_of_payment];
    return gatewayLink && isSuccessfulGatewayPayment(gatewayLink)
      ? { ...payment, gateway_payment_link: gatewayLink.name }
      : payment;
  });
  const paymentModeKey = paymentModes.map((mode) => mode.mode_of_payment).join('|');
  const hasNonCashOverpayment = allocation.nonCashMinor > totalMinor;
  const missingReferenceMode = paymentInputs.find((payment) => manualModes.find(
    (mode) => mode.mode_of_payment === payment.mode_of_payment,
  )?.requires_reference && !payment.reference_no)?.mode_of_payment;
  const hasMissingPaymentReference = Boolean(missingReferenceMode);
  const hasUnverifiedGatewayPayment = allocationInputs.some((payment) => gatewayModes.some(
    (mode) => mode.mode_of_payment === payment.mode_of_payment,
  ) && !isSuccessfulGatewayPayment(gatewayLinks[payment.mode_of_payment]));
  const allowsSalesOrderAdvancePayments = Boolean(!isInvoice && profile?.allow_sales_order_payments);
  const hasSalesOrderAdvanceOverpayment = allowsSalesOrderAdvancePayments && allocation.allocatedMinor > totalMinor;
  const canUseCredit = Boolean(isInvoice && profile?.allow_credit_sales);
  const canSubmitPayment = Boolean(
    isInvoice
      ? (totalMinor === 0 || paymentModes.length) && (isCreditSale
        ? !allocation.hasInvalidAmount && !hasNonCashOverpayment
        : canCompletePaymentAllocation(allocation, totalMinor, Boolean(profile?.allow_partial_payment))) && !hasMissingPaymentReference && !hasUnverifiedGatewayPayment
      : !allowsSalesOrderAdvancePayments || (!allocation.hasInvalidAmount && !hasSalesOrderAdvanceOverpayment && !hasMissingPaymentReference && !hasUnverifiedGatewayPayment),
  );
  const isPaymentOverpaid = allocation.remainingMinor < 0;
  const paymentBalanceLabel = isPaymentOverpaid
    ? 'Change'
    : isCreditSale || (allocation.remainingMinor > 0 && profile?.allow_partial_payment)
      ? 'Outstanding'
      : 'Remaining';
  const paymentStatus = allocation.hasInvalidAmount
    ? 'Invalid allocation'
    : hasUnverifiedGatewayPayment
      ? 'Gateway verification required'
    : hasMissingPaymentReference
      ? 'Reference required'
    : hasSalesOrderAdvanceOverpayment
      ? 'Advance exceeds order total'
    : hasNonCashOverpayment
      ? 'Overpayment not allowed'
      : isPaymentOverpaid
        ? 'Change due'
        : !isInvoice
          ? allocation.allocatedMinor > 0
            ? 'Advance payment'
            : 'No advance'
        : allocation.remainingMinor === 0
          ? 'Fully paid'
          : isCreditSale && allocation.allocatedMinor > 0
            ? 'Deposit + credit'
            : isCreditSale
              ? 'Credit sale'
              : profile?.allow_partial_payment
                ? 'Partial payment'
                : 'Payment incomplete';
  const isReadyToSubmit = Boolean(
    items.length && !checkout.isSubmitting && !isApplyingLoyalty && isLoyaltySelectionValid && (isInvoice ? (isCreditSale ? dueDate >= postingDate && canSubmitPayment : canSubmitPayment) : deliveryDate >= today() && canSubmitPayment),
  );
  const paidAmount = allocation.allocatedMinor / currencyScale(precision);
  const checkoutBalanceAmount = Math.abs(allocation.remainingMinor / currencyScale(precision));
  const checkoutBalanceLabel = isPaymentOverpaid
    ? 'Cash change'
    : isCreditSale || allocation.remainingMinor > 0
      ? 'Outstanding'
      : 'Balance';

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

  useEffect(() => {
    const link = activeGatewayMode ? gatewayLinks[activeGatewayMode.mode_of_payment] : undefined;
    if (!link || !isPendingGatewayPayment(link)) return;
    const timeout = setTimeout(() => void refreshGatewayPayment(), 3000);
    return () => clearTimeout(timeout);
    // The poll must restart only when its server link changes, not while a request updates local UI state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGatewayMode, gatewayLinks]);

  function selectPaymentMode(mode: string) {
    setPaymentAmounts(allocateAllToMode(paymentModes, mode, totalMinor, precision));
    setActiveGatewayMode(null);
  }

  function setPaymentAmount(mode: string, amount: string) {
    setPaymentAmounts((current) => {
      const next = { ...current, [mode]: amount };
      return profile?.auto_allocate_payment_balance
        ? allocatePaymentRemainderToNextMode(manualModes, next, mode, totalMinor, precision)
        : next;
    });
  }

  function openGatewayPayment(mode: PosPaymentMode) {
    gatewayPayment.clearError();
    setPaymentAmounts(allocateAllToMode(paymentModes, mode.mode_of_payment, totalMinor, precision));
    setGatewayPhone(saleCustomer?.mobile || '');
    setGatewayMethod('STK');
    setC2bQuery('');
    setC2bResults([]);
    setHasC2bSearched(false);
    setActiveGatewayMode(mode);
  }

  function clearGatewayPayment(modeOfPayment: string) {
    setGatewayLinks((current) => ({ ...current, [modeOfPayment]: undefined }));
    setPaymentAmounts(createInitialPaymentAmounts(manualModes, totalMinor, precision));
    setActiveGatewayMode(null);
  }

  async function initiateGatewayPayment() {
    if (!activeGatewayMode || !profile) return;
    const amountMinor = parsePaymentAmount(paymentAmounts[activeGatewayMode.mode_of_payment] || '', precision) || 0;
    if (!amountMinor || !gatewayPhone.trim()) return;
    const modeOfPayment = activeGatewayMode.mode_of_payment;
    const idempotencyKey = gatewayIdempotencyKeys.current[modeOfPayment]
      || (gatewayIdempotencyKeys.current[modeOfPayment] = createGatewayIdempotencyKey(modeOfPayment));
    const link = await gatewayPayment.initiate({
      amount: amountMinor / currencyScale(precision),
      currency,
      customer: saleCustomer?.customer,
      idempotencyKey,
      modeOfPayment,
      phoneNumber: gatewayPhone.trim(),
      posProfile: profile.name,
    });
    if (link) setGatewayLinks((current) => ({ ...current, [modeOfPayment]: link }));
  }

  async function refreshGatewayPayment() {
    if (!activeGatewayMode) return;
    const modeOfPayment = activeGatewayMode.mode_of_payment;
    const link = gatewayLinks[modeOfPayment];
    if (!link) return;
    const nextLink = await gatewayPayment.getStatus(link.name);
    if (nextLink) setGatewayLinks((current) => ({ ...current, [modeOfPayment]: nextLink }));
  }

  async function cancelGatewayPayment() {
    if (!activeGatewayMode) return;
    const link = gatewayLinks[activeGatewayMode.mode_of_payment];
    if (link) await gatewayPayment.cancel(link.name);
    clearGatewayPayment(activeGatewayMode.mode_of_payment);
  }

  async function searchC2BGatewayPayments() {
    if (!activeGatewayMode || !profile || c2bQuery.trim().length < 3) return;
    setIsC2bSearching(true);
    setHasC2bSearched(true);
    const payments = await gatewayPayment.searchC2B({
      currency,
      customer: saleCustomer?.customer,
      modeOfPayment: activeGatewayMode.mode_of_payment,
      posProfile: profile.name,
      query: c2bQuery.trim(),
    });
    setC2bResults(payments || []);
    setIsC2bSearching(false);
  }

  async function attachC2BGatewayPayment(payment: PosC2BGatewayPayment) {
    if (!activeGatewayMode || !profile) return;
    const modeOfPayment = activeGatewayMode.mode_of_payment;
    const amountMinor = parsePaymentAmount(paymentAmounts[modeOfPayment] || '', precision) || 0;
    if (!amountMinor || totalToMinorUnits(payment.amount, precision) !== amountMinor) return;
    const idempotencyKey = gatewayIdempotencyKeys.current[modeOfPayment]
      || (gatewayIdempotencyKeys.current[modeOfPayment] = createGatewayIdempotencyKey(modeOfPayment));
    const link = await gatewayPayment.attachC2B({
      amount: amountMinor / currencyScale(precision),
      currency,
      customer: saleCustomer?.customer,
      idempotencyKey,
      modeOfPayment,
      posProfile: profile.name,
      transactionReference: payment.transaction_id,
    });
    if (link) {
      setGatewayLinks((current) => ({ ...current, [modeOfPayment]: link }));
      setActiveGatewayMode(null);
    }
  }

  function setPaymentReferenceNo(mode: string, referenceNo: string) {
    setPaymentReferences((current) => ({
      ...current,
      [mode]: { referenceDate: current[mode]?.referenceDate || today(), referenceNo },
    }));
  }

  function setPaymentReferenceDate(mode: string, referenceDate: string) {
    setPaymentReferences((current) => ({
      ...current,
      [mode]: { referenceDate, referenceNo: current[mode]?.referenceNo || '' },
    }));
  }

  function setSaleType(nextCreditSale: boolean) {
    setIsCreditSale(nextCreditSale);
    setPaymentAmounts(nextCreditSale
      ? Object.fromEntries(paymentModes.map((mode) => [mode.mode_of_payment, '']))
      : createInitialPaymentAmounts(manualModes, totalMinor, precision));
    setGatewayLinks({});
    setActiveGatewayMode(null);
    initializedPaymentKey.current = nextCreditSale ? null : `${paymentModeKey}:${totalMinor}`;
    setValidationError(null);
    checkout.clearError();
  }

  async function applyLoyaltyPoints(points: number) {
    if (points < 0 || points > maximumLoyaltyPoints) {
      setLoyaltyError(`Enter between 1 and ${maximumLoyaltyPoints.toLocaleString()} points.`);
      return;
    }
    setLoyaltyError(null);
    setIsApplyingLoyalty(true);
    try {
      const loyaltyPreview = await preview.previewLoyalty(Math.floor(points));
      const validatedPoints = Math.floor(loyaltyPreview.loyalty_points ?? 0);
      const validatedInvoiceTotal = loyaltyPreview.totals.rounded_total ?? loyaltyPreview.totals.grand_total ?? 0;
      const validatedPayableMinor = totalToMinorUnits(Math.max(validatedInvoiceTotal - (loyaltyPreview.loyalty_amount ?? 0), 0), precision);
      setLoyaltyPoints(validatedPoints);
      setLoyaltyInput(validatedPoints ? String(validatedPoints) : '');
      setPaymentAmounts(isCreditSale
        ? Object.fromEntries(paymentModes.map((mode) => [mode.mode_of_payment, '']))
        : createInitialPaymentAmounts(manualModes, validatedPayableMinor, precision));
      setGatewayLinks({});
      setActiveGatewayMode(null);
      initializedPaymentKey.current = isCreditSale ? null : `${paymentModeKey}:${validatedPayableMinor}`;
    } catch (error) {
      setLoyaltyError(error instanceof Error ? error.message : 'Unable to validate loyalty redemption.');
    } finally {
      setIsApplyingLoyalty(false);
    }
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
    if (isCreditSale && dueDate < postingDate) {
      setValidationError('The credit sale due date cannot be before the posting date.');
      return;
    }
    if (!isInvoice && deliveryDate < today()) {
      setValidationError('The Sales Order delivery date cannot be before today.');
      return;
    }
    if (!isInvoice && allowsSalesOrderAdvancePayments && allocation.hasInvalidAmount) {
      setValidationError('Enter valid advance-payment amounts using the configured currency precision.');
      return;
    }
    if (!isInvoice && hasSalesOrderAdvanceOverpayment) {
      setValidationError('Sales Order advance payments cannot exceed the order total.');
      return;
    }
    if (hasMissingPaymentReference) {
      setValidationError(`Enter the transaction reference for ${missingReferenceMode}.`);
      return;
    }
    if (hasUnverifiedGatewayPayment) {
      setValidationError('Verify the selected gateway payment before completing this sale.');
      return;
    }
    if (isInvoice) {
      if (totalMinor > 0 && !manualModes.length) {
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
      if (!isCreditSale && !canCompletePaymentAllocation(allocation, totalMinor, Boolean(profile.allow_partial_payment))) {
        setValidationError(profile.allow_partial_payment
          ? 'Allocate a payment amount greater than zero.'
          : `Payment must cover ${formatCurrency(total, currency, precision)}.`);
        return;
      }
      if (!isLoyaltySelectionValid) {
        setValidationError('The available loyalty balance changed. Apply a valid number of points again.');
        return;
      }
    }

    setIsSubmitConfirmationVisible(true);
  }

  async function submit() {
    if (!profile) return;
    const result = await checkout.submit({
      customer: saleCustomer?.customer,
      deliveryDate: !isInvoice ? deliveryDate : undefined,
      dueDate: isCreditSale ? dueDate : undefined,
      isCreditSale,
      items,
      loyaltyPoints: appliedLoyaltyPoints || undefined,
      orderType,
      payments: isInvoice || allowsSalesOrderAdvancePayments ? paymentInputs : [],
      posProfile: profile.name,
      taxId: isWalkinCustomer ? checkoutTaxId.trim() || undefined : undefined,
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
        <Text style={styles.cardTitle}>Checkout summary</Text>
        {isInvoice && preview.data ? <>
          <SummaryRow label="Customer" value={customerName} />
          <View style={styles.summaryDivider} />
          <Text style={styles.summarySectionTitle}>Items</Text>
          <View style={styles.summaryItems}>
            {preview.data.items.map((item) => <SummaryRow key={item.row_name || item.item_code} label={`${item.qty} × ${item.item_name}`} value={formatCurrency(item.amount, currency, precision)} />)}
          </View>
          <View style={styles.summaryDivider} />
          <SummaryRow label="Subtotal" value={formatCurrency(netTotal, currency, precision)} />
          {(preview.data.taxes ?? []).map((tax, index) => <SummaryRow key={`${tax.account_head || tax.description || 'tax'}-${index}`} label={taxLabel(tax.description, tax.account_head, tax.rate, tax.included_in_print_rate)} value={formatCurrency(tax.tax_amount ?? 0, currency, precision)} />)}
          <SummaryRow label="Total taxes and charges" value={formatCurrency(taxTotal, currency, precision)} />
          <View style={styles.totalRow}><Text style={styles.totalLabel}>Grand total</Text><Text style={styles.totalValue}>{formatCurrency(grandTotal, currency, precision)}</Text></View>
          {roundedTotal !== undefined && roundedTotal !== grandTotal ? <SummaryRow label="Rounded total" value={formatCurrency(roundedTotal, currency, precision)} /> : null}
          {loyaltyAmount ? <>
            <SummaryRow label="Loyalty redemption" value={`−${formatCurrency(loyaltyAmount, currency, precision)}`} />
            <SummaryRow label="Amount payable" value={formatCurrency(total, currency, precision)} />
          </> : null}
          <View style={styles.summaryDivider} />
          <SummaryRow label="Paid amount" value={formatCurrency(paidAmount, currency, precision)} />
          <SummaryRow label={checkoutBalanceLabel} value={formatCurrency(checkoutBalanceAmount, currency, precision)} />
        </> : <Text style={styles.cardHint}>Frappe will calculate final tax and totals when this Sales Order is submitted.</Text>}
      </View>

      {!isInvoice ? <View style={styles.card}>
        <Text style={styles.cardTitle}>Sales Order</Text>
        <Text style={styles.cardHint}>Choose when this order should be delivered.</Text>
        <Text style={styles.fieldLabel}>Delivery date</Text>
        <Pressable accessibilityLabel="Choose Sales Order delivery date" onPress={() => setIsDeliveryDatePickerVisible(true)} style={styles.datePickerButton}>
          <MaterialCommunityIcons color={posDarkColors.onSurfaceMuted} name="calendar-month-outline" size={20} />
          <Text style={styles.datePickerButtonLabel}>{formatDate(deliveryDate)}</Text>
        </Pressable>
        {isDeliveryDatePickerVisible ? <DateTimePicker
          accentColor={posDarkColors.primary}
          minimumDate={dateFromInput(today())}
          mode="date"
          negativeButton={{ label: 'Cancel' }}
          onDismiss={() => setIsDeliveryDatePickerVisible(false)}
          onValueChange={(_event, selectedDate) => {
            setDeliveryDate(dateInputValue(selectedDate));
            setIsDeliveryDatePickerVisible(false);
          }}
          positiveButton={{ label: 'Select' }}
          presentation={Platform.OS === 'android' ? 'dialog' : 'inline'}
          testID="sales-order-delivery-date-picker"
          themeVariant="dark"
          value={dateFromInput(deliveryDate)}
        /> : null}
        {!allowsSalesOrderAdvancePayments ? <Text style={styles.cardHint}>This POS profile does not allow an advance payment for Sales Orders.</Text> : null}
      </View> : null}

      {isInvoice && <>
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
              <Pressable accessibilityLabel="Choose credit sale due date" onPress={() => setIsDueDatePickerVisible(true)} style={styles.datePickerButton}>
                <MaterialCommunityIcons color={posDarkColors.onSurfaceMuted} name="calendar-month-outline" size={20} />
                <Text style={styles.datePickerButtonLabel}>{formatDate(dueDate)}</Text>
              </Pressable>
              {isDueDatePickerVisible ? <DateTimePicker
                accentColor={posDarkColors.primary}
                minimumDate={dateFromInput(postingDate)}
                mode="date"
                negativeButton={{ label: 'Cancel' }}
                onDismiss={() => setIsDueDatePickerVisible(false)}
                onValueChange={(_event, selectedDate) => {
                  setDueDate(dateInputValue(selectedDate));
                  setIsDueDatePickerVisible(false);
                }}
                positiveButton={{ label: 'Select' }}
                presentation={Platform.OS === 'android' ? 'dialog' : 'inline'}
                themeVariant="dark"
                value={dateFromInput(dueDate)}
              /> : null}
            </> : null}
          </View>
        ) : null}

      </>}

      {isInvoice && customerLoyalty.data?.enrolled ? <View style={styles.card}>
        <View style={styles.loyaltyHeading}>
          <MaterialCommunityIcons color={posDarkColors.primary} name="star-circle-outline" size={22} />
          <View style={styles.heading}>
            <Text style={styles.cardTitle}>Loyalty redemption</Text>
            <Text style={styles.cardHint}>{availableLoyaltyPoints.toLocaleString()} points available · {formatCurrency(customerLoyalty.data.redemption_value ?? 0, customerLoyalty.data.currency || currency, precision)}</Text>
          </View>
        </View>
        <Text style={styles.fieldLabel}>Points to redeem</Text>
        <View style={styles.loyaltyInputRow}>
          <TextInput
            accessibilityLabel="Loyalty points to redeem"
            inputMode="numeric"
            keyboardType="number-pad"
            onChangeText={setLoyaltyInput}
            placeholder="Enter points"
            placeholderTextColor="#8f8f8f"
            style={[styles.input, styles.loyaltyInput]}
            value={loyaltyInput}
          />
          <Pressable accessibilityLabel="Redeem maximum loyalty points" disabled={!maximumLoyaltyPoints || isApplyingLoyalty} onPress={() => void applyLoyaltyPoints(maximumLoyaltyPoints)} style={[styles.secondaryButton, (!maximumLoyaltyPoints || isApplyingLoyalty) && styles.secondaryButtonDisabled]}>
            <Text style={styles.secondaryButtonLabel}>Maximum</Text>
          </Pressable>
          <Pressable accessibilityLabel="Apply loyalty points" disabled={Boolean(loyaltyInputError) || !loyaltyInputPoints || isApplyingLoyalty} onPress={() => void applyLoyaltyPoints(loyaltyInputPoints || 0)} style={[styles.secondaryButton, (Boolean(loyaltyInputError) || !loyaltyInputPoints || isApplyingLoyalty) && styles.secondaryButtonDisabled]}>
            {isApplyingLoyalty ? <ActivityIndicator color={posDarkColors.onSurface} size="small" /> : <Text style={styles.secondaryButtonLabel}>Apply</Text>}
          </Pressable>
        </View>
        {loyaltyInputError ? <Text style={styles.errorText}>Enter between 1 and {maximumLoyaltyPoints.toLocaleString()} points.</Text> : null}
        {loyaltyError ? <Text style={styles.errorText}>{loyaltyError}</Text> : null}
        {!isLoyaltySelectionValid ? <Text style={styles.errorText}>The available balance changed. Apply a valid number of points again.</Text> : null}
        {appliedLoyaltyPoints ? <View style={styles.loyaltyAppliedRow}>
          <Text style={styles.cardHint}>Applied: {appliedLoyaltyPoints.toLocaleString()} points · {formatCurrency(loyaltyAmount, currency, precision)}</Text>
          <Pressable accessibilityLabel="Remove loyalty redemption" disabled={isApplyingLoyalty} onPress={() => void applyLoyaltyPoints(0)}><Text style={styles.loyaltyRemoveLabel}>Remove</Text></Pressable>
        </View> : null}
      </View> : null}

      {isInvoice && isWalkinCustomer ? <View style={styles.card}>
        <Text style={styles.cardTitle}>Receipt Tax ID</Text>
        <Text style={styles.cardHint}>Optionally add the walk-in customer’s PIN or Tax ID to this receipt.</Text>
        <Text style={styles.fieldLabel}>Customer Tax ID</Text>
        <TextInput
          accessibilityLabel="Customer Tax ID"
          autoCapitalize="characters"
          maxLength={140}
          onChangeText={setCheckoutTaxId}
          placeholder={saleCustomer?.taxId || 'PIN / Tax ID for this receipt'}
          placeholderTextColor="#8f8f8f"
          style={styles.input}
          value={checkoutTaxId}
        />
      </View> : null}

      {(isInvoice || allowsSalesOrderAdvancePayments) ? <View style={styles.card}>
          <Text style={styles.cardTitle}>{isInvoice ? 'Payment methods' : 'Sales Order advance payment'}</Text>
          <View style={styles.paymentSummaryRow}>
            <PaymentSummary label="Allocated" value={formatCurrency(allocation.allocatedMinor / currencyScale(precision), currency, precision)} />
            <PaymentSummary label={isInvoice ? paymentBalanceLabel : 'Order balance'} value={formatCurrency(Math.abs(allocation.remainingMinor) / currencyScale(precision), currency, precision)} />
            <PaymentSummary label="Status" value={paymentStatus} />
          </View>
          <Text style={styles.cardHint}>{isInvoice
            ? isCreditSale
              ? 'Optionally record a deposit. The remaining balance will be recorded as credit.'
              : 'Tap a payment mode to allocate the full balance, or enter amounts to split the payment.'
            : 'Optionally collect an advance. It cannot exceed the Sales Order total and will be recorded against this order.'}</Text>
          {manualModes.length ? <View style={styles.paymentModes}>
            {manualModes.map((mode) => {
              const amount = paymentAmounts[mode.mode_of_payment] ?? '';
              const amountMinor = parsePaymentAmount(amount, precision);
              const needsReference = Boolean(mode.requires_reference && amountMinor && amountMinor > 0);
              const reference = paymentReferences[mode.mode_of_payment];
              const isAll = amount === minorUnitsToInput(totalMinor, precision)
                && manualModes.every((other) => other.mode_of_payment === mode.mode_of_payment || !(paymentAmounts[other.mode_of_payment]));
              return <View key={mode.mode_of_payment} style={styles.paymentMode}>
                <View style={styles.paymentModeRow}>
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
                </View>
                {needsReference ? <View style={styles.paymentReference}>
                  <Text style={styles.fieldLabel}>Transaction reference</Text>
                  <TextInput
                    accessibilityLabel={`${mode.mode_of_payment} transaction reference`}
                    autoCapitalize="characters"
                    onChangeText={(referenceNo) => setPaymentReferenceNo(mode.mode_of_payment, referenceNo)}
                    placeholder="Receipt or transaction number"
                    placeholderTextColor="#8f8f8f"
                    style={styles.input}
                    value={reference?.referenceNo ?? ''}
                  />
                  <Text style={styles.fieldLabel}>Transaction date</Text>
                  <Pressable accessibilityLabel={`Choose ${mode.mode_of_payment} transaction date`} onPress={() => setReferenceDateMode(mode.mode_of_payment)} style={styles.datePickerButton}>
                    <MaterialCommunityIcons color={posDarkColors.onSurfaceMuted} name="calendar-month-outline" size={20} />
                    <Text style={styles.datePickerButtonLabel}>{formatDate(reference?.referenceDate || today())}</Text>
                  </Pressable>
                </View> : null}
              </View>;
            })}
          </View> : <Text style={isInvoice ? styles.errorText : styles.cardHint}>{isInvoice
            ? 'No manual payment mode is configured for this POS profile.'
            : 'No manual payment mode is configured, so this Sales Order will be submitted without an advance.'}</Text>}
          {gatewayModes.length ? <View style={styles.gatewayModes}>
            <Text style={styles.fieldLabel}>Gateway payments</Text>
            {gatewayModes.map((mode) => {
              const link = gatewayLinks[mode.mode_of_payment];
              const isVerified = isSuccessfulGatewayPayment(link);
              return <Pressable key={mode.mode_of_payment} accessibilityLabel={`Pay with ${mode.mode_of_payment}`} onPress={() => openGatewayPayment(mode)} style={[styles.gatewayModeButton, isVerified && styles.gatewayModeButtonVerified]}>
                <View style={styles.gatewayModeText}>
                  <Text style={styles.paymentModeLabel}>{mode.mode_of_payment}</Text>
                  <Text style={styles.cardHint}>{isVerified ? `Verified · ${formatCurrency(link?.amount ?? 0, currency, precision)}` : link ? `Awaiting confirmation · ${link.status}` : 'Tap to start a secure payment'}</Text>
                </View>
                <MaterialCommunityIcons color={isVerified ? '#39b976' : posDarkColors.onSurfaceMuted} name={isVerified ? 'check-circle' : 'cellphone-wireless'} size={22} />
              </Pressable>;
            })}
          </View> : null}
          {isInvoice && profile?.allow_partial_payment ? <Text style={styles.cardHint}>Partial payments are enabled for this POS profile.</Text> : null}
          {hasMissingPaymentReference ? <Text style={styles.errorText}>A transaction reference is required for {missingReferenceMode}.</Text> : null}
          {hasUnverifiedGatewayPayment ? <Text style={styles.errorText}>Verify the selected gateway payment to continue. Checkout unlocks after confirmation.</Text> : null}
          {isInvoice && hasNonCashOverpayment ? <Text style={styles.errorText}>Only cash can exceed the total and return change.</Text> : null}
          {hasSalesOrderAdvanceOverpayment ? <Text style={styles.errorText}>An advance cannot exceed the Sales Order total.</Text> : null}
          {referenceDateMode ? <DateTimePicker
            accentColor={posDarkColors.primary}
            maximumDate={dateFromInput(today())}
            mode="date"
            negativeButton={{ label: 'Cancel' }}
            onDismiss={() => setReferenceDateMode(null)}
            onValueChange={(_event, selectedDate) => {
              setPaymentReferenceDate(referenceDateMode, dateInputValue(selectedDate));
              setReferenceDateMode(null);
            }}
            positiveButton={{ label: 'Select' }}
            presentation={Platform.OS === 'android' ? 'dialog' : 'inline'}
            testID={`payment-reference-date-picker-${referenceDateMode}`}
            themeVariant="dark"
            value={dateFromInput(paymentReferences[referenceDateMode]?.referenceDate || today())}
          /> : null}
        </View> : null}

      {validationError || checkout.error ? <Text style={styles.errorText}>{validationError || checkout.error}</Text> : null}
      <Pressable accessibilityLabel={isInvoice ? 'Complete sale' : 'Submit sales order'} accessibilityState={{ disabled: !isReadyToSubmit }} disabled={!isReadyToSubmit} onPress={requestSubmit} style={[styles.submitButton, !isReadyToSubmit && styles.submitButtonDisabled]}>
        <Text style={styles.submitButtonLabel}>{checkout.isSubmitting ? 'Submitting…' : isInvoice ? `Complete sale · ${formatCurrency(total, currency, precision)}` : 'Submit sales order'}</Text>
      </Pressable>

      <Modal animationType="slide" onRequestClose={() => { if (!gatewayPayment.isWorking) setActiveGatewayMode(null); }} presentationStyle="pageSheet" visible={Boolean(activeGatewayMode)}>
        {activeGatewayMode ? <KeyboardAwareFormScroll contentContainerStyle={styles.gatewayModalContent} showsVerticalScrollIndicator={false} style={styles.scrollView}>
          <View style={styles.header}>
            <View style={styles.heading}>
              <Text style={styles.title}>{activeGatewayMode.mode_of_payment}</Text>
              <Text style={styles.subtitle}>Verify {formatCurrency((parsePaymentAmount(paymentAmounts[activeGatewayMode.mode_of_payment] || '', precision) || 0) / currencyScale(precision), currency, precision)} through {activeGatewayMode.payment_gateway}.</Text>
            </View>
            <Pressable accessibilityLabel="Close gateway payment" disabled={gatewayPayment.isWorking} onPress={() => setActiveGatewayMode(null)} style={styles.backButton}>
              <MaterialCommunityIcons color={posDarkColors.onSurface} name="close" size={22} />
            </Pressable>
          </View>
          <View style={styles.gatewayMethodButtons}>
            <Pressable accessibilityLabel="Use STK Push" onPress={() => { gatewayPayment.clearError(); setGatewayMethod('STK'); }} style={[styles.gatewayMethodButton, gatewayMethod === 'STK' && styles.gatewayMethodButtonActive]}>
              <Text style={[styles.gatewayMethodLabel, gatewayMethod === 'STK' && styles.gatewayMethodLabelActive]}>STK Push</Text>
            </Pressable>
            <Pressable accessibilityLabel="Find C2B payment" onPress={() => { gatewayPayment.clearError(); setGatewayMethod('C2B'); }} style={[styles.gatewayMethodButton, gatewayMethod === 'C2B' && styles.gatewayMethodButtonActive]}>
              <Text style={[styles.gatewayMethodLabel, gatewayMethod === 'C2B' && styles.gatewayMethodLabelActive]}>Find C2B payment</Text>
            </Pressable>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{gatewayMethod === 'STK' ? 'STK Push' : 'Incoming C2B payment'}</Text>
            <Text style={styles.cardHint}>{gatewayMethod === 'STK'
              ? 'Send a payment prompt to the customer, then wait for gateway confirmation.'
              : 'Find a verified incoming payment and attach the exact amount to this sale.'}</Text>
            {gatewayMethod === 'STK' ? <>
              <Text style={styles.fieldLabel}>Customer phone number</Text>
              <TextInput accessibilityLabel="Gateway customer phone number" inputMode="tel" keyboardType="phone-pad" onChangeText={setGatewayPhone} placeholder="Phone number" placeholderTextColor="#8f8f8f" style={styles.input} value={gatewayPhone} />
            </> : <>
              <Text style={styles.fieldLabel}>Transaction reference or payer</Text>
              <View style={styles.c2bSearchRow}>
                <TextInput accessibilityLabel="Search C2B payments" autoCapitalize="characters" onChangeText={(query) => { setC2bQuery(query); setHasC2bSearched(false); }} placeholder="Search incoming payment" placeholderTextColor="#8f8f8f" style={[styles.input, styles.c2bSearchInput]} value={c2bQuery} />
                <Pressable accessibilityLabel="Search incoming C2B payments" disabled={isC2bSearching || c2bQuery.trim().length < 3} onPress={() => void searchC2BGatewayPayments()} style={[styles.secondaryButton, (isC2bSearching || c2bQuery.trim().length < 3) && styles.secondaryButtonDisabled]}>
                  {isC2bSearching ? <ActivityIndicator color={posDarkColors.onSurface} size="small" /> : <Text style={styles.secondaryButtonLabel}>Search</Text>}
                </Pressable>
              </View>
              {c2bResults.length ? <View style={styles.c2bResults}>{c2bResults.map((payment) => {
                const amountMatches = totalToMinorUnits(payment.amount, precision) === (parsePaymentAmount(paymentAmounts[activeGatewayMode.mode_of_payment] || '', precision) || 0);
                return <Pressable accessibilityLabel={`Attach C2B payment ${payment.transaction_id}`} disabled={!amountMatches || gatewayPayment.isWorking} key={payment.name} onPress={() => void attachC2BGatewayPayment(payment)} style={[styles.c2bPayment, !amountMatches && styles.c2bPaymentDisabled]}>
                  <View style={styles.gatewayModeText}>
                    <Text style={styles.paymentModeLabel}>{payment.party_name || payment.party_phone || 'Incoming payment'}</Text>
                    <Text style={styles.cardHint}>{payment.transaction_id}</Text>
                  </View>
                  <View style={styles.c2bAmount}>
                    <Text style={styles.paymentModeLabel}>{formatCurrency(payment.amount, payment.currency || currency, precision)}</Text>
                    {!amountMatches ? <Text style={styles.errorText}>Amount does not match</Text> : null}
                  </View>
                </Pressable>;
              })}</View> : null}
              {hasC2bSearched && !isC2bSearching && !c2bResults.length ? <Text style={styles.cardHint}>No verified incoming payments found.</Text> : null}
            </>}
            {gatewayPayment.error ? <Text style={styles.errorText}>{gatewayPayment.error}</Text> : null}
            {gatewayMethod === 'STK' && gatewayLinks[activeGatewayMode.mode_of_payment] ? <Text style={isSuccessfulGatewayPayment(gatewayLinks[activeGatewayMode.mode_of_payment]) ? styles.gatewayVerifiedText : styles.cardHint}>
              {isSuccessfulGatewayPayment(gatewayLinks[activeGatewayMode.mode_of_payment]) ? `Payment verified${gatewayLinks[activeGatewayMode.mode_of_payment]?.status === 'Authorized' ? ' (authorized)' : ''}.` : `Payment status: ${gatewayLinks[activeGatewayMode.mode_of_payment]?.status}. Checking automatically…`}
            </Text> : null}
            {gatewayMethod === 'STK' ? <Pressable accessibilityLabel="Send STK payment request" disabled={gatewayPayment.isWorking || !gatewayPhone.trim() || isSuccessfulGatewayPayment(gatewayLinks[activeGatewayMode.mode_of_payment])} onPress={() => void initiateGatewayPayment()} style={[styles.submitButton, (gatewayPayment.isWorking || !gatewayPhone.trim() || isSuccessfulGatewayPayment(gatewayLinks[activeGatewayMode.mode_of_payment])) && styles.submitButtonDisabled]}>
              {gatewayPayment.isWorking ? <ActivityIndicator color={posDarkColors.onPrimary} size="small" /> : <Text style={styles.submitButtonLabel}>{gatewayLinks[activeGatewayMode.mode_of_payment] ? 'Retry STK request' : 'Send STK request'}</Text>}
            </Pressable> : null}
            {gatewayMethod === 'STK' && gatewayLinks[activeGatewayMode.mode_of_payment] ? <View style={styles.gatewayActions}>
              <Pressable accessibilityLabel="Check gateway payment status" disabled={gatewayPayment.isWorking} onPress={() => void refreshGatewayPayment()} style={styles.secondaryButton}><Text style={styles.secondaryButtonLabel}>Check status</Text></Pressable>
              <Pressable accessibilityLabel="Cancel gateway payment" disabled={gatewayPayment.isWorking || isSuccessfulGatewayPayment(gatewayLinks[activeGatewayMode.mode_of_payment])} onPress={() => void cancelGatewayPayment()} style={styles.secondaryButton}><Text style={styles.secondaryButtonLabel}>Cancel payment</Text></Pressable>
            </View> : null}
          </View>
        </KeyboardAwareFormScroll> : null}
      </Modal>

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
              <Text style={styles.confirmationDescription}>{!isInvoice
                ? allocation.allocatedMinor > 0
                  ? `This will submit the Sales Order for delivery on ${formatDate(deliveryDate)} and collect an advance of ${formatCurrency(paidAmount, currency, precision)}.`
                  : `This will submit the Sales Order for delivery on ${formatDate(deliveryDate)}.`
                : isCreditSale
                  ? 'This will submit the sale as credit with its payment due date.'
                  : 'This will submit the sale and its selected payment allocation.'}</Text>
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
  c2bAmount: { alignItems: 'flex-end', gap: 2 },
  c2bPayment: { alignItems: 'center', borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between', padding: spacing.sm },
  c2bPaymentDisabled: { opacity: 0.55 },
  c2bResults: { gap: spacing.xs },
  c2bSearchInput: { flex: 1 },
  c2bSearchRow: { alignItems: 'stretch', flexDirection: 'row', gap: spacing.sm },
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
  datePickerButton: { alignItems: 'center', backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.sm },
  datePickerButtonLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body },
  errorText: { color: posDarkColors.error, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small, lineHeight: typography.lineHeight.body },
  fieldLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small, marginTop: spacing.xs },
  gatewayActions: { flexDirection: 'row', gap: spacing.sm },
  gatewayMethodButton: { alignItems: 'center', backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 42, paddingHorizontal: spacing.sm },
  gatewayMethodButtonActive: { backgroundColor: posDarkColors.primary, borderColor: posDarkColors.primary },
  gatewayMethodButtons: { flexDirection: 'row', gap: spacing.sm },
  gatewayMethodLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small, textAlign: 'center' },
  gatewayMethodLabelActive: { color: posDarkColors.onPrimary },
  gatewayModeButton: { alignItems: 'center', backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between', minHeight: 56, padding: spacing.sm },
  gatewayModeButtonVerified: { borderColor: '#39b976' },
  gatewayModeText: { flex: 1, gap: 2 },
  gatewayModes: { gap: spacing.xs },
  gatewayModalContent: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  gatewayVerifiedText: { color: '#7ee2a8', fontFamily: typography.fontFamily.medium, fontSize: typography.size.small },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  heading: { flex: 1, gap: 2 },
  input: { backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, color: posDarkColors.onSurface, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  loyaltyAppliedRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  loyaltyHeading: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  loyaltyInput: { flex: 1 },
  loyaltyInputRow: { alignItems: 'stretch', flexDirection: 'row', gap: spacing.xs },
  loyaltyRemoveLabel: { color: posDarkColors.error, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  currencyPrefix: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.medium, fontSize: typography.size.tiny },
  paymentAmountInput: { color: posDarkColors.onSurface, flex: 1, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm, textAlign: 'right' },
  paymentAmountWrap: { alignItems: 'center', backgroundColor: posDarkColors.surfaceContainer, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, flexDirection: 'row', minHeight: 46, paddingLeft: spacing.sm },
  paymentModeButton: { alignItems: 'center', backgroundColor: posDarkColors.surfaceContainerHigh, borderColor: 'transparent', borderRadius: radii.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: spacing.sm },
  paymentModeButtonActive: { backgroundColor: posDarkColors.primary, borderColor: posDarkColors.primary },
  paymentModeLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small, textAlign: 'center' },
  paymentModeLabelActive: { color: posDarkColors.onPrimary },
  paymentMode: { gap: spacing.sm },
  paymentModeRow: { flexDirection: 'row', gap: spacing.sm },
  paymentModes: { gap: spacing.sm },
  paymentReference: { gap: spacing.xs },
  paymentSummary: { flex: 1, gap: 2 },
  paymentSummaryLabel: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  paymentSummaryRow: { backgroundColor: posDarkColors.surfaceContainer, borderRadius: radii.sm, flexDirection: 'row', gap: spacing.xs, padding: spacing.sm },
  paymentSummaryValue: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  scrollView: { flex: 1 },
  secondaryButton: { alignItems: 'center', borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.sm },
  secondaryButtonDisabled: { opacity: 0.5 },
  secondaryButtonLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  state: { alignItems: 'center', flex: 1, gap: spacing.md, justifyContent: 'center', padding: spacing.xl },
  stateText: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, textAlign: 'center' },
  submitButton: { alignItems: 'center', backgroundColor: posDarkColors.primary, borderRadius: radii.md, justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.md },
  submitButtonDisabled: { opacity: 0.45 },
  submitButtonLabel: { color: posDarkColors.onPrimary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  subtitle: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
  summaryLabel: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
  summaryDivider: { backgroundColor: posDarkColors.border, height: StyleSheet.hairlineWidth, marginVertical: spacing.xs },
  summaryItems: { gap: spacing.xs },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summarySectionTitle: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  summaryValue: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.medium, fontSize: typography.size.small },
  title: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
  totalLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  totalRow: { borderTopColor: posDarkColors.border, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm },
  totalValue: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
});
