export type PosOrderType = 'Invoice' | 'Order';

export type PosPreviewItem = {
  itemCode: string;
  itemName: string;
  price: number;
  quantity: number;
  taxLabel: string;
};
