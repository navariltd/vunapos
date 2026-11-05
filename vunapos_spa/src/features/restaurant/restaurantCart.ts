import type { InvoiceDTO, ItemDTO } from "../pos/types";
import { effectiveHeader, type OrderDraft } from "./orderDraft";
import {
  assembleInvoice,
  type EngineRoundingSettings,
} from "../../lib/invoiceEngine";
import type { MenuDTO } from "./types";

/** Present an unsent round in the retail cart without touching retail invoice state. */
export function restaurantCart(
  draft: OrderDraft,
  catalogue: ItemDTO[],
  menu?: Pick<MenuDTO, "pricing_context" | "modifier_groups">,
  roundingSettings?: EngineRoundingSettings
): InvoiceDTO {
  const header = effectiveHeader(draft);
  const items = draft.unsent.map((line) => {
    const item = catalogue.find((row) => row.item_code === line.item_code);
    const uom = line.uom || item?.uom || item?.stock_uom || "";
    const option = item?.uoms?.find((row) => row.uom === uom);
    const factor = Number(
      option?.conversion_factor || item?.conversion_factor || 1
    );
    const baseRate =
      uom === item?.uom
        ? Number(item.rate || 0)
        : option?.rate != null
        ? Number(option.rate)
        : (Number(item?.rate || 0) * factor) /
          Number(item?.conversion_factor || 1);
    const rate =
      baseRate +
      (line.modifiers || []).reduce(
        (sum, choice) => sum + choice.extra_rate,
        0
      );
    return {
      row_name: line.line_id,
      item_code: line.item_code,
      item_name: line.item_name,
      is_qsr: item?.is_qsr,
      item_tax: item?.item_tax,
      item_tax_template: item?.item_tax_template,
      qty: line.qty,
      uom,
      stock_uom: item?.stock_uom,
      conversion_factor: factor,
      uoms: item?.uoms,
      rate,
      price_list_rate: rate,
      amount: rate * line.qty,
      item_note: line.note,
      has_batch_no: false,
      has_serial_no: false,
    };
  });
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  const invoice: InvoiceDTO = {
    doctype: "Sales Order",
    name: "",
    docstatus: 0,
    is_local: true,
    customer: header.customer || undefined,
    customer_name: header.customer_name || undefined,
    items,
    taxes: [],
    totals: { net_total: total, grand_total: total },
  };
  if (!menu?.pricing_context || !items.length) return invoice;
  const context = menu.pricing_context;
  const lines: Array<{
    item_code: string;
    qty: number;
    rate: number;
    tax?: ItemDTO["item_tax"];
  }> = [];
  for (const [index, line] of draft.unsent.entries()) {
    const item = items[index];
    const extras = (line.modifiers || []).reduce(
      (sum, choice) => sum + choice.extra_rate,
      0
    );
    lines.push({
      item_code: line.line_id,
      qty: line.qty,
      rate: item.rate - extras,
      tax: item.item_tax,
    });
    for (const [choiceIndex, choice] of (line.modifiers || []).entries()) {
      const option =
        menu.modifier_groups?.[line.item_code]
          ?.find((group) => group.name === choice.group)
          ?.options.find((row) => row.name === choice.option) ||
        Object.values(menu.modifier_groups || {})
          .flat()
          .find((group) => group.name === choice.group)
          ?.options.find((row) => row.name === choice.option);
      if (option?.addon_item)
        lines.push({
          item_code: `${line.line_id}:addon:${choiceIndex}`,
          qty: line.qty * option.addon_qty,
          rate: option.rate,
          tax: option.item_tax,
        });
      else if (choice.extra_rate)
        lines.push({
          item_code: `${line.line_id}:extra:${choiceIndex}`,
          qty: line.qty,
          rate: choice.extra_rate,
          tax: item.item_tax,
        });
    }
  }
  const byCode = new Map(lines.map((row) => [row.item_code, row]));
  try {
    const assembled = assembleInvoice({
      cart: lines,
      priceResolver: (code) => byCode.get(code)?.rate,
      taxRows: context.tax_rows,
      taxSettings: context.tax_settings,
      roundingSettings,
      itemTaxResolver: (code) =>
        byCode
          .get(code)
          ?.tax?.accounts.map((account) => ({
            ...account,
            included_in_print_rate:
              context.tax_rows.find(
                (row) => row.account_head === account.account_head
              )?.included_in_print_rate ??
              context.item_prices_include_tax ??
              false,
          })),
    });
    return { ...invoice, taxes: assembled.taxes, totals: assembled.totals };
  } catch {
    // Native pricing remains authoritative for shapes the retail engine does
    // not support. The controller requests that preview in the background.
    return invoice;
  }
}

/** Keep editable parent rows while accounting for separately taxed native add-ons. */
export function applyRestaurantPreview(
  local: InvoiceDTO,
  preview: InvoiceDTO
): InvoiceDTO {
  const children = preview.items.filter((row) => row.restaurant_parent_line_id);
  return {
    ...preview,
    is_local: true,
    items: preview.items
      .filter((row) => !row.restaurant_parent_line_id)
      .map((row) => {
        const meta = local.items.find((item) => item.row_name === row.row_name);
        const addons = children.filter(
          (child) => child.restaurant_parent_line_id === row.row_name
        );
        const amount =
          row.amount + addons.reduce((sum, child) => sum + child.amount, 0);
        const rate = amount / row.qty;
        const listRate =
          Number(row.price_list_rate ?? row.rate) +
          addons.reduce(
            (sum, child) =>
              sum +
              (Number(child.price_list_rate ?? child.rate) * child.qty) /
                row.qty,
            0
          );
        return {
          ...meta,
          ...row,
          rate,
          amount,
          price_list_rate: listRate,
          discount_amount: Math.max(0, listRate - rate),
          discount_percentage:
            listRate > 0
              ? Math.max(0, ((listRate - rate) / listRate) * 100)
              : 0,
          is_qsr: meta?.is_qsr,
          item_note: meta?.item_note ?? row.item_note,
          has_batch_no: false,
          has_serial_no: false,
        };
      }),
  };
}
