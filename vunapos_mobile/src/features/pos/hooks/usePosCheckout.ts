import { useCallback, useEffect, useRef, useState } from "react";

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { PaymentInput } from "@/features/pos/paymentAllocation";
import {
  PosCartItem,
  PosCheckoutPreview,
  PosCheckoutResult,
  PosCartSource,
  PosOrderType,
} from "@/features/pos/types";
import {
  FrappeClientError,
  getVunaMethod,
  postVunaMethod,
} from "@/services/frappeClient";
import { invalidateSaleCache } from "@/services/posCacheInvalidation";

type PreviewInput = {
  customer?: string;
  items: PosCartItem[];
  loyaltyPoints?: number;
  posProfile?: string;
  priceList?: string;
};

type SubmitInput = PreviewInput & {
  checkoutFields?: Record<string, boolean | number | string | null>;
  deliveryDate?: string;
  dueDate?: string;
  isCreditSale: boolean;
  loyaltyPoints?: number;
  orderType: PosOrderType;
  payments: PaymentInput[];
  salesperson?: string;
  salespersonToken?: string;
  shippingAddressName?: string;
  sourceInvoice?: PosCartSource | null;
  taxId?: string;
};

function cartPayload(items: PosCartItem[]) {
  return items.map((item) => ({
    batch_allocations: item.batch_allocations?.map((allocation) => ({
      batch_no: allocation.batch_no,
      qty: allocation.qty,
    })),
    item_code: item.item_code,
    item_note: item.item_note || undefined,
    pricing_override: item.pricing_override,
    qty: item.qty,
    serial_allocations: item.serial_allocations,
    uom: item.uom || undefined,
  }));
}

