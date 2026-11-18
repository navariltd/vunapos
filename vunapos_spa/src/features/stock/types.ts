export type StockCapabilities = {
  can_view_requests: boolean;
  request_workflow?: string | null;
  can_request: boolean;
  can_receive: boolean;
  warehouse: string;
};
export type StockItem = {
  item_code: string;
  item_name: string;
  image?: string;
  stock_uom: string;
  sales_uom?: string;
  actual_qty: number;
  uoms: Array<{ uom: string; conversion_factor: number }>;
};
export type RequestLine = { item: StockItem; uom: string; qty: number };
export type StockResult = {
  created_in_pos?: boolean;
  received_in_pos?: boolean;
  inspection_required?: boolean;
  modified?: string;
  workflow?: {
    name: string;
    state: string;
    actions: Array<{ action: string; next_state: string }>;
  };
  is_held?: boolean;
  name: string;
  doctype: "Material Request" | "Stock Entry";
  docstatus: number;
  status?: string;
  warehouse: string;
};
export type TransitRow = {
  receipt_status: string;
  name: string;
  posting_date: string;
  from_warehouse: string;
  to_warehouse: string;
  per_transferred: number;
};
export type MaterialRequestRow = {
  workflow_enabled?: boolean;
  name: string;
  transaction_date: string;
  schedule_date: string;
  display_status: string;
  docstatus: number;
};
export type MaterialRequestDetails = {
  can_edit?: boolean;
  can_submit?: boolean;
  edit_reason?: string | null;
  transaction_date: string;
  owner: string;
  company: string;
  transfers: Array<{
    name: string;
    posting_date: string;
    per_transferred: number;
  }>;
  result: StockResult;
  required_by: string;
  notes: string;
  has_other_warehouses: boolean;
  items: Array<{
    name: string;
    item_code: string;
    item_name: string;
    qty: number;
    uom: string;
    stock_qty: number;
    stock_uom: string;
  }>;
};
export type StockEntryDetails = {
  name: string;
  posting_date: string;
  owner: string;
  company: string;
  warehouse: string;
  from_warehouse?: string;
  to_warehouse?: string;
  remarks?: string;
  status: string;
  fingerprint: string | null;
  has_other_warehouses: boolean;
  receipts: Array<{ name: string; posting_date: string; docstatus: number }>;
  items: Array<{
    conversion_factor?: number;
    partial_tracking_restricted?: boolean;
    whole_uom?: boolean;
    whole_stock_uom?: boolean;
    qty_precision?: number;
    stock_precision?: number;
    name: string;
    item_code: string;
    item_name: string;
    qty: number;
    uom: string;
    stock_qty: number;
    stock_uom: string;
    received_qty: number;
    remaining_qty: number;
    material_request: string;
    source_warehouse: string;
    transit_warehouse: string;
    batch_no?: string;
    serial_no?: string;
  }>;
};
export type ReceiptDetails = {
  inspection_messages?: string[];
  name: string;
  source: string;
  posting_date: string;
  docstatus: number;
  company: string;
  owner: string;
  warehouse: string;
  workflow?: StockResult["workflow"] | null;
  can_submit: boolean;
  blocking_reason?: string | null;
  review: string;
  has_other_warehouses: boolean;
  items: Array<{
    inspection?: {
      required: boolean;
      blocked: boolean;
      message?: string | null;
      name?: string | null;
      status: string;
      view_url?: string | null;
      create_url?: string | null;
    };
    name: string;
    item_code: string;
    item_name: string;
    qty: number;
    uom: string;
    stock_qty: number;
    stock_uom: string;
    source_warehouse: string;
    warehouse: string;
    batch_no?: string;
    serial_no?: string;
  }>;
};
export type TransitDetails = {
  name: string;
  warehouse: string;
  fingerprint: string;
  items: Array<{
    source_row: string;
    item_code: string;
    item_name: string;
    stock_qty: number;
    stock_uom: string;
    uom: string;
    conversion_factor: number;
    material_request: string;
    source_warehouse: string;
    warehouse: string;
  }>;
};
export const stockMethods = {
  capabilities: "vunapos.api.stock.capabilities",
  catalogue: "vunapos.api.stock.catalogue",
  listRequests: "vunapos.api.stock.list_requests",
  requestDetails: "vunapos.api.stock.request_details",
  requestDraft: "vunapos.api.stock.request_draft",
  submitRequest: "vunapos.api.stock.submit_request",
  scanRequestItem: "vunapos.api.stock.scan_request_item",
  requestWorkflowAction: "vunapos.api.stock.request_workflow_action",
  createRequest: "vunapos.api.stock.create_request",
  heldRequests: "vunapos.api.stock.held_requests",
  heldRequest: "vunapos.api.stock.held_request",
  listTransit: "vunapos.api.stock.list_transit",
  transitDetails: "vunapos.api.stock.transit_details",
  stockEntryDetails: "vunapos.api.stock.stock_entry_details",
  receiptDetails: "vunapos.api.stock.receipt_details",
  completeReceipt: "vunapos.api.stock.complete_receipt",
  inspectionDetails: "vunapos.api.stock.inspection_details",
  inspectionTemplates: "vunapos.api.stock.inspection_templates",
  inspectionTemplateDetails: "vunapos.api.stock.inspection_template_details",
  inspectionParameters: "vunapos.api.stock.inspection_parameters",
  saveInspection: "vunapos.api.stock.save_inspection",
  previewInspection: "vunapos.api.stock.preview_inspection",
  endTransit: "vunapos.api.stock.end_transit",
};
