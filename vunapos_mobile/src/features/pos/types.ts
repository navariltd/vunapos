export type PosOrderType = 'Invoice' | 'Order';

/** Tabs enabled in the native increment. The remaining shell tabs are visual only. */
export type PosNavigationTab = 'Home' | 'Invoices';

export type PosCatalogueItem = {
  actual_qty?: number | null;
  allow_negative_stock?: boolean | number | null;
  barcode?: string | null;
  image?: string | null;
  is_stock_item?: boolean | number | null;
  item_code: string;
  item_name: string;
  item_tax?: {
    exclusive_tax_rate?: number | null;
    inclusive?: boolean | null;
    inclusive_tax_rate?: number | null;
  } | null;
  rate?: number | null;
  stock_uom?: string | null;
};

export type PosCartItem = {
  amount?: number;
  allow_negative_stock: boolean;
  available_qty: number | null;
  conversion_factor?: number;
  is_free_item?: boolean;
  is_stock_item: boolean;
  item_code: string;
  item_name: string;
  price_list_rate?: number;
  qty: number;
  rate: number;
  uom?: string | null;
};

export type PosCartTax = {
  account_head?: string;
  description?: string;
  included_in_print_rate?: boolean;
  rate?: number;
  tax_amount?: number;
};

export type PosCartTotals = {
  grand_total?: number;
  net_total?: number;
  rounded_total?: number;
  total_taxes_and_charges?: number;
};

export type PosCartData = {
  items: PosCartItem[];
  taxes: PosCartTax[];
  totals: PosCartTotals;
};

export type PosInvoiceStatus = 'Cancelled' | 'Credit Note' | 'Overdue' | 'Paid' | 'Partly Paid' | 'Unpaid';

export type PosInvoiceListRow = {
  cashier?: string;
  creditSale: boolean;
  currency?: string;
  customerId?: string;
  customerName: string;
  doctype?: string;
  dueDate?: string;
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
  default_customer?: {
    customer: string;
    customer_name: string;
  } | null;
  items?: PosCatalogueItem[];
  payment_modes: PosPaymentMode[];
  pos_profile: {
    allow_credit_sales?: boolean;
    allow_customer_payments?: boolean;
    allow_partial_payment?: boolean;
    allow_sales_order_payments?: boolean;
    auto_allocate_payment_balance?: boolean;
    currency?: string;
    currency_precision?: number;
    default_sale_type?: 'Cash Sale' | 'Credit Sale';
    name: string;
  };
};

export type PosPaymentMode = {
    default?: boolean;
    mode_of_payment: string;
    payment_gateway?: string | null;
    requires_reference?: boolean;
    type?: string | null;
};

export type PosCheckoutPreview = {
  currency?: string;
  items: PosInvoiceDetailItem[];
  loyalty_amount?: number;
  posting_date?: string;
  taxes?: PosCheckoutTax[];
  totals: {
    change_amount?: number;
    grand_total?: number;
    net_total?: number;
    outstanding_amount?: number;
    paid_amount?: number;
    rounded_total?: number;
    total_taxes_and_charges?: number;
  };
};

export type PosCheckoutTax = {
  account_head?: string;
  description?: string;
  included_in_print_rate?: boolean;
  rate?: number;
  tax_amount?: number;
};

export type PosCheckoutResult = {
  doctype: string;
  name: string;
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
  doctype?: string;
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

export type PosInvoiceDetail = {
  cashier?: string;
  closing_entry?: string;
  currency?: string;
  customer?: string;
  customer_name?: string;
  docstatus: number;
  doctype: string;
  due_date?: string;
  is_credit_sale?: boolean;
  is_return: boolean;
  items: PosInvoiceDetailItem[];
  loyalty_amount?: number;
  loyalty_points?: number;
  name: string;
  opening_entry?: string;
  payments?: PosInvoiceHistoryPayment[];
  payment_entries?: PosInvoicePaymentEntry[];
  pos_profile?: string;
  posting_date?: string;
  posting_time?: string;
  returns?: PosInvoiceReturn[];
  status: PosInvoiceStatus;
  taxes?: PosInvoiceDetailTax[];
  totals: {
    grand_total?: number;
    net_total?: number;
    outstanding_amount?: number;
    paid_amount?: number;
    rounded_total?: number;
  };
  warehouse?: string;
};

export type PosInvoiceReturn = {
  docstatus: number;
  grand_total: number;
  name: string;
  posting_date?: string | null;
};

export type PosInvoiceReturnPreview = {
  currency?: string | null;
  invoice: string;
  items: PosInvoiceReturnPreviewItem[];
};

export type PosInvoiceReturnPreviewItem = {
  item_code: string;
  item_name: string;
  rate: number;
  return_amount: number;
  returnable_qty: number;
  returned_qty: number;
  row_name: string;
  sold_qty: number;
  uom?: string | null;
};

export type PosCreatedInvoiceReturn = {
  duplicate: boolean;
  invoice: PosInvoiceDetail;
};

export type PosInvoiceDetailItem = {
  amount: number;
  batch_allocations?: PosInvoiceBatchAllocation[];
  batch_no?: string | null;
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  row_name: string;
  uom?: string;
};

export type PosInvoiceBatchAllocation = {
  batch_no: string;
  qty: number;
};

export type PosInvoiceDetailTax = {
  account_head?: string;
  description?: string;
  tax_amount?: number;
};

export type PosInvoicePaymentEntry = {
  allocated_amount: number;
  docstatus: number;
  mode_of_payment?: string | null;
  name: string;
  posting_date?: string | null;
  received_amount: number;
  unallocated_amount: number;
};

export type PosCustomerDetails = {
  address?: PosCustomerAddress | null;
  as_of: string;
  balance: number;
  contact?: PosCustomerContact | null;
  customer: PosCustomerSummary;
  loyalty: PosCustomerLoyalty | null;
};

export type PosCustomerAddress = {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  country?: string | null;
  pincode?: string | null;
  state?: string | null;
};

export type PosCustomerContact = {
  email_id?: string | null;
  mobile_no?: string | null;
  phone?: string | null;
};

export type PosCustomerLoyalty = {
  points: number;
  program?: string | null;
  tier?: string | null;
};

export type PosCustomerSummary = {
  currency?: string | null;
  customer: string;
  customer_group?: string | null;
  customer_name: string;
  customer_type?: string | null;
  email_id?: string | null;
  mobile_no?: string | null;
  tax_id?: string | null;
  territory?: string | null;
};

export type PosSaleCustomer = {
  customer: string;
  customerName: string;
};

export type PosCustomerSearchResult = PosSaleCustomer & {
  email?: string | null;
  mobile?: string | null;
};

export type PosReceivedPayment = {
  duplicate?: boolean;
  name: string;
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
