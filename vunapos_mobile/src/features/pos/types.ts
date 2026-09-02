export type PosOrderType = 'Invoice' | 'Order';

/** Tabs enabled in the native increment. The remaining shell tabs are visual only. */
export type PosNavigationTab = 'Home' | 'Invoices';

export type PosPreviewItem = {
  itemCode: string;
  itemName: string;
  price: number;
  quantity: number;
  taxLabel: string;
};

export type PosInvoiceStatus = 'Paid' | 'Partly Paid' | 'Unpaid' | 'Credit Note';

export type PosPreviewInvoice = {
  customerName: string;
  invoiceNumber: string;
  itemCount: number;
  paymentMode: string;
  postedAt: string;
  status: PosInvoiceStatus;
  total: number;
};
