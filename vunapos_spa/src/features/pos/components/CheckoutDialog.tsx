import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Award,
  Check,
  CheckCircle2,
  CreditCard,
  Loader2,
  Pause,
  RefreshCw,
  Search,
  Smartphone,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { useGatewayPaymentRealtime } from "../hooks/useGatewayPaymentRealtime";
import {
  allocateAllToMode,
	allocatePaymentRemainderToNextMode,
  buildPaymentInputs,
  canCompletePaymentAllocation,
  calculatePaymentAllocation,
  createInitialPaymentAmounts,
  currencyScale,
  minorUnitsToInput,
  normalizeCurrencyPrecision,
  parsePaymentAmount,
  totalToMinorUnits,
} from "../paymentAllocation";
import { useCartStore } from "../stores/cartStore";
import { useUiFeedbackStore } from "../stores/uiFeedbackStore";
import type {
  CustomerDTO,
  CustomerAddressDTO,
  CustomerContactPhoneDTO,
  CustomerLoyaltyDTO,
  C2BGatewayPaymentDTO,
  GatewayPaymentLinkDTO,
  InvoiceDTO,
  ModeOfPaymentDTO,
  PaymentInput,
} from "../types";
import { formatCurrency, getInvoiceTotal } from "../utils";

type CheckoutDialogProps = {
  allowCreditSales?: boolean;
  allowPartialPayment?: boolean;
	autoAllocatePaymentBalance?: boolean;
  allowSalesOrderPayments?: boolean;
  allowDeliveryCharges?: boolean;
  allowDeliveryChargeChange?: boolean;
  deliveryChargeItem?: string | null;
  currency?: string;
  currencyPrecision?: number;
  customer?: CustomerDTO | null;
  customerAddresses?: CustomerAddressDTO[];
  customerAddressesLoading?: boolean;
  customerLoyalty?: CustomerLoyaltyDTO | null;
  defaultSaleType?: "Cash Sale" | "Credit Sale";
  error?: string | null;
  isOpen: boolean;
  modesOfPayment: ModeOfPaymentDTO[];
  onClear: () => void;
  onApplyDeliveryCharge?: (amount?: number) => Promise<void>;
  onClose: () => void;
  onConfirm: (
    payments: PaymentInput[],
    idempotencyKey: string,
    isCreditSale: boolean,
    dueDate?: string,
    loyaltyPoints?: number,
    taxId?: string,
  ) => void;
  onHold: () => void;
  onAttachC2bGatewayPayment?: (params: {
    mode_of_payment: string;
    transaction_reference: string;
    amount: number;
    idempotency_key: string;
  }) => Promise<GatewayPaymentLinkDTO>;
  onSearchC2bGatewayPayments?: (params: {
    mode_of_payment: string;
    query: string;
    limit?: number;
  }) => Promise<C2BGatewayPaymentDTO[]>;
  onCheckGatewayPayment?: (
    gatewayPaymentLink: string,
  ) => Promise<GatewayPaymentLinkDTO>;
  onResolveCustomerPhone?: (params: {
    pos_profile?: string;
    customer: string;
  }) => Promise<CustomerContactPhoneDTO>;
  onCancelGatewayPayment?: (
    gatewayPaymentLink: string,
  ) => Promise<GatewayPaymentLinkDTO>;
  onInitiateGatewayPayment?: (params: {
    mode_of_payment: string;
    amount: number;
		phone_number: string;
		idempotency_key: string;
		account_reference?: string;
  }) => Promise<GatewayPaymentLinkDTO>;
  onPreviewLoyalty: (loyaltyPoints: number) => Promise<InvoiceDTO | null>;
  orderType?: "Sales Invoice" | "Sales Order";
  posProfile?: string;
};

function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayInputValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSuccessfulGatewayLink(link?: GatewayPaymentLinkDTO) {
  return link?.status === "Paid" || link?.status === "Authorized";
}

function isPendingGatewayLink(link?: GatewayPaymentLinkDTO) {
  return link?.status === "Draft" || link?.status === "Pending";
}

export function CheckoutDialog({
  allowCreditSales,
  allowPartialPayment,
	autoAllocatePaymentBalance,
  allowSalesOrderPayments,
  allowDeliveryCharges,
  allowDeliveryChargeChange,
  deliveryChargeItem,
  currency,
  currencyPrecision,
  customer,
  customerAddresses,
  customerAddressesLoading,
  customerLoyalty,
  defaultSaleType,
  error,
  isOpen,
  modesOfPayment,
  onClear,
  onApplyDeliveryCharge,
  onClose,
  onConfirm,
  onHold,
  onAttachC2bGatewayPayment,
  onSearchC2bGatewayPayments,
  onCheckGatewayPayment,
  onResolveCustomerPhone,
  onCancelGatewayPayment,
  onInitiateGatewayPayment,
  onPreviewLoyalty,
  orderType = "Sales Invoice",
  posProfile,
}: CheckoutDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <CheckoutDialogContent
      key={`${allowCreditSales ? "credit-enabled" : "credit-disabled"}-${orderType}-${allowSalesOrderPayments ? "deposits" : "no-deposits"}`}
      allowCreditSales={allowCreditSales}
      allowPartialPayment={allowPartialPayment}
	  autoAllocatePaymentBalance={autoAllocatePaymentBalance}
      allowSalesOrderPayments={allowSalesOrderPayments}
      allowDeliveryCharges={allowDeliveryCharges}
      allowDeliveryChargeChange={allowDeliveryChargeChange}
      deliveryChargeItem={deliveryChargeItem}
      currency={currency}
      currencyPrecision={currencyPrecision}
      customer={customer}
      customerAddresses={customerAddresses}
      customerAddressesLoading={customerAddressesLoading}
      customerLoyalty={customerLoyalty}
      defaultSaleType={defaultSaleType}
      error={error}
      modesOfPayment={modesOfPayment}
      onClear={onClear}
      onApplyDeliveryCharge={onApplyDeliveryCharge}
      onClose={onClose}
      onConfirm={onConfirm}
      onHold={onHold}
      onAttachC2bGatewayPayment={onAttachC2bGatewayPayment}
      onSearchC2bGatewayPayments={onSearchC2bGatewayPayments}
      onCheckGatewayPayment={onCheckGatewayPayment}
      onResolveCustomerPhone={onResolveCustomerPhone}
      onCancelGatewayPayment={onCancelGatewayPayment}
      onInitiateGatewayPayment={onInitiateGatewayPayment}
      onPreviewLoyalty={onPreviewLoyalty}
      orderType={orderType}
      posProfile={posProfile}
    />
  );
}

