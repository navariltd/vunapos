import type { StockEntryDetails, TrackingAllocation } from "./types";

export type ReceivingItem = StockEntryDetails["items"][number];
export function receivableDrafts(receipts: StockEntryDetails["receipts"]) {
  return receipts.filter(
    (row) => row.docstatus === 0 && !row.has_other_warehouses
  );
}
export type AcceptedQuantity = {
  source_row: string;
  qty: number;
  uom: string;
  allocations?: TrackingAllocation[];
};
export type ReceiptSelection = Record<
  string,
  { qty: string; uom: string; allocations?: TrackingAllocation[] }
>;
export function initialReceiptSelection(
  items: ReceivingItem[]
): ReceiptSelection {
  return Object.fromEntries(
    items
      .filter((row) => row.remaining_qty > 0)
      .map((row) => {
        const sourceQty = row.remaining_qty / (row.conversion_factor || 1);
        const precision = row.qty_precision ?? 6;
        const stockInstead =
          (row.whole_uom && !Number.isInteger(sourceQty)) ||
          Number(sourceQty.toFixed(precision)) !== sourceQty;
        return [
          row.name,
          {
            qty: String(stockInstead ? row.remaining_qty : sourceQty),
            uom: stockInstead ? row.stock_uom : row.uom,
            allocations: row.tracking?.map((part) => ({ ...part })),
          },
        ];
      })
  );
}
export function receiptLineState(
  item: ReceivingItem,
  choice?: ReceiptSelection[string]
) {
  const qty = Number(choice?.qty);
  const factor =
    choice?.uom === item.stock_uom ? 1 : item.conversion_factor || 1;
  const precision = item.stock_precision ?? 6;
  const stock = Number((qty * factor).toFixed(precision));
  const whole =
    choice?.uom === item.stock_uom ? item.whole_stock_uom : item.whole_uom;
  let error = "";
  if (!choice || choice.qty.trim() === "" || !Number.isFinite(qty) || qty < 0)
    error = "Enter zero or a positive quantity.";
  else if (qty !== Number(qty.toFixed(item.qty_precision ?? 6)))
    error = "This quantity has too many decimal places.";
  else if (stock > item.remaining_qty)
    error = "Accepted quantity exceeds the quantity remaining in transit.";
  else if (qty > 0 && stock <= 0)
    error = "The accepted quantity is too small for the stock precision.";
  else if (whole && !Number.isInteger(qty))
    error = `Enter a whole number of ${choice.uom}.`;
  else if (item.whole_stock_uom && !Number.isInteger(stock))
    error = `Accepted quantity must convert to a whole number of ${item.stock_uom}.`;
  else if (
    choice?.allocations &&
    item.tracking?.length &&
    stock > 0 &&
    (Number(
      choice.allocations
        .reduce((total, part) => total + part.qty, 0)
        .toFixed(precision)
    ) !== stock ||
      choice.allocations.some(
        (part) =>
          !Number.isFinite(part.qty) ||
          part.qty <= 0 ||
          (part.serial_no && part.qty !== 1) ||
          part.qty >
            (item.tracking?.find(
              (value) =>
                value.batch_no === part.batch_no &&
                value.serial_no === part.serial_no
            )?.qty ?? 0)
      ))
  )
    error = `Select batches or serial numbers totalling ${stock} ${item.stock_uom}.`;
  else if (
    !choice?.allocations &&
    item.partial_tracking_restricted &&
    stock > 0 &&
    stock !== item.remaining_qty
  )
    error =
      "Choose exact batches or serial numbers for a partial receipt of this item.";
  return {
    qty,
    stock,
    error,
    left: Math.max(0, Number((item.remaining_qty - stock).toFixed(precision))),
  };
}
