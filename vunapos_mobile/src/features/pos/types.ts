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

export type PosInvoiceStatus = 'Cancelled' | 'Credit Note' | 'Overdue' | 'Paid' | 'Partly Paid' | 'Unpaid';

export type PosInvoiceListRow = {
  cashier?: string;
  currency?: string;
  customerId?: string;
  customerName: string;
  invoiceNumber: string;
  itemCount: number;
  openingEntry?: string;
  outstandingAmount: number;
  payments: PosInvoiceHistoryPayment[];
  paymentMode: string;
  postedAt: string;
  status: PosInvoiceStatus;
  total: number;
};

export type PosBootstrapData = {
  payment_modes: { mode_of_payment: string }[];
  pos_profile: {
    currency?: string;
    currency_precision?: number;
    name: string;
  };
};

export type PosInvoiceHistoryFilters = {
  currentShift: boolean;
  customer: string;
  documentType: 'Invoice' | 'Order';
  fromDate: string;
  invoice: string;
  paymentMode: string;
  saleType: '' | 'Cash Sale' | 'Credit Sale';
  status: '' | PosInvoiceStatus;
  toDate: string;
};

export type PosInvoiceHistoryPayment = {
  amount: number;
  ke_payment_request?: string;
  mode_of_payment: string;
  transaction_reference?: string;
};

export type PosInvoiceHistoryRow = {
  currency?: string;
  customer?: string;
  customer_name?: string;
  due_date?: string;
  grand_total: number;
  is_return: boolean;
  name: string;
  outstanding_amount: number;
  payments: PosInvoiceHistoryPayment[];
  posting_date: string;
  posting_time?: string;
  rounded_total?: number;
  status: PosInvoiceStatus;
  total_qty: number;
  vunapos_credit_sale?: boolean;
  vunapos_opening_entry?: string;
  vunapos_session_cashier?: string;
};

export type PosInvoiceHistory = {
  has_more: boolean;
  invoices: PosInvoiceHistoryRow[];
  summary: {
    credit_outstanding: number;
    credit_sales: number;
    gross_sales: number;
    invoice_count: number;
    outstanding: number;
    returns: number;
  };
};
