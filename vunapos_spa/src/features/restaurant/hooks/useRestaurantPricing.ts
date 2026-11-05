import { useCallback, useEffect, useMemo, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { previewRestaurantCart, vunaMethods } from "../../../services/vunaApi";
import { effectiveHeader, planSave, type OrderDraft } from "../orderDraft";
import { applyRestaurantPreview, restaurantCart } from "../restaurantCart";
import type { BootstrapData, InvoiceDTO, ItemDTO } from "../../pos/types";
import type { MenuDTO } from "../types";

export function restaurantPricingKey(
  draft: OrderDraft | null,
  priceList?: string | null,
  configuration = ""
): string {
  if (!draft) return "";
  return JSON.stringify([
    draft.idempotency_key,
    draft.pos_profile,
    draft.service_type,
    draft.table,
    effectiveHeader(draft).customer,
    priceList,
    configuration,
    draft.unsent.map(({ line_id, item_code, qty, uom, modifiers }) => ({
      line_id,
      item_code,
      qty,
      uom,
      modifiers,
    })),
  ]);
}

/** Retail's local engine first, followed by a stale-safe native Sales Order preview. */
export function useRestaurantPricing(
  draft: OrderDraft | null,
  catalogue: ItemDTO[],
  menu: MenuDTO | null,
  bootstrap: BootstrapData | null | undefined,
  priceList: string | null | undefined,
  onError: (message: string | null) => void,
  deferNative = false
) {
  const call = useFrappePostCall(vunaMethods.previewRestaurantCart);
  const [priced, setPriced] = useState<{
    key: string;
    invoice: InvoiceDTO;
  } | null>(null);
  const configuration = useMemo(
    () =>
      JSON.stringify([
        menu?.price_list,
        menu?.pricing_context,
        menu?.modifier_groups,
        menu?.items.map(
          ({
            item_code,
            rate,
            price_list_rate,
            pricing_rule,
            uoms,
            item_tax,
          }) => ({
            item_code,
            rate,
            price_list_rate,
            pricing_rule,
            uoms,
            item_tax,
          })
        ),
        bootstrap?.currency_precision,
        bootstrap?.disable_rounded_total,
        bootstrap?.smallest_currency_fraction_value,
        bootstrap?.rounding_method,
      ]),
    [
      menu,
      bootstrap?.currency_precision,
      bootstrap?.disable_rounded_total,
      bootstrap?.smallest_currency_fraction_value,
      bootstrap?.rounding_method,
    ]
  );
  const key = restaurantPricingKey(draft, priceList, configuration);
  const accept = useCallback(
    (next: OrderDraft, invoice: InvoiceDTO) => {
      setPriced({
        key: restaurantPricingKey(next, priceList, configuration),
        invoice,
      });
    },
    [priceList, configuration]
  );
  const local = useMemo(
    () =>
      draft
        ? restaurantCart(draft, catalogue, menu || undefined, {
            currencyPrecision: bootstrap?.currency_precision,
            disableRoundedTotal: bootstrap?.disable_rounded_total,
            smallestCurrencyFractionValue:
              bootstrap?.smallest_currency_fraction_value,
            roundingMethod: bootstrap?.rounding_method,
          })
        : null,
    [draft, catalogue, menu, bootstrap]
  );
  const current = priced?.key === key ? priced.invoice : null;
  const items = useMemo(() => {
    if (!draft) return null;
    const step = planSave(draft)[0];
    return step?.kind === "create" ? step.params.items : null;
  }, [draft]);
  const profile = draft?.pos_profile;
  const service = draft?.service_type;
  const table = draft?.table;
  const customer = draft ? effectiveHeader(draft).customer : null;
  useEffect(() => {
    if (
      deferNative ||
      current ||
      !key ||
      !items?.length ||
      !profile ||
      !service
    )
      return;
    let active = true;
    const timer = setTimeout(() => {
      void previewRestaurantCart(call.call, {
        pos_profile: profile,
        service_type: service,
        table,
        customer,
        price_list: priceList,
        items,
      })
        .then((invoice) => {
          if (active) setPriced({ key, invoice });
        })
        .catch((error: unknown) => {
          if (active)
            onError(
              error instanceof Error
                ? error.message
                : "Unable to calculate order totals."
            );
        });
    }, 100);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    key,
    current,
    items,
    profile,
    service,
    table,
    customer,
    priceList,
    call.call,
    onError,
    deferNative,
  ]);
  return {
    invoice: local && current ? applyRestaurantPreview(local, current) : local,
    accept,
  };
}
