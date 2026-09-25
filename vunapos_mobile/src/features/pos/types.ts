export type PosOrderType = "Invoice" | "Order";

/** Tabs enabled in the native increment. The remaining shell tabs are visual only. */
export type PosNavigationTab =
  "Home" | "Invoices" | "Payments" | "Customers" | "Close Shift";

export type PosCatalogueItem = {
  actual_qty?: number | null;
  allow_negative_stock?: boolean | number | null;
  barcode?: string | null;
  image?: string | null;
  has_variants?: boolean | number | null;
  is_product_bundle?: boolean | number | null;
  is_stock_item?: boolean | number | null;
  item_code: string;
  item_name: string;
  item_tax?: {
    exclusive_tax_rate?: number | null;
    inclusive?: boolean | null;
    inclusive_tax_rate?: number | null;
  } | null;
  conversion_factor?: number | null;
  price_list_rate?: number | null;
  rate?: number | null;
  stock_uom?: string | null;
  /** The API-selected selling UOM; normally the Item's default sales UOM. */
  uom?: string | null;
  uoms?: PosItemUom[];
};

export type PosTemplateVariant = PosCatalogueItem & {
  attributes?: { attribute: string; value: string }[];
};

export type PosTemplateVariants = {
  template: {
    description?: string | null;
    item_code: string;
    item_name: string;
  };
  variants: PosTemplateVariant[];
};

export type PosProductBundle = {
  available_qty?: number | null;
  item_code: string;
  items: PosCartBundleItem[];
};

export type PosCartItem = {
  amount?: number;
  allow_negative_stock: boolean;
  available_qty: number | null;
  batch_allocations?: PosBatchAllocation[];
  bundle_items?: PosCartBundleItem[];
  /** Catalogue price before a customer-specific preview replaces it. */
  catalogue_price_list_rate?: number;
  catalogue_rate?: number;
  conversion_factor?: number;
  description?: string | null;
  discount_amount?: number;
  discount_percentage?: number;
  has_batch_no?: boolean;
  has_serial_no?: boolean;
  is_free_item?: boolean;
  is_product_bundle?: boolean;
  is_stock_item: boolean;
  item_code: string;
  item_name: string;
  item_note?: string | null;
  item_tax_template?: string | null;
  price_list_rate?: number;
  pricing_override?: PosPricingOverride;
  pricing_override_audit?: string | null;
  pricing_override_by?: string | null;
  pricing_rules?: string | string[] | null;
  qty: number;
  rate: number;
  serial_allocations?: PosSerialAllocation[];
  stock_uom?: string | null;
  uom?: string | null;
  uoms?: PosItemUom[];
  warehouse?: string | null;
};

export type PosPricingOverride = {
  type: "discount_amount" | "discount_percentage" | "rate";
  value: number;
};

/** A unit permitted by the Item record. Frappe remains authoritative for its rate and stock conversion. */
export type PosItemUom = {
  conversion_factor: number;
  rate?: number | null;
  uom: string;
};

export type PosBatchAllocation = {
  available_qty?: number | null;
  batch_no: string;
  expiry_date?: string | null;
  qty: number;
};

export type PosItemBatches = {
  batches: PosBatchAllocation[];
  item_code: string;
  requires_batch?: boolean;
  requires_serial?: boolean;
  serials?: PosSerialAllocation[];
  warehouse?: string | null;
};

export type PosSerialAllocation = {
  batch_no?: string | null;
  serial_no: string;
};