function CheckoutDialogContent({
  allowCreditSales,
  allowPartialPayment,
	autoAllocatePaymentBalance,
  allowSalesOrderPayments,
  allowDeliveryCharges,
  allowDeliveryChargeChange,
  deliveryChargeItem,
  currency,
  currencyPrecision,
  customer,
  customerAddresses,
  customerAddressesLoading,
  customerLoyalty,
  defaultSaleType,
  error,
  modesOfPayment,
  onClear,
  onApplyDeliveryCharge,
  onClose,
  onConfirm,
  onHold,
  onAttachC2bGatewayPayment,
  onSearchC2bGatewayPayments,
  onCheckGatewayPayment,
  onResolveCustomerPhone,
  onCancelGatewayPayment,
  onInitiateGatewayPayment,
  onPreviewLoyalty,
  orderType = "Sales Invoice",
  posProfile,
}: Omit<CheckoutDialogProps, "isOpen">) {
  const invoice = useCartStore((s) => s.invoice);
  const isSubmitting = useCartStore((s) => s.isMutating);
  const showToast = useUiFeedbackStore((s) => s.showToast);
  const isSalesOrder = orderType === "Sales Order";
  const showSalesOrderPayments = isSalesOrder && Boolean(allowSalesOrderPayments);

  const total = getInvoiceTotal(invoice);
  const precision = normalizeCurrencyPrecision(currencyPrecision ?? 2);
  const availableModes = useMemo(
    () =>
      Array.from(
        new Map(
          modesOfPayment.map((mode) => [mode.mode_of_payment, mode]),
        ).values(),
      ),
    [modesOfPayment],
  );
  const scale = currencyScale(precision);
  const totalMinor = totalToMinorUnits(total, precision);
  const loyaltyFactor = Number(customerLoyalty?.conversion_factor || 0);
  const availableLoyaltyPoints = Math.max(
    Math.floor(Number(customerLoyalty?.points || 0)),
    0,
  );
  const maximumLoyaltyPoints =
    loyaltyFactor > 0
      ? Math.min(availableLoyaltyPoints, Math.floor(total / loyaltyFactor))
      : 0;
  const [loyaltyInput, setLoyaltyInput] = useState("");
  const [appliedLoyaltyPoints, setAppliedLoyaltyPoints] = useState(
    Math.min(
      Math.floor(Number(invoice?.loyalty_points || 0)),
      maximumLoyaltyPoints,
    ),
  );
  const [appliedLoyaltyAmount, setAppliedLoyaltyAmount] = useState(
    Number(invoice?.loyalty_amount || 0),
  );
  const [loyaltyError, setLoyaltyError] = useState("");
  const [isApplyingLoyalty, setIsApplyingLoyalty] = useState(false);
  const loyaltyAmountMinor = totalToMinorUnits(appliedLoyaltyAmount, precision);
  const payableMinor = Math.max(totalMinor - loyaltyAmountMinor, 0);
  const [amounts, setAmounts] = useState(() =>
    (allowCreditSales && defaultSaleType === "Credit Sale") ||
    (isSalesOrder && Boolean(allowSalesOrderPayments))
      ? Object.fromEntries(
          availableModes.map((mode) => [mode.mode_of_payment, ""]),
        )
      : createInitialPaymentAmounts(availableModes, payableMinor, precision),
  );
  const [focusedPaymentMode, setFocusedPaymentMode] = useState<string | null>(
    null,
  );
  const [isCreditSale, setIsCreditSale] = useState(
    Boolean(
      allowCreditSales &&
      (invoice?.is_credit_sale || defaultSaleType === "Credit Sale"),
    ),
  );
  const today = useMemo(() => todayInputValue(), []);
  const [dueDate, setDueDate] = useState(invoice?.due_date || today);
  const [shippingAddressName, setShippingAddressName] = useState<string>("");

  useEffect(() => {
    const defaultAddress = customerAddresses?.find((address) => address.is_default);
    setShippingAddressName(defaultAddress?.name || customerAddresses?.[0]?.name || "");
  }, [customer?.customer, customerAddresses]);
  const selectedShippingAddress = customerAddresses?.find(
    (address) => address.name === shippingAddressName,
  );
  const deliveryEnabled = Boolean(deliveryChargeItem);
  const [deliveryAmount, setDeliveryAmount] = useState("");
  const [deliveryApplying, setDeliveryApplying] = useState(false);
  const deliveryAppliedAmountRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      allowDeliveryChargeChange === false ||
      !onApplyDeliveryCharge
    ) {
      return;
    }
    const rawAmount = deliveryAmount.trim();
    const amount = rawAmount ? Number(rawAmount) : 0;
    if (rawAmount && (!Number.isFinite(amount) || amount < 0)) return;
    if (deliveryAppliedAmountRef.current === amount) return;

    // Apply after the cashier pauses briefly, rather than waiting for the
    // input to lose focus. This keeps the invoice total and payment allocation
    // in sync while preserving a responsive numeric input.
    const timer = window.setTimeout(() => {
      deliveryAppliedAmountRef.current = amount;
      setDeliveryApplying(true);
      void onApplyDeliveryCharge(amount)
        .catch(() => {
          deliveryAppliedAmountRef.current = null;
        })
        .finally(() => setDeliveryApplying(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    allowDeliveryChargeChange,
    deliveryAmount,
    onApplyDeliveryCharge,
  ]);
  const [checkoutTaxId, setCheckoutTaxId] = useState("");
  const [gatewayLinks, setGatewayLinks] = useState<
    Record<string, GatewayPaymentLinkDTO | undefined>
  >({});
  const [gatewayPhones, setGatewayPhones] = useState<Record<string, string>>(
    () =>
      customer?.mobile_no
        ? Object.fromEntries(
            availableModes
              .filter((mode) => mode.payment_gateway)
              .map((mode) => [mode.mode_of_payment, customer.mobile_no || ""]),
          )
        : {},
  );
  const [gatewayErrors, setGatewayErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [gatewayBusy, setGatewayBusy] = useState<
    Record<string, string | undefined>
  >({});
  const [activeGatewayMode, setActiveGatewayMode] =
    useState<ModeOfPaymentDTO | null>(null);
  const [c2bQuery, setC2bQuery] = useState("");
  const [c2bResults, setC2bResults] = useState<C2BGatewayPaymentDTO[]>([]);
  const [c2bLoading, setC2bLoading] = useState(false);
  const idempotencyKey = useRef(createIdempotencyKey());
  const searchC2bGatewayPaymentsRef = useRef(onSearchC2bGatewayPayments);
  const checkGatewayPaymentRef = useRef(onCheckGatewayPayment);
  const notifiedGatewayLinksRef = useRef(new Set<string>());
  const resolvedPhoneCustomerRef = useRef<string | undefined>(undefined);
  const isWalkinCustomer = Boolean(customer?.is_walkin);
  useEffect(() => {
    const customerName = customer?.customer;
    if (
      !customerName ||
      customer.mobile_no ||
      !onResolveCustomerPhone ||
      resolvedPhoneCustomerRef.current === customerName
    ) {
      return;
    }
    resolvedPhoneCustomerRef.current = customerName;
    let cancelled = false;
    void onResolveCustomerPhone({
      pos_profile: posProfile,
      customer: customerName,
    })
      .then((resolved) => {
        const phone = resolved.mobile_no?.trim();
        if (cancelled || !phone) return;
        setGatewayPhones((current) => ({
          ...current,
          ...Object.fromEntries(
            availableModes
              .filter(
                (mode) =>
                  mode.payment_gateway && !current[mode.mode_of_payment],
              )
              .map((mode) => [mode.mode_of_payment, phone]),
          ),
        }));
      })
      .catch((phoneError) => {
        console.error("Unable to resolve the customer contact phone", phoneError);
      });
    return () => {
      cancelled = true;
    };
  }, [
    availableModes,
    customer?.customer,
    customer?.mobile_no,
    onResolveCustomerPhone,
    posProfile,
  ]);
  const allocation = calculatePaymentAllocation(
    availableModes,
    amounts,
    payableMinor,
    precision,
  );
  const previousPayableMinor = useRef(payableMinor);
  useEffect(() => {
    const previous = previousPayableMinor.current;
    previousPayableMinor.current = payableMinor;
    if (previous === payableMinor || isCreditSale || !availableModes.length) {
      return;
    }

    // A delivery charge changes the amount due after the cashier has already
    // allocated payment. Keep a fully-paid cash sale fully paid by applying
    // the same delta to the default payment mode. Do not overwrite deliberate
    // partial/split allocations.
    setAmounts((current) => {
      const previousAllocation = calculatePaymentAllocation(
        availableModes,
        current,
        previous,
        precision,
      );
      if (previousAllocation.remainingMinor !== 0) return current;
      const mode =
        availableModes.find((candidate) => candidate.default) ||
        availableModes[0];
      const currentMinor =
        parsePaymentAmount(current[mode.mode_of_payment] || "", precision) ?? 0;
      return {
        ...current,
        [mode.mode_of_payment]: minorUnitsToInput(
          Math.max(currentMinor + payableMinor - previous, 0),
          precision,
        ),
      };
    });
  }, [availableModes, isCreditSale, payableMinor, precision]);
  const hasUnverifiedGatewayPayment = availableModes.some((mode) => {
    if (!mode.payment_gateway) return false;
    const amountMinor = parsePaymentAmount(
      amounts[mode.mode_of_payment] || "",
      precision,
    );
    if (!amountMinor || amountMinor <= 0) return false;
    return !isSuccessfulGatewayLink(gatewayLinks[mode.mode_of_payment]);
  });
  const hasNonCashOverpayment = allocation.nonCashMinor > payableMinor;
  const isLoyaltySelectionValid = appliedLoyaltyPoints <= maximumLoyaltyPoints;
  const isPayable =
    (isSalesOrder && (!showSalesOrderPayments || (!allocation.hasInvalidAmount && !hasNonCashOverpayment))) ||
    (!hasUnverifiedGatewayPayment &&
      !isApplyingLoyalty &&
      isLoyaltySelectionValid &&
      (!isCreditSale || dueDate >= today) &&
      (payableMinor === 0
        ? !allocation.hasInvalidAmount && allocation.allocatedMinor === 0
        : availableModes.length > 0 &&
          (isCreditSale
            ? !allocation.hasInvalidAmount && !hasNonCashOverpayment
            : canCompletePaymentAllocation(
                allocation,
                payableMinor,
                Boolean(allowPartialPayment),
              ))));
  const loyaltyInputPoints = /^\d+$/.test(loyaltyInput)
    ? Number(loyaltyInput)
    : null;
  const loyaltyInputError =
    loyaltyInput &&
    (loyaltyInputPoints === null ||
      loyaltyInputPoints <= 0 ||
      loyaltyInputPoints > maximumLoyaltyPoints);
  const applyLoyaltyPoints = async (points: number) => {
    const normalizedPoints = Math.max(
      Math.min(Math.floor(points), maximumLoyaltyPoints),
      0,
    );
    setIsApplyingLoyalty(true);
    setLoyaltyError("");
    try {
      const preview = await onPreviewLoyalty(normalizedPoints);
      const validatedPoints = Math.floor(Number(preview?.loyalty_points || 0));
      const validatedAmount = Number(preview?.loyalty_amount || 0);
      const validatedTotalMinor = totalToMinorUnits(
        preview ? getInvoiceTotal(preview) : total,
        precision,
      );
      const nextPayableMinor = Math.max(
        validatedTotalMinor - totalToMinorUnits(validatedAmount, precision),
        0,
      );
      setAppliedLoyaltyPoints(validatedPoints);
      setAppliedLoyaltyAmount(validatedAmount);
      setLoyaltyInput(validatedPoints ? String(validatedPoints) : "");
      setAmounts(
        isCreditSale
          ? Object.fromEntries(
              availableModes.map((mode) => [mode.mode_of_payment, ""]),
            )
          : createInitialPaymentAmounts(
              availableModes,
              nextPayableMinor,
              precision,
            ),
      );
    } catch (applyError) {
      setLoyaltyError(
        applyError instanceof Error
          ? applyError.message
          : "Unable to validate loyalty redemption",
      );
    } finally {
      setIsApplyingLoyalty(false);
    }
  };
  const isOverpaid = allocation.remainingMinor < 0;
  const balanceLabel = isOverpaid
    ? "Change"
    : isCreditSale || (allocation.remainingMinor > 0 && allowPartialPayment)
      ? "Outstanding"
      : "Remaining";
  const balanceMinor = Math.abs(allocation.remainingMinor);
  const paymentStatus = allocation.hasInvalidAmount
    ? "Invalid allocation"
    : allocation.remainingMinor < 0
      ? "Change due"
      : allocation.remainingMinor === 0
        ? "Fully paid"
        : isCreditSale && allocation.allocatedMinor > 0
          ? "Deposit + credit"
          : isCreditSale
            ? "Credit sale"
            : allowPartialPayment && allocation.allocatedMinor > 0
              ? "Partial payment"
              : "Payment incomplete";

  const setPaidGatewayLink = useCallback(
    (modeOfPayment: string, link: GatewayPaymentLinkDTO) => {
      setGatewayLinks((current) => ({ ...current, [modeOfPayment]: link }));
      setGatewayErrors((current) => ({
        ...current,
        [modeOfPayment]: undefined,
      }));
      if (!isSuccessfulGatewayLink(link)) return;

      setAmounts((current) => ({
        ...current,
        [modeOfPayment]: minorUnitsToInput(
          totalToMinorUnits(Number(link.amount || 0), precision),
          precision,
        ),
      }));
      setActiveGatewayMode((current) =>
        current?.mode_of_payment === modeOfPayment ? null : current,
      );
      if (!notifiedGatewayLinksRef.current.has(link.name)) {
        notifiedGatewayLinksRef.current.add(link.name);
        showToast({
          type: "info",
          message: `${modeOfPayment} payment verified successfully.`,
        });
      }
    },
    [precision, showToast],
  );
  const clearGatewayVerification = (modeOfPayment: string) => {
    setGatewayLinks((current) => ({ ...current, [modeOfPayment]: undefined }));
    setGatewayErrors((current) => ({ ...current, [modeOfPayment]: undefined }));
  };
  const gatewayAmountMinor = (modeOfPayment: string) =>
    parsePaymentAmount(amounts[modeOfPayment] || "", precision) || 0;
  const openGatewayDialog = (mode: ModeOfPaymentDTO) => {
    if (!mode.payment_gateway) return;
    const currentLink = gatewayLinks[mode.mode_of_payment];
    if (
      currentLink &&
      totalToMinorUnits(Number(currentLink.amount || 0), precision) !==
        payableMinor
    ) {
      clearGatewayVerification(mode.mode_of_payment);
    }
    setAmounts(
      allocateAllToMode(
        availableModes,
        mode.mode_of_payment,
        payableMinor,
        precision,
      ),
    );
    const customerPhone = customer?.mobile_no?.trim();
    if (customerPhone) {
      setGatewayPhones((current) => ({
        ...current,
        [mode.mode_of_payment]:
          current[mode.mode_of_payment] || customerPhone,
      }));
    }
    setC2bQuery("");
    setC2bResults([]);
    setActiveGatewayMode(mode);
  };
  const runGatewayAction = async (
    modeOfPayment: string,
    action: "stk" | "status" | "c2b" | "cancel",
    fn: () => Promise<GatewayPaymentLinkDTO>,
  ) => {
    setGatewayBusy((current) => ({ ...current, [modeOfPayment]: action }));
    setGatewayErrors((current) => ({ ...current, [modeOfPayment]: undefined }));
    try {
      const link = await fn();
      setPaidGatewayLink(modeOfPayment, link);
    } catch (gatewayError) {
      setGatewayErrors((current) => ({
        ...current,
        [modeOfPayment]:
          gatewayError instanceof Error
            ? gatewayError.message
            : "Gateway payment failed",
      }));
    } finally {
      setGatewayBusy((current) => ({ ...current, [modeOfPayment]: undefined }));
    }
  };
  const cancelGatewayLink = (modeOfPayment: string) => {
    const link = gatewayLinks[modeOfPayment];
    if (!link || !onCancelGatewayPayment) return;
    void runGatewayAction(modeOfPayment, "cancel", async () => {
      const cancelled = await onCancelGatewayPayment(link.name);
      setAmounts((current) => ({ ...current, [modeOfPayment]: "" }));
      return cancelled;
    });
  };
  useGatewayPaymentRealtime((event) => {
    const matchingMode = availableModes.find((mode) => {
      const currentLink = gatewayLinks[mode.mode_of_payment];
      return (
        currentLink?.name === event.name ||
        (currentLink?.source_doctype === event.source_doctype &&
          currentLink?.source_name === event.source_name)
      );
    });
    if (!matchingMode) return;
    if (event.pos_profile && posProfile && event.pos_profile !== posProfile)
      return;
    setPaidGatewayLink(matchingMode.mode_of_payment, event);
  });
  const activeGatewayLink = activeGatewayMode
    ? gatewayLinks[activeGatewayMode.mode_of_payment]
    : undefined;
  const activeGatewayLinkName = activeGatewayLink?.name;
  const activeGatewayLinkStatus = activeGatewayLink?.status;
  useEffect(() => {
    checkGatewayPaymentRef.current = onCheckGatewayPayment;
  }, [onCheckGatewayPayment]);
  useEffect(() => {
    const modeOfPayment = activeGatewayMode?.mode_of_payment;
    const linkName = activeGatewayLinkName;
    if (
      !modeOfPayment ||
      !linkName ||
      (activeGatewayLinkStatus !== "Draft" &&
        activeGatewayLinkStatus !== "Pending") ||
      !checkGatewayPaymentRef.current
    ) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | undefined;
    const poll = async () => {
      try {
        const link = await checkGatewayPaymentRef.current?.(linkName);
        if (!cancelled && link) setPaidGatewayLink(modeOfPayment, link);
      } catch (pollError) {
        // Realtime remains the primary confirmation path. A temporary polling
        // failure should not present a payment failure to the cashier.
        console.error("Unable to refresh gateway payment status", pollError);
      } finally {
        if (!cancelled) timeoutId = window.setTimeout(poll, 3000);
      }
    };

    timeoutId = window.setTimeout(poll, 2500);
    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [
    activeGatewayLinkName,
    activeGatewayLinkStatus,
    activeGatewayMode?.mode_of_payment,
    setPaidGatewayLink,
  ]);
  useEffect(() => {
    searchC2bGatewayPaymentsRef.current = onSearchC2bGatewayPayments;
  }, [onSearchC2bGatewayPayments]);
  useEffect(() => {
    const searchC2bGatewayPayments = searchC2bGatewayPaymentsRef.current;
    if (
      !activeGatewayMode?.payment_gateway ||
      !searchC2bGatewayPayments ||
      c2bQuery.trim().length < 3
    ) {
      setC2bResults([]);
      setC2bLoading(false);
      return;
    }
    let cancelled = false;
    setC2bLoading(true);
    const timeout = window.setTimeout(() => {
      searchC2bGatewayPayments({
        mode_of_payment: activeGatewayMode.mode_of_payment,
        query: c2bQuery.trim(),
        limit: 20,
      })
        .then((rows) => {
          if (!cancelled) setC2bResults(rows);
        })
        .catch((searchError) => {
          if (!cancelled) {
            setC2bResults([]);
            setGatewayErrors((current) => ({
              ...current,
              [activeGatewayMode.mode_of_payment]:
                searchError instanceof Error
                  ? searchError.message
                  : "Unable to search C2B payments",
            }));
          }
        })
        .finally(() => {
          if (!cancelled) setC2bLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [activeGatewayMode, c2bQuery]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-2 sm:p-4">
      <div className="flex h-[calc(100dvh-1rem)] max-h-[52rem] w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-lg sm:h-[calc(100dvh-2rem)]">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-outline-variant px-4 py-4 sm:px-6">
          <div>
            <h2 className="text-lg font-semibold text-on-surface">Checkout</h2>
            <p className="text-sm text-on-surface-variant">
              {isSalesOrder ? "Sales Order" : "Invoice"}{" "}
              {invoice?.is_local ? "#Draft" : invoice?.name || "#Draft"}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-2 hover:bg-surface-container"
            onClick={onClose}
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
          <div className="grid min-h-full lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)] lg:divide-x lg:divide-outline-variant">
            <section className="flex min-h-0 flex-col overflow-y-auto p-4 sm:p-6">
              {allowCreditSales && !isSalesOrder ? (
                <div className="order-3 my-3 flex flex-wrap items-center gap-4 rounded-md bg-surface-container-low px-3 py-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isCreditSale}
                      aria-label="Enable credit sale"
                      onClick={() => {
                        const credit = !isCreditSale;
                        setIsCreditSale(credit);
                        setAmounts(
                          credit
                            ? Object.fromEntries(
                                availableModes.map((mode) => [
                                  mode.mode_of_payment,
                                  "",
                                ]),
                              )
                            : createInitialPaymentAmounts(
                                availableModes,
                                payableMinor,
                                precision,
                              ),
                        );
                      }}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${isCreditSale ? "bg-secondary" : "bg-outline"}`}
                    >
                      <span
                        className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${isCreditSale ? "translate-x-5" : "translate-x-0.5"}`}
                      />
                    </button>
                    Credit sale
                  </div>
                  {isCreditSale ? (
                    <label className="flex min-w-48 flex-1 items-center gap-2 text-sm font-medium text-on-surface">
                      Due date
                      <input
                        type="date"
                        min={today}
                        required
                        value={dueDate}
                        onChange={(event) => setDueDate(event.target.value)}
                        className={`h-touch min-w-0 flex-1 rounded-md border bg-surface px-3 text-sm ${isCreditSale ? "border-error" : "border-outline-variant"}`}
                      />
                    </label>
                  ) : null}
                </div>
              ) : null}
              {isSalesOrder ? (
                <div className="order-3 my-3 rounded-md bg-surface-container-low px-3 py-2">
                  <label className="flex min-w-48 items-center gap-2 text-sm font-medium text-on-surface">
                    Delivery date
                    <input
                      type="date"
                      min={today}
                      required
                      aria-label="Sales Order delivery date"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                      className="h-touch min-w-0 flex-1 rounded-md border border-outline-variant bg-surface px-3 text-sm"
                    />
                  </label>
                </div>
              ) : null}
              {isWalkinCustomer || (allowDeliveryCharges && deliveryChargeItem) ? (
                <div className="order-4 mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {isWalkinCustomer ? (
                    <div className="relative">
                      <span className="pointer-events-none absolute -top-2 left-2 z-10 bg-surface px-1 text-[10px] font-medium text-on-surface-variant">
                        Customer Tax ID
                      </span>
                      <input
                        type="text"
                        value={checkoutTaxId}
                        onChange={(event) => setCheckoutTaxId(event.target.value)}
                        maxLength={140}
                        placeholder={
                          customer?.tax_id || "PIN / Tax ID for this receipt"
                        }
                        className="h-touch w-full rounded-md border border-outline-variant bg-surface px-3 text-sm"
                      />
                      <span className="mt-1 block text-xs font-normal text-on-surface-variant">
                        Printed on this invoice only.
                      </span>
                    </div>
                  ) : null}
                  {allowDeliveryCharges && deliveryChargeItem ? (
                    <div className="relative">
                      <span className="pointer-events-none absolute -top-2 left-2 z-10 bg-surface px-1 text-[10px] font-medium text-on-surface-variant">
                        Delivery charge
                      </span>
                      <input
                        className="h-touch w-full rounded-md border border-outline-variant bg-surface px-3 text-right text-sm"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Optional"
                        value={deliveryAmount}
                        disabled={allowDeliveryChargeChange === false}
                        onChange={(event) => setDeliveryAmount(event.target.value)}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              {customerAddressesLoading || customerAddresses?.length ? (
                <div className="order-4 mb-4 rounded-md bg-surface-container-low px-3 py-2">
                  <label className="block text-sm font-medium text-on-surface">
                    Shipping address
                    <select
                      aria-label="Shipping address"
                      value={shippingAddressName}
                      disabled={customerAddressesLoading}
                      onChange={(event) => setShippingAddressName(event.target.value)}
                      className="mt-1 h-touch w-full rounded-md border border-outline-variant bg-surface px-3 text-sm"
                    >
                      {customerAddresses?.map((address) => (
                        <option key={address.name} value={address.name}>
                          {address.address_title || address.name}
                          {address.city ? ` · ${address.city}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedShippingAddress?.formatted_address ? (
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {selectedShippingAddress.formatted_address}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {customerLoyalty?.enrolled && !isSalesOrder ? (
                <div className="order-3 mb-4 rounded-md border border-tertiary/40 bg-tertiary-container/30 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Award className="mt-0.5 size-4 shrink-0 text-tertiary" />
                    <span className="text-xs text-on-surface-variant">
                      {availableLoyaltyPoints.toLocaleString()} pts · {formatCurrency(customerLoyalty.redemption_value, currency, precision)}
                    </span>
                    <div className="relative min-w-32 flex-1">
                      <span className="pointer-events-none absolute -top-2 left-2 bg-tertiary-container px-1 text-[10px] font-medium text-on-surface-variant">
                        Loyalty points
                      </span>
                      <input
                        aria-label="Loyalty points to redeem"
                        className="h-9 w-full rounded-md border border-outline-variant bg-surface px-3 text-sm"
                        inputMode="numeric"
                        placeholder="Enter points"
                        value={loyaltyInput}
                        onChange={(event) =>
                          setLoyaltyInput(event.target.value)
                        }
                      />
                    </div>
                        <Button
                          variant="ghost"
                          className="h-9 px-2 text-xs"
                          disabled={!maximumLoyaltyPoints || isApplyingLoyalty}
                          onClick={() =>
                            void applyLoyaltyPoints(maximumLoyaltyPoints)
                          }
                        >
                          Maximum
                        </Button>
                        <Button
                          className="h-9 px-3 text-xs"
                          disabled={
                            Boolean(loyaltyInputError) ||
                            !loyaltyInputPoints ||
                            isApplyingLoyalty
                          }
                          onClick={() =>
                            void applyLoyaltyPoints(loyaltyInputPoints || 0)
                          }
                        >
                          {isApplyingLoyalty ? "Checking..." : "Apply"}
                        </Button>
                  </div>
                      {loyaltyInputError ? (
                        <p className="mt-2 text-xs text-error">
                          Enter between 1 and{" "}
                          {maximumLoyaltyPoints.toLocaleString()} points.
                        </p>
                      ) : null}
                      {loyaltyError ? (
                        <p className="mt-2 text-xs text-error">
                          {loyaltyError}
                        </p>
                      ) : null}
                      {!isLoyaltySelectionValid ? (
                        <p className="mt-2 text-xs text-error">
                          The available balance changed. Apply a valid number of
                          points again.
                        </p>
                      ) : null}
                      {appliedLoyaltyPoints ? (
                        <div className="mt-3 flex items-center justify-between text-xs">
                          <span className="text-on-surface-variant">
                            Applied: {appliedLoyaltyPoints.toLocaleString()}{" "}
                            points ·{" "}
                            {formatCurrency(
                              loyaltyAmountMinor / scale,
                              currency,
                              precision,
                            )}
                          </span>
                          <button
                            type="button"
                            className="font-medium text-error"
                            onClick={() => void applyLoyaltyPoints(0)}
                          >
                            Remove
                          </button>
                        </div>
                      ) : null}
                </div>
              ) : null}
              <div className="order-1">
                {isSalesOrder && !showSalesOrderPayments ? (
                  <div className="mt-6 rounded-md border border-outline-variant bg-surface-container-low p-4 text-sm text-on-surface-variant">
                    This checkout will create a submitted Sales Order. No payment
                    will be collected in this step.
                  </div>
                ) : (
                  <>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-primary">
                    Payment methods
                  </h3>
                  <div className="mb-3 grid grid-cols-3 gap-2 [&>div]:p-2">
                    <PaymentSummary
                      label="Allocated"
                      value={formatCurrency(
                        allocation.allocatedMinor / scale,
                        currency,
                        precision,
                      )}
                    />
                    <PaymentSummary
                      label={balanceLabel}
                      value={formatCurrency(
                        balanceMinor / scale,
                        currency,
                        precision,
                      )}
                      invalid={
                        allocation.hasInvalidAmount ||
                        hasNonCashOverpayment ||
                        (allocation.remainingMinor > 0 &&
                          !allowPartialPayment &&
                          !isCreditSale)
                      }
                    />
                    <PaymentSummary
                      label="Status"
                      value={paymentStatus}
                      invalid={!isPayable && !hasUnverifiedGatewayPayment}
                      compact
                    />
                  </div>
                  <div className="my-3 h-64 max-h-64 shrink-0 overflow-y-auto rounded-md bg-surface-container-low/70 px-2 shadow-sm lg:h-72 lg:max-h-72">
                    {availableModes.map((mode) => {
                      const isGatewayControlled = Boolean(mode.payment_gateway);
                      const amount = amounts[mode.mode_of_payment] ?? "";
                      const gatewayLink = gatewayLinks[mode.mode_of_payment];
                      const gatewayError = gatewayErrors[mode.mode_of_payment];
                      const gatewayPaid = isSuccessfulGatewayLink(gatewayLink);
                      const isAll =
                        parsePaymentAmount(amount, precision) ===
                          payableMinor &&
                        availableModes.every(
                          (other) =>
                            other.mode_of_payment === mode.mode_of_payment ||
                            parsePaymentAmount(
                              amounts[other.mode_of_payment] || "",
                              precision,
                            ) === 0,
                        );
                      return (
                        <div
                          key={mode.mode_of_payment}
                          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-outline-variant/40 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(11rem,15rem)] sm:py-3"
                        >
                          <button
                            type="button"
                            aria-pressed={isAll}
                            className={`order-2 col-span-1 inline-flex h-touch min-w-44 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold shadow-sm transition-colors sm:col-span-1 ${isAll ? "border-secondary bg-secondary/80 text-on-secondary" : "border-transparent bg-surface-container-highest text-on-surface hover:bg-surface-container-high"} ${isGatewayControlled ? "cursor-pointer" : ""}`}
                            onClick={() => {
                              if (isGatewayControlled) {
                                openGatewayDialog(mode);
                                return;
                              }
                              setAmounts(
                                allocateAllToMode(
                                  availableModes,
                                  mode.mode_of_payment,
                                  payableMinor,
                                  precision,
                                ),
                              );
                            }}
                          >
                            {isAll && !isGatewayControlled ? (
                              <Check className="size-4" />
                            ) : null}
                            {mode.mode_of_payment}
                            {mode.default ? (
                              <span className="ml-2 text-xs text-on-surface-variant">
                                Default
                              </span>
                            ) : null}
                            {isGatewayControlled ? (
                              <span className="ml-2 text-xs text-primary">
                                Gateway
                              </span>
                            ) : null}
                            {isGatewayControlled && gatewayLink ? (
                              <span
                                className={
                                  gatewayPaid
                                    ? "ml-2 text-xs text-secondary"
                                    : "ml-2 text-xs text-on-surface-variant"
                                }
                              >
                                {gatewayPaid
                                  ? `Paid${gatewayLink.transaction_reference ? ` · ${gatewayLink.transaction_reference}` : ""}`
                                  : `Status: ${gatewayLink.status}`}
                              </span>
                            ) : null}
                          </button>
                          <div className="order-1 relative">
                            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-on-surface-variant">
                              {currency}
                            </span>
                            <input
                              aria-label={`${mode.mode_of_payment} amount`}
                              className={`h-touch w-full rounded-md border border-outline-variant bg-surface pl-12 pr-3 text-left text-sm ${isGatewayControlled ? "cursor-pointer" : ""}`}
                              inputMode="decimal"
                              placeholder={minorUnitsToInput(0, precision)}
                              readOnly={isGatewayControlled}
                              value={
                                focusedPaymentMode === mode.mode_of_payment
                                  ? amount
                                  : amount
                                    ? Number.isFinite(Number(amount))
                                      ? new Intl.NumberFormat(undefined, {
                                          useGrouping: true,
                                          minimumFractionDigits: 0,
                                          maximumFractionDigits: precision,
                                        }).format(Number(amount))
                                      : amount
                                    : ""
                              }
                              onFocus={() => {
                                if (!isGatewayControlled) {
                                  setFocusedPaymentMode(mode.mode_of_payment);
                                }
                              }}
                              onBlur={() => setFocusedPaymentMode(null)}
                              onClick={() => {
                                if (isGatewayControlled) openGatewayDialog(mode);
                              }}
                              onChange={(event) => {
                                if (isGatewayControlled) return;
                                setAmounts((current) => {
                                  const next = {
                                    ...current,
                                    [mode.mode_of_payment]: event.target.value,
                                  };
                                  return autoAllocatePaymentBalance
                                    ? allocatePaymentRemainderToNextMode(
                                        availableModes,
                                        next,
                                        mode.mode_of_payment,
                                        payableMinor,
                                        precision,
                                      )
                                    : next;
                                });
                              }}
                            />
                          </div>
                          {isGatewayControlled ? (
                            <div className="order-3 col-span-2 flex items-center justify-between gap-2 text-xs text-on-surface-variant sm:col-span-2">
                              <span>
                                {gatewayPaid
                                  ? "Verified gateway payment"
                                  : "Click the mode name to verify through the gateway."}
                              </span>
                              {gatewayError ? (
                                <span className="text-error">
                                  {gatewayError}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  {hasUnverifiedGatewayPayment ? (
                    <div className="mt-2 flex gap-2 rounded-md border border-tertiary/40 bg-tertiary-container/30 p-2 text-xs text-on-tertiary-container">
                      <Smartphone className="size-4 shrink-0" /> Verify the
                      selected gateway payment to continue. Checkout will
                      unlock automatically after confirmation.
                    </div>
                  ) : null}
                  </>
                )}
              </div>
              {(!isSalesOrder || showSalesOrderPayments) && allocation.hasInvalidAmount ? (
                <div className="order-2 flex gap-2 rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
                  <AlertCircle className="size-4 shrink-0" /> Enter valid
                  amounts with no more than {precision} decimal places.
                </div>
              ) : null}
              {(!isSalesOrder || showSalesOrderPayments) && hasNonCashOverpayment ? (
                <div className="order-2 flex gap-2 rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
                  <AlertCircle className="size-4 shrink-0" /> Electronic
                  payments cannot exceed the amount due.
                </div>
              ) : null}
              {/* {allocation.remainingMinor > 0 && isCreditSale ? (
						<p className="text-sm text-on-surface-variant">
							The outstanding balance will remain on the customer's account. Add a payment above only when taking a deposit.
						</p>
					) : allocation.remainingMinor > 0 && allowPartialPayment ? (
						<p className="text-sm text-on-surface-variant">
							Partial payment is enabled.
						</p>
					) : null} */}
              {error ? (
                <div className="order-2 flex gap-2 rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
                  <AlertCircle className="size-4 shrink-0" /> {error}
                </div>
              ) : null}
            </section>
            <InvoiceSummary
              invoice={invoice}
              hiddenItemCode={deliveryChargeItem}
              currency={currency}
              precision={precision}
              allocatedMinor={isSalesOrder && !showSalesOrderPayments ? 0 : allocation.allocatedMinor}
              remainingMinor={
                isSalesOrder && !showSalesOrderPayments ? payableMinor : allocation.remainingMinor
              }
              loyaltyAmountMinor={isSalesOrder ? 0 : loyaltyAmountMinor}
            />
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-4 items-center gap-2 border-t border-outline-variant px-3 py-3 sm:flex sm:px-6">
          <Button
            variant="ghost"
            className="min-w-0 px-2 text-xs sm:px-3 sm:text-sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Back
          </Button>
          <Button
            variant="danger"
            className="min-w-0 gap-1 px-2 text-xs sm:gap-2 sm:px-3 sm:text-sm"
            onClick={onClear}
            disabled={isSubmitting}
          >
            <Trash2 className="size-4" /> Clear
          </Button>
          <Button
            variant="ghost"
            className="min-w-0 gap-1 px-2 text-xs bg-tertiary text-on-tertiary hover:bg-tertiary-container hover:text-on-tertiary-container sm:ml-auto sm:min-w-28 sm:gap-2 sm:px-3 sm:text-sm"
            onClick={onHold}
            disabled={isSubmitting || isSalesOrder}
            title={
              isSalesOrder
                ? "Holding Sales Orders is not supported yet"
                : undefined
            }
          >
            <Pause className="size-4" /> Hold
          </Button>
          <Button
            disabled={!isPayable || isSubmitting || deliveryApplying}
            onClick={async () => {
              if (
                deliveryEnabled &&
                onApplyDeliveryCharge &&
                Number.isFinite(Number(deliveryAmount)) &&
                Number(deliveryAmount) > 0
              ) {
                const amount = Number(deliveryAmount);
                setDeliveryApplying(true);
                try {
                  await onApplyDeliveryCharge(
                    Number.isFinite(amount) && amount > 0 ? amount : undefined,
                  );
                } finally {
                  setDeliveryApplying(false);
                }
              }
              onConfirm(
                isSalesOrder && !showSalesOrderPayments
                  ? []
                  : buildPaymentInputs(availableModes, amounts, precision).map(
                      (payment) => {
                        const gatewayLink =
                          gatewayLinks[payment.mode_of_payment];
                        return gatewayLink &&
                          isSuccessfulGatewayLink(gatewayLink)
                          ? {
                              ...payment,
                              gateway_payment_link: gatewayLink.name,
                            }
                          : payment;
                      },
                    ),
                idempotencyKey.current,
                isSalesOrder ? false : isCreditSale,
                isSalesOrder || isCreditSale ? dueDate : undefined,
                isSalesOrder ? undefined : appliedLoyaltyPoints || undefined,
                isWalkinCustomer
                  ? checkoutTaxId.trim() || undefined
                  : undefined,
              );
            }}
          >
            <span className="sm:hidden">
              {isSubmitting ? "..." : isSalesOrder ? "Order" : "Complete"}
            </span>
            <span className="hidden sm:inline">
              {isSubmitting
                ? "Submitting..."
                : isSalesOrder
                  ? "Create Sales Order"
                  : isCreditSale
                    ? "Complete credit sale"
                    : "Complete sale"}
            </span>
          </Button>
        </div>
      </div>
      {activeGatewayMode ? (
        <GatewayPaymentDialog
          amountMinor={gatewayAmountMinor(activeGatewayMode.mode_of_payment)}
          busy={gatewayBusy[activeGatewayMode.mode_of_payment]}
          c2bLoading={c2bLoading}
          c2bQuery={c2bQuery}
          c2bResults={c2bResults}
          currency={currency}
          error={gatewayErrors[activeGatewayMode.mode_of_payment]}
          gatewayLink={gatewayLinks[activeGatewayMode.mode_of_payment]}
          mode={activeGatewayMode}
          phone={gatewayPhones[activeGatewayMode.mode_of_payment] || ""}
          precision={precision}
          onAttachC2b={(payment) =>
            void runGatewayAction(
              activeGatewayMode.mode_of_payment,
              "c2b",
              () =>
                onAttachC2bGatewayPayment?.({
                  mode_of_payment: activeGatewayMode.mode_of_payment,
                  transaction_reference: payment.transaction_id,
                  amount:
                    gatewayAmountMinor(activeGatewayMode.mode_of_payment) /
                    scale,
                  idempotency_key: `${idempotencyKey.current}:${activeGatewayMode.mode_of_payment}:c2b:${payment.transaction_id}`,
                }) as Promise<GatewayPaymentLinkDTO>,
            )
          }
          onCancel={() => cancelGatewayLink(activeGatewayMode.mode_of_payment)}
          onCheckStatus={() => {
            const gatewayLink = gatewayLinks[activeGatewayMode.mode_of_payment];
            if (!gatewayLink) return;
            void runGatewayAction(
              activeGatewayMode.mode_of_payment,
              "status",
              () =>
                onCheckGatewayPayment?.(
                  gatewayLink.name,
                ) as Promise<GatewayPaymentLinkDTO>,
            );
          }}
          onClose={() => setActiveGatewayMode(null)}
          onInitiateStk={() =>
            void runGatewayAction(
              activeGatewayMode.mode_of_payment,
              "stk",
              () =>
                onInitiateGatewayPayment?.({
                  mode_of_payment: activeGatewayMode.mode_of_payment,
                  amount:
                    gatewayAmountMinor(activeGatewayMode.mode_of_payment) /
                    scale,
                  phone_number:
                    gatewayPhones[activeGatewayMode.mode_of_payment] || "",
                  idempotency_key: `${idempotencyKey.current}:${activeGatewayMode.mode_of_payment}:stk`,
	                  account_reference: invoice?.name,
                }) as Promise<GatewayPaymentLinkDTO>,
            )
          }
          onPhoneChange={(value) =>
            setGatewayPhones((current) => ({
              ...current,
              [activeGatewayMode.mode_of_payment]: value,
            }))
          }
          onSearchChange={setC2bQuery}
        />
      ) : null}
    </div>
  );
}

function InvoiceSummary({
  invoice,
  hiddenItemCode,
  currency,
  precision,
  allocatedMinor,
  remainingMinor,
  loyaltyAmountMinor,
}: {
  invoice: ReturnType<typeof useCartStore.getState>["invoice"];
  hiddenItemCode?: string | null;
  currency?: string;
  precision: number;
  allocatedMinor: number;
  remainingMinor: number;
  loyaltyAmountMinor: number;
}) {
  const scale = currencyScale(precision);
  const taxes = invoice?.taxes || [];
  return (
    <section className="flex flex-col bg-surface-container-low p-4 sm:p-6 lg:min-h-0">
      <h3 className="font-semibold text-on-surface">Invoice summary</h3>
      <div className="mt-4">
        <p className="text-xs text-on-surface-variant">Customer</p>
        <p className="font-medium text-on-surface">
          {invoice?.customer_name || invoice?.customer || "Walk-in Customer"}
        </p>
      </div>
      <div className="mt-5 flex min-h-0 flex-1 flex-col">
        <p className="text-xs font-medium uppercase tracking-wide text-on-surface-variant">
          Items
        </p>
        <div className="mt-2 max-h-56 min-h-0 space-y-2 overflow-y-auto pr-1 lg:max-h-none lg:flex-1">
          {invoice?.items?.filter((item) => item.item_code !== hiddenItemCode).map((item) => (
            <div
              key={item.row_name}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 text-sm"
            >
              <span className="truncate text-on-surface">{item.item_name}</span>
              <span className="text-on-surface-variant">×{item.qty}</span>
              <span className="font-medium text-on-surface">
                {formatCurrency(item.amount, currency, precision)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-5 space-y-2 border-t border-outline-variant pt-4 text-sm">
        <SummaryRow
          label="Subtotal"
          value={formatCurrency(invoice?.totals.net_total, currency, precision)}
        />
        {taxes.map((tax, index) => (
          <SummaryRow
            key={`${tax.account_head || tax.description}-${index}`}
            label={`${tax.description || tax.account_head || "Tax"}${tax.rate ? ` ${tax.rate}%` : ""}`}
            value={formatCurrency(tax.tax_amount, currency, precision)}
          />
        ))}
        <SummaryRow
          label="Grand total"
          value={formatCurrency(getInvoiceTotal(invoice), currency, precision)}
          strong
        />
        {loyaltyAmountMinor ? (
          <SummaryRow
            label="Loyalty redemption"
            value={`−${formatCurrency(loyaltyAmountMinor / scale, currency, precision)}`}
          />
        ) : null}
        {loyaltyAmountMinor ? (
          <SummaryRow
            label="Amount payable"
            value={formatCurrency(
              (totalToMinorUnits(getInvoiceTotal(invoice), precision) -
                loyaltyAmountMinor) /
                scale,
              currency,
              precision,
            )}
            strong
          />
        ) : null}
        <SummaryRow
          label="Paid"
          value={formatCurrency(allocatedMinor / scale, currency, precision)}
        />
        <SummaryRow
          label={remainingMinor < 0 ? "Change" : "Balance"}
          value={formatCurrency(
            Math.abs(remainingMinor) / scale,
            currency,
            precision,
          )}
          strong
        />
      </div>
    </section>
  );
}

function GatewayPaymentDialog({
  amountMinor,
  busy,
  c2bLoading,
  c2bQuery,
  c2bResults,
  currency,
  error,
  gatewayLink,
  mode,
  phone,
  precision,
  onAttachC2b,
  onCancel,
  onCheckStatus,
  onClose,
  onInitiateStk,
  onPhoneChange,
  onSearchChange,
}: {
  amountMinor: number;
  busy?: string;
  c2bLoading: boolean;
  c2bQuery: string;
  c2bResults: C2BGatewayPaymentDTO[];
  currency?: string;
  error?: string;
  gatewayLink?: GatewayPaymentLinkDTO;
  mode: ModeOfPaymentDTO;
  phone: string;
  precision: number;
  onAttachC2b: (payment: C2BGatewayPaymentDTO) => void;
  onCancel: () => void;
  onCheckStatus: () => void;
  onClose: () => void;
  onInitiateStk: () => void;
  onPhoneChange: (value: string) => void;
  onSearchChange: (value: string) => void;
}) {
  const scale = currencyScale(precision);
  const amount = amountMinor / scale;
  const paid = isSuccessfulGatewayLink(gatewayLink);
  const [activeTab, setActiveTab] = useState<"stk" | "c2b">(
    gatewayLink?.source_doctype === "KE C2B Payment Register" ? "c2b" : "stk",
  );
  const pendingGateway = isPendingGatewayLink(gatewayLink);
  const blocking = Boolean(busy) || pendingGateway;
  const [showManualCheck, setShowManualCheck] = useState(false);
  const c2bSearchReady = c2bQuery.trim().length >= 3;
  const selectedC2bName =
    gatewayLink?.source_doctype === "KE C2B Payment Register"
      ? gatewayLink.source_name
      : undefined;

  useEffect(() => {
    if (!pendingGateway) return;
    const timeoutId = window.setTimeout(() => setShowManualCheck(true), 15000);
    return () => window.clearTimeout(timeoutId);
  }, [gatewayLink?.name, pendingGateway]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3">
      <div className="flex h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface shadow-2xl sm:h-[48rem] sm:max-h-[calc(100dvh-2rem)]">
        <div className="flex items-start justify-between gap-4 border-b border-outline-variant px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-on-surface">
              {mode.mode_of_payment} gateway payment
            </h3>
            <p className="text-sm text-on-surface-variant">
              Verify {formatCurrency(amount, currency, precision)} through{" "}
              {mode.payment_gateway}.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-40"
            disabled={blocking}
            title={
              blocking
                ? "This payment is still pending"
                : "Close gateway payment"
            }
            onClick={onClose}
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="grid grid-cols-2 border-b border-outline-variant px-5 pt-4">
          <button
            type="button"
            className={`flex h-12 items-center justify-center gap-2 rounded-t-lg border border-b-0 text-sm font-medium transition-colors ${
              activeTab === "stk"
                ? "border-primary bg-primary-container/20 text-primary"
                : "border-transparent text-on-surface-variant hover:bg-surface-container"
            }`}
            onClick={() => setActiveTab("stk")}
          >
            <Smartphone className="size-4" />
            STK Push
          </button>
          <button
            type="button"
            className={`flex h-12 items-center justify-center gap-2 rounded-t-lg border border-b-0 text-sm font-medium transition-colors ${
              activeTab === "c2b"
                ? "border-primary bg-primary-container/20 text-primary"
                : "border-transparent text-on-surface-variant hover:bg-surface-container"
            }`}
            onClick={() => setActiveTab("c2b")}
          >
            <CreditCard className="size-4" />
            C2B Payment
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-5">
          {activeTab === "stk" ? (
            <section className="flex min-h-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-low p-4">
              <div className="flex min-h-0 w-full gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-container/30 text-primary">
                  <Smartphone className="size-5" />
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <h4 className="font-medium text-on-surface">
                    Send prompt to customer
                  </h4>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Enter the customer's phone number to send an STK push
                    request.
                  </p>
                  <input
                    aria-label={`${mode.mode_of_payment} phone number`}
                    className="mt-4 h-touch w-full rounded-md border border-outline-variant bg-surface px-3 text-sm"
                    inputMode="tel"
                    placeholder="Phone number"
                    value={phone}
                    onChange={(event) => onPhoneChange(event.target.value)}
                  />
                  <label className="mt-3 block text-xs font-medium text-on-surface-variant">
                    Amount
                    <input
                      aria-label={`${mode.mode_of_payment} gateway amount`}
                      className="mt-1 h-touch w-full cursor-default rounded-md border border-outline-variant bg-surface-container px-3 text-right text-sm font-medium text-on-surface"
                      readOnly
                      value={formatCurrency(amount, currency, precision)}
                    />
                  </label>
                  <Button
                    className="mt-3 w-full gap-2"
                    disabled={!amountMinor || paid || Boolean(busy) || blocking}
                    onClick={onInitiateStk}
                  >
                    {paid ? (
                      <CheckCircle2 className="size-4" />
                    ) : busy === "stk" ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Smartphone className="size-4" />
                    )}
                    {paid
                      ? "Payment verified"
                      : gatewayLink
                        ? "Retry STK"
                        : "Send STK"}
                  </Button>
                  <p className="mt-3 text-xs text-on-surface-variant">
                    An STK prompt will be sent to the customer's phone.
                  </p>
                </div>
              </div>
            </section>
          ) : (
            <section className="flex min-h-0 flex-1 rounded-lg border border-outline-variant bg-surface-container-low p-4">
              <div className="flex min-h-0 w-full gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-container/30 text-primary">
                  <CreditCard className="size-5" />
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <h4 className="font-medium text-on-surface">
                    Find customer payment
                  </h4>
                  <p className="mt-1 text-sm text-on-surface-variant">
                    Search by customer name, transaction ID, or phone number to
                    find C2B payments.
                  </p>
                  <div className="relative mt-4">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
                    <input
                      aria-label={`${mode.mode_of_payment} C2B search`}
                      className="h-touch w-full rounded-md border border-outline-variant bg-surface pl-9 pr-3 text-sm"
                      placeholder="Search C2B payments"
                      value={c2bQuery}
                      onChange={(event) => onSearchChange(event.target.value)}
                    />
                  </div>
                  <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-lg border border-outline-variant bg-surface">
                    {!c2bSearchReady ? (
                      <p className="p-3 text-sm text-on-surface-variant">
                        Enter at least 3 characters to search.
                      </p>
                    ) : c2bLoading ? (
                      <p className="p-3 text-sm text-on-surface-variant">
                        Searching...
                      </p>
                    ) : c2bResults.length ? (
                      <div className="divide-y divide-outline-variant">
                        {c2bResults.map((payment) => {
                          const matchesAmount =
                            totalToMinorUnits(
                              Number(payment.amount || 0),
                              precision,
                            ) === amountMinor;
                          const selected = selectedC2bName === payment.name;
                          return (
                            <button
                              type="button"
                              key={payment.name}
                              className={`grid w-full grid-cols-[auto_1fr] gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60 md:grid-cols-[auto_1.2fr_1fr_1fr] ${
                                selected ? "bg-primary-container/20" : ""
                              }`}
                              disabled={!matchesAmount || Boolean(busy)}
                              onClick={() => onAttachC2b(payment)}
                            >
                              <span
                                className={`mt-1 flex size-4 items-center justify-center rounded-full border ${
                                  selected
                                    ? "border-primary bg-primary text-on-primary"
                                    : "border-outline"
                                }`}
                              >
                                {selected ? <Check className="size-3" /> : null}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-on-surface">
                                  {payment.party_name ||
                                    payment.customer ||
                                    "Unknown payer"}
                                </span>
                                <span className="block truncate text-xs text-on-surface-variant">
                                  {payment.party_phone || "No phone"}
                                </span>
                              </span>
                              <span className="min-w-0 text-sm text-on-surface md:pt-1">
                                {payment.transaction_id}
                              </span>
                              <span className="text-sm font-medium text-on-surface md:pt-1">
                                {formatCurrency(
                                  payment.amount,
                                  payment.currency || currency,
                                  precision,
                                )}
                              </span>
                              {!matchesAmount ? (
                                <span className="col-span-full pl-7 text-xs text-error">
                                  Amount does not match this allocation.
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="p-3 text-sm text-on-surface-variant">
                        No matching C2B payments found.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
          <div className="mt-4 grid shrink-0 gap-3 rounded-lg border border-outline-variant bg-primary-container/10 p-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-on-surface-variant">Amount</p>
              <p className="mt-1 font-medium text-on-surface">
                {formatCurrency(amount, currency, precision)}
              </p>
            </div>
            <div>
              <p className="text-xs text-on-surface-variant">Channel</p>
              <p className="mt-1 font-medium text-on-surface">
                {mode.mode_of_payment}
              </p>
            </div>
            <div>
              <p className="text-xs text-on-surface-variant">Gateway</p>
              <p className="mt-1 font-medium text-on-surface">
                {mode.payment_gateway}
              </p>
            </div>
          </div>
          {blocking ? (
            <p className="mt-3 text-xs text-on-surface-variant">
              Waiting for payment confirmation. This dialog will close
              automatically when the gateway confirms the payment.
            </p>
          ) : null}
          {error ? <p className="mt-3 text-sm text-error">{error}</p> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-3 border-t border-outline-variant px-5 py-4">
          {showManualCheck && pendingGateway ? (
            <Button
              variant="ghost"
              disabled={!gatewayLink || Boolean(busy)}
              onClick={onCheckStatus}
            >
              {busy === "status" ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              Check status
            </Button>
          ) : pendingGateway ? (
            <span className="flex items-center gap-2 px-2 text-sm text-on-surface-variant">
              <Loader2 className="size-4 animate-spin" /> Waiting for
              confirmation
            </span>
          ) : null}
          <Button
            variant="ghost"
            disabled={!gatewayLink || paid || Boolean(busy)}
            onClick={onCancel}
          >
            {busy === "cancel" ? "Cancelling..." : "Cancel"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex justify-between gap-4 ${strong ? "font-semibold text-on-surface" : "text-on-surface-variant"}`}
    >
      <span>{label}</span>
      <span className="text-on-surface">{value}</span>
    </div>
  );
}

function PaymentSummary({
  label,
  value,
  invalid = false,
  compact = false,
}: {
  label: string;
  value: string;
  invalid?: boolean;
  compact?: boolean;
}) {
  return (
    <div
      className={`rounded-md p-3 ${invalid ? "bg-error-container" : "bg-surface-container-low"}`}
    >
      <p
        className={`text-xs ${invalid ? "text-on-error-container" : "text-on-surface-variant"}`}
      >
        {label}
      </p>
      <p
        className={`mt-1 whitespace-nowrap font-semibold ${compact ? "text-sm" : ""} ${invalid ? "text-on-error-container" : "text-on-surface"}`}
      >
        {value}
      </p>
    </div>
  );
}