function createIdempotencyKey() {
  return `mobile-checkout-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Fetches server-calculated invoice totals before a cashier allocates payment. */
export function usePosCheckoutPreview(input: PreviewInput | null) {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const hasInput = Boolean(input);
  const customer = input?.customer;
  const loyaltyPoints = input?.loyaltyPoints;
  const posProfile = input?.posProfile;
  const priceList = input?.priceList;
  const itemsPayload = input ? JSON.stringify(cartPayload(input.items)) : "";
  const activeKey =
    hasInput && companyUrl && sessionId && posProfile && input?.items.length
      ? JSON.stringify({
          companyUrl,
          customer,
          items: itemsPayload,
          loyaltyPoints,
          posProfile,
          priceList,
          sessionId,
        })
      : null;
  const requestKey = connectionStatus === "online" ? activeKey : null;
  const [state, setState] = useState<{
    data: PosCheckoutPreview | null;
    error: string | null;
    key: string | null;
  }>({ data: null, error: null, key: null });

  const previewLoyalty = useCallback(
    async (points: number): Promise<PosCheckoutPreview> => {
      if (connectionStatus !== "online")
        throw new Error(
          "Connection unavailable. Reconnect before updating loyalty points.",
        );
      if (!companyUrl || !sessionId || !posProfile || !itemsPayload) {
        throw new Error(
          "Your session is no longer available. Sign in again to continue.",
        );
      }
      try {
        return await getVunaMethod<PosCheckoutPreview>(
          companyUrl,
          sessionId,
          "vunapos.api.sales.preview_invoice",
          {
            customer,
            items: itemsPayload,
            loyalty_points: points || undefined,
            pos_profile: posProfile,
            price_list: priceList,
          },
        );
      } catch (requestError) {
        if (
          requestError instanceof FrappeClientError &&
          requestError.code === "session"
        )
          void invalidateSession();
        throw requestError;
      }
    },
    [
      companyUrl,
      connectionStatus,
      customer,
      invalidateSession,
      itemsPayload,
      posProfile,
      priceList,
      sessionId,
    ],
  );

  useEffect(() => {
    if (
      !hasInput ||
      !companyUrl ||
      !sessionId ||
      !posProfile ||
      !itemsPayload ||
      !requestKey
    )
      return;

    const controller = new AbortController();
    void getVunaMethod<PosCheckoutPreview>(
      companyUrl,
      sessionId,
      "vunapos.api.sales.preview_invoice",
      {
        customer,
        items: itemsPayload,
        loyalty_points: loyaltyPoints || undefined,
        pos_profile: posProfile,
        price_list: priceList,
      },
      controller.signal,
    )
      .then((data) => setState({ data, error: null, key: requestKey }))
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        if (
          requestError instanceof FrappeClientError &&
          requestError.code === "session"
        ) {
          void invalidateSession();
          return;
        }
        setState({
          data: null,
          error:
            requestError instanceof Error
              ? requestError.message
              : "Could not calculate this sale.",
          key: requestKey,
        });
      });
    return () => controller.abort();
  }, [
    companyUrl,
    customer,
    hasInput,
    invalidateSession,
    itemsPayload,
    loyaltyPoints,
    posProfile,
    priceList,
    requestKey,
    sessionId,
  ]);

  return {
    data: state.key === activeKey ? state.data : null,
    error: state.key === activeKey ? state.error : null,
    isLoading: Boolean(requestKey && state.key !== activeKey),
    previewLoyalty,
  };
}

/** Submits an online-only sale with one stable idempotency key per checkout attempt. */
export function useSubmitPosCheckout() {
  const { companyUrl, invalidateSession, sessionId } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [salespersonTokenExpired, setSalespersonTokenExpired] = useState(false);
  const idempotencyKey = useRef(createIdempotencyKey());

  function clearError() {
    setError(null);
    setSalespersonTokenExpired(false);
  }

  function cashierError(requestError: unknown) {
    const message = requestError instanceof Error ? requestError.message : "";
    const normalized = message.toLowerCase();
    if (
      normalized.includes("insufficient stock") ||
      normalized.includes("out of stock")
    )
      return "Stock changed before submission. Review the cart and try again.";
    if (normalized.includes("price") || normalized.includes("pricing rule"))
      return "Pricing changed before submission. Review the updated cart and try again.";
    if (
      normalized.includes("permission") ||
      normalized.includes("not permitted")
    )
      return "You do not have permission to complete this sale. Ask a manager for help.";
    if (normalized.includes("validation") || normalized.includes("mandatory"))
      return "Some sale details need attention. Review the highlighted checkout information and try again.";
    return (
      message ||
      "Could not complete this sale. Check your connection and try again."
    );
  }

  async function submit(input: SubmitInput): Promise<PosCheckoutResult | null> {
    if (connectionStatus !== "online") {
      setError(
        "Connection unavailable. Reconnect before submitting this sale.",
      );
      return null;
    }
    if (!companyUrl || !sessionId || !input.posProfile) {
      setError(
        "Your session is no longer available. Sign in again to continue.",
      );
      return null;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const checkoutFields = input.checkoutFields
        ? Object.fromEntries(
            Object.entries(input.checkoutFields).filter(
              ([, value]) =>
                value !== "" && value !== null && value !== undefined,
            ),
          )
        : {};
      const submitParams = {
        customer: input.customer,
        ...(Object.keys(checkoutFields).length
          ? { checkout_fields: JSON.stringify(checkoutFields) }
          : {}),
        idempotency_key: idempotencyKey.current,
        payments: JSON.stringify(input.payments),
        ...(input.orderType === "Invoice" && input.isCreditSale
          ? { due_date: input.dueDate, is_credit_sale: true }
          : {}),
        ...(input.orderType === "Invoice" && input.loyaltyPoints
          ? { loyalty_points: input.loyaltyPoints }
          : {}),
        ...(input.orderType === "Invoice" && input.taxId?.trim()
          ? { tax_id: input.taxId.trim() }
          : {}),
        ...(input.shippingAddressName?.trim()
          ? { shipping_address_name: input.shippingAddressName.trim() }
          : {}),
        ...(input.salesperson?.trim() && input.salespersonToken?.trim()
          ? {
              salesperson: input.salesperson.trim(),
              salesperson_token: input.salespersonToken.trim(),
            }
          : {}),
      };
      if (input.sourceInvoice) {
        await postVunaMethod<PosCheckoutResult>(
          companyUrl,
          sessionId,
          "vunapos.api.sales.update_invoice_from_cart",
          {
            customer: input.customer,
            invoice_doctype: input.sourceInvoice.doctype,
            invoice_name: input.sourceInvoice.name,
            items: JSON.stringify(cartPayload(input.items)),
            price_list: input.priceList,
            ...(input.loyaltyPoints
              ? { loyalty_points: input.loyaltyPoints }
              : {}),
          },
        );
      }
      const result = await postVunaMethod<PosCheckoutResult>(
        companyUrl,
        sessionId,
        input.sourceInvoice
          ? "vunapos.api.sales.checkout_invoice"
          : input.orderType === "Order"
            ? "vunapos.api.sales.create_and_submit_sales_order"
            : "vunapos.api.sales.create_and_submit_invoice",
        {
          ...submitParams,
          ...(input.sourceInvoice
            ? {
                invoice_doctype: input.sourceInvoice.doctype,
                invoice_name: input.sourceInvoice.name,
              }
            : {
                items: JSON.stringify(cartPayload(input.items)),
                pos_profile: input.posProfile,
                price_list: input.priceList,
              }),
          ...(input.orderType === "Order"
            ? { delivery_date: input.deliveryDate }
            : {}),
        },
      );
      await invalidateSaleCache({
        companyUrl,
        posProfile: input.posProfile,
        sessionId,
        sourceInvoice: input.sourceInvoice,
      });
      idempotencyKey.current = createIdempotencyKey();
      return result;
    } catch (requestError) {
      const errorText =
        requestError instanceof Error ? requestError.message.toLowerCase() : "";
      if (
        errorText.includes("salesperson token") &&
        (errorText.includes("expired") || errorText.includes("invalid"))
      )
        setSalespersonTokenExpired(true);
      if (
        requestError instanceof FrappeClientError &&
        requestError.code === "session"
      ) {
        void invalidateSession();
      }
      setError(cashierError(requestError));
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }

  return { clearError, error, isSubmitting, salespersonTokenExpired, submit };
}