export type PosCartBundleItem = {
  available_qty?: number | null;
  item_code: string;
  item_name?: string | null;
  qty?: number | null;
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

/** The server draft behind a restored cart. It must be submitted, not recreated. */
export type PosCartSource = { doctype: string; name: string };

export type PosRestoredInvoice = PosCartData & {
  customer?: string;
  customer_name?: string;
  selling_price_list?: string;
  source: PosCartSource;
};

export type PosHeldInvoice = {
  currency?: string | null;
  customer?: string | null;
  customer_name?: string | null;
  doctype: string;
  grand_total?: number | null;
  modified?: string | null;
  name: string;
  posting_date?: string | null;
  rounded_total?: number | null;
  total?: number | null;
};

export type PosInvoiceStatus =
  | "Cancelled"
  | "Credit Note"
  | "Draft"
  | "Overdue"
  | "Paid"
  | "Partly Paid"
  | "Unpaid";

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

export type PosDefaultCustomer = {
  customer: string;
  customer_name: string;
  default_price_list?: string | null;
  is_walkin?: boolean | number;
  mobile_no?: string | null;
  tax_id?: string | null;
};

export type PosBootstrapData = {
  /**
   * Normalized client field. The Frappe response nests this under
   * `pos_profile.default_customer`; `usePosBootstrap` lifts it here so the
   * workspace has one stable shape, including old cached responses.
   */
  default_customer?: PosDefaultCustomer | null;
  items?: PosCatalogueItem[];
  payment_modes: PosPaymentMode[];
  pos_session?: PosSession;
  pos_profile: {
    allow_credit_sales?: boolean;
    allow_customer_creation?: boolean;
    allow_customer_management?: boolean;
    allow_customer_payments?: boolean;
    allow_payment_history?: boolean;
    allow_payment_reconciliation?: boolean;
    allow_delivery_charge_change?: boolean;
    allow_delivery_charges?: boolean;
    allow_order_type_change?: boolean;
    allow_partial_payment?: boolean;
    allow_price_list_switching?: boolean;
    allow_discount_change?: boolean;
    allow_rate_change?: boolean;
    allow_sales_order_payments?: boolean;
    auto_allocate_payment_balance?: boolean;
    automatically_add_filtered_item_to_cart?: boolean;
    checkout_fields?: PosCheckoutFieldDefinition[];
    currency?: string;
    currency_precision?: number;
    delivery_charge_item?: string | null;
    default_sale_type?: "Cash Sale" | "Credit Sale";
    default_order_type?: "Sales Invoice" | "Sales Order";
    default_customer?: PosDefaultCustomer | string | null;
    modes_of_payment?: PosPaymentMode[];
    name: string;
    price_list?: string | null;
    allowed_price_lists?: PosPriceList[];
    enable_salesperson_pin?: boolean;
    hide_images?: boolean;
    hide_unavailable_items?: boolean;
    invoice_mode?: "POS Invoice" | "Sales Invoice";
    pin_users?: PosPinUser[];
    require_pin_before_every_sale?: boolean;
    require_manager_pin_item_removal?: boolean;
    salesperson_pin_session_minutes?: number;
    workflow?: PosWorkflowMetadata;
  };
};

export type PosWorkflowTransition = {
  action: string;
  allowed?: string;
  next_state: string;
  state?: string;
};

export type PosWorkflowMetadata = {
  enabled: boolean;
  workflows: Record<
    string,
    {
      name: string;
      state_field: string;
      transitions: PosWorkflowTransition[];
    }
  >;
};

/** A server-approved transaction field that VunaPOS may collect at checkout. */
export type PosCheckoutFieldDefinition = {
  doctype: "POS Invoice" | "Sales Invoice" | "Sales Order";
  fieldname: string;
  fieldtype: string;
  help_text?: string | null;
  label: string;
  options?: string | null;
  order?: number;
  placeholder?: string | null;
  required?: boolean;
};

export type PosSession = {
  closing_entry?: string | null;
  has_opening_entry: boolean;
  opening_entry?: string | null;
  ready: boolean;
  status?: "CLOSING" | "CLOSING_FAILED" | "OPEN" | "OPENING_REQUIRED";
};

export type PosPriceList = { currency?: string | null; name: string };

export type PosPinUser = {
  display_name?: string | null;
  role: "Manager" | "Salesperson";
  sales_person: string;
};

export type PosSalespersonSession = {
  displayName: string;
  expiresAt: number;
  name: string;
  token: string;
};

export type PosPaymentMode = {
  default?: boolean;
  mode_of_payment: string;
  payment_gateway?: string | null;
  requires_reference?: boolean;
  type?: string | null;
};

export type PosGatewayPaymentLink = {
  amount: number;
  currency?: string;
  mode_of_payment: string;
  name: string;
  status:
    | "Authorized"
    | "Cancelled"
    | "Draft"
    | "Expired"
    | "Failed"
    | "Paid"
    | "Pending"
    | string;
};

export type PosCustomerContactPhone = {
  customer: string;
  mobile_no?: string | null;
  source?: "Customer" | "Contact" | null;
};

export type PosC2BGatewayPayment = {
  amount: number;
  currency?: string | null;
  name: string;
  party_name?: string | null;
  party_phone?: string | null;
  transaction_id: string;
};

export type PosCheckoutPreview = {
  currency?: string;
  items: PosInvoiceDetailItem[];
  loyalty_amount?: number;
  loyalty_points?: number;
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
  docstatus?: number;
  doctype: string;
  name: string;
  queue_status?: string | null;
};

export type PosInvoiceHistoryFilters = {
  currentShift: boolean;
  customer: string;
  documentType: "Invoice" | "Order" | "Draft Order";
  fromDate: string;
  invoice: string;
  paymentMode: string;
  saleType: "" | "Cash Sale" | "Credit Sale";
  status: "" | PosInvoiceStatus;
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
  workflow_state?: string | null;
  can_edit?: boolean;
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
  invoices?: PosCustomerInvoice[];
  loyalty: PosCustomerLoyalty | null;
  payments?: PosCustomerPayment[];
};

export type PosCustomerInvoice = {
  currency?: string | null;
  doctype?: string;
  due_date?: string | null;
  grand_total: number;
  is_return: boolean;
  name: string;
  outstanding_amount: number;
  paid_amount?: number;
  posting_date?: string | null;
  return_against?: string | null;
  status?: string;
};

export type PosCustomerPayment = {
  mode_of_payment?: string | null;
  name: string;
  paid_amount?: number;
  posting_date?: string | null;
  received_amount: number;
  unallocated_amount: number;
};

export type PosCustomerAddress = {
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  country?: string | null;
  pincode?: string | null;
  state?: string | null;
};

/** A permitted ERPNext Address that can be applied as a transaction shipping address. */
export type PosCustomerShippingAddress = PosCustomerAddress & {
  address_title?: string | null;
  formatted_address?: string | null;
  is_default?: boolean;
  name: string;
};

export type PosCustomerContact = {
  email_id?: string | null;
  mobile_no?: string | null;
  phone?: string | null;
};

export type PosCustomerLoyalty = {
  conversion_factor?: number;
  currency?: string | null;
  enrolled?: boolean;
  points: number;
  program?: string | null;
  redemption_value?: number;
  tier?: string | null;
};

export type PosCustomerSummary = {
  currency?: string | null;
  customer: string;
  customer_group?: string | null;
  customer_name: string;
  customer_type?: string | null;
  email_id?: string | null;
  is_walkin?: boolean;
  mobile_no?: string | null;
  tax_id?: string | null;
  territory?: string | null;
};

export type PosCustomerDirectoryRow = PosCustomerSummary & {
  invoice_count?: number | null;
  last_purchase_date?: string | null;
  loyalty_points?: number | null;
  outstanding_balance?: number | null;
};

export type PosCustomerDirectory = {
  as_of: string;
  customer_groups: string[];
  customers: PosCustomerDirectoryRow[];
  financials_visible: boolean;
  limit: number;
  loyalty_visible: boolean;
  start: number;
  territories: string[];
  total_count: number;
};

export type PosCustomerDirectoryFilters = {
  customerGroup: string;
  customerType: "" | "Company" | "Individual";
  territory: string;
};

export type PosSaleCustomer = {
  customer: string;
  customerName: string;
  defaultPriceList?: string | null;
  isWalkin?: boolean;
  mobile?: string | null;
  taxId?: string | null;
};

export type PosCustomerSearchResult = PosSaleCustomer & {
  email?: string | null;
  mobile?: string | null;
};

export type PosReceivedPayment = {
  duplicate?: boolean;
  name: string;
};

export type PosPaymentReconciliationCandidate = {
  amount: number;
  currency?: string | null;
  name: string;
  outstanding_amount?: number;
  posting_date: string;
  remarks?: string | null;
};

export type PosPaymentReconciliationCandidates = {
  invoices: PosPaymentReconciliationCandidate[];
  payments: PosPaymentReconciliationCandidate[];
};

export type PosPaymentReconciliationAllocation = {
  allocated_amount: number;
  currency?: string | null;
  invoice: string;
  payment_entry: string;
};

export type PosPaymentHistoryReference = {
  allocated_amount: number;
  reference_doctype: string;
  reference_name: string;
};

export type PosPaymentHistoryRow = {
  allocated_amount: number;
  cashier?: string | null;
  closing_entry?: string | null;
  customer: string;
  customer_name?: string | null;
  gateway_links?: {
    name: string;
    source_doctype: string;
    source_name: string;
    status: string;
    transaction_reference?: string | null;
  }[];
  mode_of_payment?: string | null;
  name: string;
  posting_date: string;
  received_amount: number;
  reference_no?: string | null;
  references: PosPaymentHistoryReference[];
  remarks?: string | null;
  status: "Cancelled" | "Submitted";
  unallocated_amount: number;
};

export type PosPaymentHistory = {
  payments: PosPaymentHistoryRow[];
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

export type PosClosingPreviewPayment = {
  closing_amount: number;
  difference: number;
  expected_amount: number;
  mode_of_payment: string;
  opening_amount: number;
};

/** Server-calculated payment activity for the active POS opening session. */
export type PosClosingPaymentActivity = {
  cash_received: number;
  credit_outstanding: number;
  credit_sales: number;
  customer_advances: number;
  outstanding_invoice_payments: number;
  reconciled_existing_credits: number;
  sales_collected: number;
};

export type PosClosingPreviewInvoice = {
  customer?: string | null;
  doctype: string;
  grand_total: number;
  is_return: boolean;
  name: string;
  posting_date?: string | null;
  posting_time?: string | null;
};

export type PosClosingPreview = {
  cashier: string;
  grand_total: number;
  invoice_count: number;
  invoices?: PosClosingPreviewInvoice[];
  net_total: number;
  opening_entry: string;
  payment_activity?: PosClosingPaymentActivity;
  payments: PosClosingPreviewPayment[];
  period_end_date: string;
  period_start_date: string;
  pos_profile: string;
};

export type PosCloseShiftResult = {
  name: string;
  session: PosSession;
  status?: string;
};
