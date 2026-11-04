import type { InvoiceDTO, ItemDTO } from "../pos/types";
import { effectiveHeader, type OrderDraft } from "./orderDraft";

/** Present an unsent round in the retail cart without touching retail invoice state. */
export function restaurantCart(
  draft: OrderDraft,
  catalogue: ItemDTO[]
): InvoiceDTO {
  const header = effectiveHeader(draft);
  const items = draft.unsent.map((line) => {
    const item = catalogue.find((row) => row.item_code === line.item_code);
    const uom = line.uom || item?.uom || item?.stock_uom || "";
    const option = item?.uoms?.find((row) => row.uom === uom);
    const factor = Number(
      option?.conversion_factor || item?.conversion_factor || 1
    );
    const rate =
      uom === item?.uom
        ? Number(item.rate || 0)
        : option?.rate != null
        ? Number(option.rate)
        : (Number(item?.rate || 0) * factor) /
          Number(item?.conversion_factor || 1);
    return {
      row_name: line.line_id,
      item_code: line.item_code,
      item_name: line.item_name,
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
  return {
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
}
