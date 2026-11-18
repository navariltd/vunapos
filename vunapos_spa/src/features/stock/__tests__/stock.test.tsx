import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Header } from "../../../components/layout/Header";
import { BottomNav } from "../../../components/layout/Sidebar";
import { RequestPage, StockResultNotice } from "../RequestPage";
import { RequestCheckout } from "../RequestCheckout";
import { ItemGrid } from "../../pos/components/ItemGrid";
import { StockOperationsPage } from "../StockOperationsPage";
import {
  StockTransferItems,
  RequestDraftActions,
} from "../StockTransactionDetails";
import { ReceiptActions, ReceiptInspection } from "../StockReceiptDetails";
import { ReceiveStockDialog } from "../ReceiveStockDialog";
import {
  InspectionActions,
  InspectionFields,
  type Inspection,
} from "../QualityInspectionDialog";
import {
  inspectionPreviewKey,
  mergeInspectionPreview,
} from "../useInspectionPreview";
import {
  initialReceiptSelection,
  receiptLineState,
  receivableDrafts,
} from "../receiving";
import { stockPath, stockRoute } from "../navigation";
import {
  addRequestLine,
  clearRequestDraft,
  requestDraftScope,
  loadRequestDraft,
  newRequestDraft,
  saveRequestDraft,
} from "../requestDraft";
import {
  getPosPageFromPath,
  getPosPagePath,
} from "../../../lib/stores/navigationStore";
import type {
  StockItem,
  ReceiptDetails,
  StockEntryDetails,
  MaterialRequestDetails,
} from "../types";

vi.mock("../../../features/pos/hooks/useThemeSync", () => ({
  useThemeSync: vi.fn(),
}));
vi.mock("frappe-react-sdk", () => ({
  useFrappePostCall: () => ({ call: vi.fn() }),
}));
afterEach(() => vi.unstubAllGlobals());
const item: StockItem = {
  item_code: "A",
  item_name: "A",
  stock_uom: "Pcs",
  sales_uom: "Carton",
  actual_qty: 0,
  uoms: [
    { uom: "Pcs", conversion_factor: 1 },
    { uom: "Carton", conversion_factor: 24 },
  ],
};

describe("stock request draft", () => {
  it("does not let mixed-warehouse drafts block warehouse-scoped receiving", () => {
    const mixed = {
      name: "MIXED",
      posting_date: "2026-11-18",
      docstatus: 0,
      has_other_warehouses: true,
    };
    const own = { ...mixed, name: "OWN", has_other_warehouses: false };
    expect(receivableDrafts([mixed])).toEqual([]);
    expect(
      receivableDrafts([
        mixed,
        own,
        { ...own, name: "SUBMITTED", docstatus: 1 },
      ])
    ).toEqual([own]);
  });
  it("keeps recovery carts separate and retains the request identity when clearing items", () => {
    const draft = {
      ...newRequestDraft(),
      name: "MR-1",
      modified: "original",
      lines: [{ item, qty: 3, uom: "Pcs" }],
    };
    const cleared = clearRequestDraft(draft, true);
    expect(cleared.name).toBe("MR-1");
    expect(cleared.modified).toBe("original");
    expect(cleared.key).toBe(draft.key);
    expect(cleared.lines).toEqual([]);
    expect(clearRequestDraft(draft).name).toBeUndefined();
    expect(requestDraftScope("U", "P", "W", "MR-1")).not.toBe(
      requestDraftScope("U", "P", "W")
    );
    expect(requestDraftScope("U", "P", "W", "MR-1")).not.toBe(
      requestDraftScope("U", "P", "W", "MR-2")
    );
  });
  it("converts accepted cartons and pieces without losing the remaining stock", () => {
    const row = {
      name: "row",
      item_code: "A",
      item_name: "Milk",
      qty: 3,
      uom: "Carton",
      stock_qty: 72,
      stock_uom: "Pcs",
      received_qty: 0,
      remaining_qty: 72,
      material_request: "MR-1",
      source_warehouse: "S",
      transit_warehouse: "T",
      conversion_factor: 24,
      whole_uom: true,
      whole_stock_uom: true,
    };
    expect(initialReceiptSelection([row]).row).toEqual({
      qty: "3",
      uom: "Carton",
    });
    expect(receiptLineState(row, { qty: "2", uom: "Carton" })).toMatchObject({
      stock: 48,
      left: 24,
      error: "",
    });
    expect(receiptLineState(row, { qty: "25", uom: "Pcs" })).toMatchObject({
      stock: 25,
      left: 47,
      error: "",
    });
    expect(receiptLineState(row, { qty: "4", uom: "Carton" }).error).not.toBe(
      ""
    );
    expect(receiptLineState(row, { qty: "0", uom: "Carton" })).toMatchObject({
      stock: 0,
      left: 72,
      error: "",
    });
    expect(receiptLineState(row, { qty: "1.5", uom: "Pcs" }).error).toContain(
      "whole number"
    );
    expect(
      initialReceiptSelection([{ ...row, remaining_qty: 25 }]).row
    ).toEqual({ qty: "25", uom: "Pcs" });
    expect(
      receiptLineState(
        { ...row, partial_tracking_restricted: true },
        { qty: "1", uom: "Carton" }
      ).error
    ).toContain("exact batches or serial");
  });
  it("renders a large receiving form with editable accepted quantities and fixed actions", () => {
    const transfer: StockEntryDetails = {
      name: "STE-1",
      posting_date: "2026-11-18",
      owner: "User",
      company: "Company",
      warehouse: "W",
      status: "Awaiting receipt",
      fingerprint: "review",
      has_other_warehouses: false,
      receipts: [],
      items: [
        {
          name: "row",
          item_code: "A",
          item_name: "Milk",
          qty: 2,
          uom: "Carton",
          stock_qty: 48,
          stock_uom: "Pcs",
          received_qty: 0,
          remaining_qty: 48,
          material_request: "MR-1",
          source_warehouse: "S",
          transit_warehouse: "T",
          conversion_factor: 24,
          tracking: [{ batch_no: "BATCH-1", serial_no: null, qty: 48 }],
        },
      ],
    };
    const html = renderToStaticMarkup(
      <ReceiveStockDialog
        transfer={transfer}
        busy={false}
        online
        error=""
        onClose={vi.fn()}
        onReceive={vi.fn()}
      />
    );
    expect(html).toContain("Accepted quantity from batch BATCH-1");
    expect(html).toContain('role="dialog"');
    expect(html).toContain("max-w-6xl");
    expect(html).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(html).toContain('aria-label="Accepted quantity for Milk"');
    expect(html).toContain('aria-label="Receipt UOM for Milk"');
    expect(html).toContain("Left in transit");
    expect(html).toContain("Receive stock</button>");
  });
  it("validates exact partial batch and serial allocations in stock UOM", () => {
    const row: StockEntryDetails["items"][number] = {
      name: "row",
      item_code: "A",
      item_name: "Tracked",
      qty: 3,
      uom: "Box",
      stock_qty: 6,
      stock_uom: "Pcs",
      conversion_factor: 2,
      received_qty: 0,
      remaining_qty: 6,
      material_request: "MR",
      source_warehouse: "S",
      transit_warehouse: "T",
      partial_tracking_restricted: true,
      tracking: [
        { batch_no: "B1", serial_no: null, qty: 4 },
        { batch_no: "B2", serial_no: null, qty: 2 },
      ],
    };
    expect(initialReceiptSelection([row]).row.allocations).toEqual(
      row.tracking
    );
    expect(
      receiptLineState(row, {
        qty: "1",
        uom: "Box",
        allocations: [{ batch_no: "B2", serial_no: null, qty: 2 }],
      })
    ).toMatchObject({ stock: 2, left: 4, error: "" });
    for (const allocations of [
      [],
      [{ batch_no: "B2", serial_no: null, qty: 3 }],
      [{ batch_no: "NOT-SENT", serial_no: null, qty: 2 }],
    ]) {
      expect(
        receiptLineState(row, { qty: "2", uom: "Pcs", allocations }).error
      ).toContain("Select batches or serial");
    }
    const serial = {
      ...row,
      tracking: [{ batch_no: "B", serial_no: "SERIAL-1", qty: 1 }],
    };
    expect(
      receiptLineState(serial, {
        qty: "1",
        uom: "Pcs",
        allocations: serial.tracking,
      }).error
    ).toBe("");
    expect(
      receiptLineState(serial, {
        qty: "2",
        uom: "Pcs",
        allocations: [{ ...serial.tracking[0], qty: 2 }],
      }).error
    ).not.toBe("");
  });
  it("uses the scanned barcode UOM rather than the default sales UOM", () => {
    const rows = addRequestLine([], item, true, "Pcs");
    expect(rows[0]).toMatchObject({ uom: "Pcs", qty: 1 });
    expect(addRequestLine(rows, item, true, "Pcs")[0].qty).toBe(2);
    expect(
      addRequestLine(rows, item, true, "Carton").map((row) => row.uom)
    ).toEqual(["Carton", "Pcs"]);
  });
  it("adds unavailable stock using its configured sales UOM and profile row position", () => {
    const first = addRequestLine([], item, true);
    expect(first[0]).toMatchObject({ uom: "Carton", qty: 1 });
    expect(
      addRequestLine(first, { ...item, item_code: "B" }, true)[0].item.item_code
    ).toBe("B");
    expect(
      addRequestLine(first, { ...item, item_code: "B" }, false)[1].item
        .item_code
    ).toBe("B");
  });
  it("increments only the same item/UOM row", () => {
    const pcs = [{ item, qty: 10, uom: "Pcs" }];
    const rows = addRequestLine(pcs, item, false);
    expect(rows.map((row) => [row.uom, row.qty])).toEqual([
      ["Pcs", 10],
      ["Carton", 1],
    ]);
    expect(addRequestLine(rows, item, false).map((row) => row.qty)).toEqual([
      10, 2,
    ]);
  });
  it("keeps the request and retry key scoped to a user and profile across refresh", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => data.get(key),
      setItem: (key: string, value: string) => data.set(key, value),
    });
    const draft = {
      ...newRequestDraft(),
      lines: addRequestLine([], item, true),
    };
    saveRequestDraft("User:Profile", draft);
    expect(loadRequestDraft("User:Profile")).toEqual(draft);
    expect(loadRequestDraft("Other:Profile").lines).toEqual([]);
    expect(loadRequestDraft("User:Other").key).not.toBe(draft.key);
  });
});

describe("stock navigation and result", () => {
  it("offers draft Edit and Submit only when the server permits them", () => {
    const draft = {
      can_edit: true,
      can_submit: true,
      result: { name: "MR-1", docstatus: 0 },
    } as MaterialRequestDetails;
    const actions = (request: MaterialRequestDetails) =>
      renderToStaticMarkup(
        <RequestDraftActions
          request={request}
          disabled={false}
          onEdit={vi.fn()}
          onSubmit={vi.fn()}
        />
      );
    expect(actions(draft)).toContain(">Edit</button>");
    expect(actions(draft)).toContain("Submit Request");
    expect(actions({ ...draft, can_submit: false })).not.toContain(
      "Submit Request"
    );
    expect(actions({ ...draft, can_edit: false, can_submit: false })).toBe("");
    expect(
      actions({ ...draft, result: { ...draft.result, docstatus: 1 } })
    ).toBe("");
    expect(stockRoute(`${stockPath("requests", "MR/1")}/edit`)).toEqual({
      view: "requests",
      name: "MR/1",
      editing: true,
    });
    expect(stockRoute(`${stockPath("transfers", "STE-1")}/edit`)).toEqual({});
  });
  it("requires a saved unchanged inspection before showing submit or workflow actions", () => {
    const draft: Inspection = {
      name: null,
      modified: null,
      docstatus: 0,
      item_name: "Milk",
      sample_size: 1,
      remarks: "",
      status: "Rejected",
      manual_inspection: false,
      can_write: true,
      can_submit: true,
      readings: [],
    };
    const actions = (inspection: Inspection, dirty = false) =>
      renderToStaticMarkup(
        <InspectionActions
          inspection={inspection}
          dirty={dirty}
          disabled={false}
          previewBlocked={false}
          onSave={vi.fn()}
          onSubmit={vi.fn()}
          onWorkflow={vi.fn()}
        />
      );
    expect(actions(draft)).toContain("Save Draft");
    expect(actions(draft)).not.toContain("Submit Inspection");
    const saved = { ...draft, name: "QI-1", modified: "now" };
    expect(actions(saved)).toContain("Submit Inspection");
    expect(actions(saved)).not.toContain("Save Draft");
    expect(actions(saved, true)).toContain(">Save</button>");
    expect(actions(saved, true)).not.toContain("Submit Inspection");
    const workflow = {
      ...saved,
      can_submit: false,
      workflow: {
        state: "Draft",
        actions: [{ action: "Send for approval", next_state: "Pending" }],
      },
    };
    expect(actions(workflow)).toContain("Send for approval");
    expect(actions(workflow, true)).not.toContain("Send for approval");
    expect(actions(workflow, true)).toContain(">Save</button>");
    expect(actions({ ...saved, docstatus: 1 })).toBe("");
  });
  it("renders inspection criteria, readings and manual results inside POS", () => {
    const inspection: Inspection = {
      name: null,
      modified: null,
      docstatus: 0,
      item_name: "Milk",
      sample_size: 1,
      remarks: "",
      status: "",
      manual_inspection: false,
      can_write: true,
      can_submit: true,
      readings: [
        {
          specification: "Temperature",
          numeric: 1,
          min_value: 2,
          max_value: 8,
          manual_inspection: 0,
          formula_based_criteria: 0,
          status: "",
          values: Array(10).fill(""),
        },
      ],
    };
    const html = renderToStaticMarkup(
      <InspectionFields
        inspection={inspection}
        disabled={false}
        onChange={vi.fn()}
      />
    );
    expect(html).toContain("Temperature");
    expect(html).toContain("<table");
    expect(html).toContain("Numeric</th>");
    expect(html).not.toContain("Check type");
    expect(html).not.toContain("Expected value");
    expect(html).not.toContain("Manual result");
    expect(html).toContain("Reading Value</th>");
    expect(html).toContain("Min value</th>");
    expect(html).toContain("Max value</th>");
    expect(html).toContain("Reading 1</th>");
    expect(html).toContain("Status</th>");
    expect(html).toContain('aria-label="Temperature: Status"');
    expect(html).toContain('aria-label="Status"');
    expect(html).toContain('<option value="Accepted">Accepted</option>');
    expect(html).toMatch(/<option value="Rejected"[^>]*>Rejected<\/option>/);
    expect(html).not.toContain("Pending save");
    expect(html).not.toContain("Not checked");
    expect(html).not.toContain('option value=""');
    for (const select of html.matchAll(
      /<select[^>]*aria-label="(?:Temperature: )?Status"[^>]*>(.*?)<\/select>/g
    )) {
      expect(select[1].match(/<option /g)).toHaveLength(2);
    }
    const key = inspectionPreviewKey(inspection);
    const accepted = mergeInspectionPreview(inspection, key, {
      status: "Accepted",
      readings: ["Accepted"],
    });
    expect(accepted?.status).toBe("Accepted");
    expect(accepted?.readings[0].status).toBe("Accepted");
    expect(inspectionPreviewKey(accepted)).toBe(key);
    const changed = {
      ...inspection,
      readings: [
        { ...inspection.readings[0], values: ["9", ...Array(9).fill("")] },
      ],
    };
    expect(
      mergeInspectionPreview(changed, key, {
        status: "Accepted",
        readings: ["Accepted"],
      })
    ).toBe(changed);
    expect(html).toContain('aria-label="Temperature: Reading 1"');
    expect(html).toContain("More readings and criteria");
    expect(html).not.toContain('aria-label="Temperature: Minimum value"');
    expect(html).not.toContain("Last saved result");
    const context = {
      pos_profile: "Till",
      stock_entry: "Source",
      receipt: "Receipt",
      row_name: "Row",
    };
    const additional = renderToStaticMarkup(
      <InspectionFields
        inspection={{
          ...inspection,
          readings: [{ ...inspection.readings[0], additional: true }],
        }}
        context={context}
        disabled={false}
        onChange={vi.fn()}
      />
    );
    expect(additional).toContain("Add row");
    expect(additional).toContain('role="combobox"');
    expect(additional).toContain('placeholder="Parameter"');
    expect(additional).not.toContain("Find parameter");
    expect(additional).not.toContain("Add inspection parameter");
    expect(additional).not.toContain("Add check");
    expect(additional).toContain("Remove added check");
    expect(additional).toContain('aria-label="Temperature: Numeric"');
    expect(additional).toContain('aria-label="Quality Inspection Template"');
    expect(additional).toContain('aria-label="Temperature: Minimum value"');
    expect(additional).toContain('aria-label="Temperature: Maximum value"');
    const readonly = renderToStaticMarkup(
      <InspectionFields
        inspection={{ ...inspection, can_write: false }}
        context={context}
        disabled
        onChange={vi.fn()}
      />
    );
    expect(readonly).not.toContain("Add row");
    expect(readonly).not.toContain("Remove added check");
    const manual = renderToStaticMarkup(
      <InspectionFields
        inspection={{ ...inspection, manual_inspection: true, readings: [] }}
        disabled
        onChange={vi.fn()}
      />
    );
    expect(manual).not.toContain("Select status");
    expect(manual).not.toContain('option value=""');
    expect(manual).toContain("No inspection checks are configured");
    expect(manual).toContain("disabled");
    expect(manual).not.toContain("/desk/");
  });
  it("shows inspection status and native Create or View actions without marking inspections passed", () => {
    const html = renderToStaticMarkup(
      <ReceiptInspection
        inspection={{
          required: true,
          blocked: true,
          status: "Required",
          create_url: "/desk/quality-inspection/new?reference_name=R",
        }}
      />
    );
    expect(html).toContain("Create Inspection");
    expect(html).toContain("<button");
    expect(html).not.toContain("href=");
    expect(html).not.toContain('target="_blank"');
    const existing = renderToStaticMarkup(
      <ReceiptInspection
        inspection={{
          required: true,
          blocked: true,
          status: "Draft · Rejected",
          name: "QI-1",
          view_url: "/desk/quality-inspection/QI-1",
        }}
      />
    );
    expect(existing).toContain("View Inspection");
    expect(existing).not.toContain("Create Inspection");
    expect(existing).toContain("Rejected");
  });
  it("offers submit for a permitted draft receipt and workflow actions instead of bypassing approval", () => {
    const receipt: ReceiptDetails = {
      name: "STE-DRAFT",
      source: "STE-OUT",
      posting_date: "2026-11-18",
      docstatus: 0,
      company: "Company",
      owner: "User",
      warehouse: "W",
      can_submit: true,
      review: "stamp",
      has_other_warehouses: false,
      items: [],
    };
    expect(
      renderToStaticMarkup(
        <ReceiptActions receipt={receipt} disabled={false} onChoose={vi.fn()} />
      )
    ).toContain("Submit Receipt</button>");
    const workflow = {
      ...receipt,
      can_submit: false,
      workflow: {
        name: "Approval",
        state: "Draft",
        actions: [{ action: "Send for approval", next_state: "Pending" }],
      },
    };
    const html = renderToStaticMarkup(
      <ReceiptActions receipt={workflow} disabled={false} onChoose={vi.fn()} />
    );
    expect(html).toContain("Send for approval</button>");
    expect(html).not.toContain("Submit Receipt</button>");
    expect(
      renderToStaticMarkup(
        <ReceiptActions
          receipt={{ ...receipt, blocking_reason: "Stale quantities" }}
          disabled={false}
          onChoose={vi.fn()}
        />
      )
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <ReceiptActions
          receipt={{ ...receipt, can_submit: false }}
          disabled={false}
          onChoose={vi.fn()}
        />
      )
    ).not.toContain("Submit Receipt");
  });
  it("labels the mobile stock navigation Stock rather than End Transit", () => {
    const html = renderToStaticMarkup(
      <BottomNav features={{ allowStockReceiving: true }} />
    );
    expect(html).toContain(">Stock</span>");
    expect(html).not.toContain(">End Transit</span>");
  });
  it("does not describe a cancelled request as a draft", () => {
    const html = renderToStaticMarkup(
      <StockResultNotice
        result={{
          name: "MR-CANCELLED",
          doctype: "Material Request",
          docstatus: 2,
          warehouse: "W",
        }}
      />
    );
    expect(html).toContain("cancelled");
    expect(html).not.toContain("saved as draft");
    expect(html).not.toContain("Complete approval");
  });
  it("offers request history and End Transit as separate views", () => {
    const html = renderToStaticMarkup(
      <StockOperationsPage
        profile="P"
        warehouse="W"
        canReceive
        canViewRequests
      />
    );
    expect(html).toContain('aria-label="Stock views"');
    expect(html).toContain("Material Requests</button>");
    expect(html).toContain("Stock Entries</button>");
    expect(html).toContain("max-w-6xl");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Receipt status"');
    expect(html).toContain('<option value="received">Received</option>');
    expect(html).toContain("POS receipt history");
    expect(html).toContain("Clear filters</button>");
    expect(html).toContain("Back to POS</button>");
  });
  it("shows request history without requiring receipt permissions", () => {
    const html = renderToStaticMarkup(
      <StockOperationsPage
        profile="P"
        warehouse="W"
        canReceive={false}
        canViewRequests
      />
    );
    expect(html).toContain("Material Requests</button>");
    expect(html).not.toContain("Stock Entries</button>");
    expect(html).toContain('aria-label="Request number"');
    expect(html).not.toContain('<option value="received">');
    expect(html).not.toContain("Receive listed stock");
  });
  it("supports deep links and reloads for both stock document types", () => {
    const receiptPath = stockPath("transfers", "STE-OUT", "STE-DRAFT");
    expect(stockRoute(receiptPath)).toEqual({
      view: "transfers",
      name: "STE-OUT",
      receipt: "STE-DRAFT",
    });
    expect(getPosPageFromPath(receiptPath)).toBe("End Transit");
    expect(stockRoute(stockPath("requests", "MR/0001"))).toEqual({
      view: "requests",
      name: "MR/0001",
    });
    expect(stockRoute(stockPath("transfers", "STE-1"))).toEqual({
      view: "transfers",
      name: "STE-1",
    });
    expect(getPosPageFromPath(stockPath("transfers", "STE-1"))).toBe(
      "End Transit"
    );
    expect(getPosPageFromPath(stockPath("requests", "MR-1"))).toBe(
      "End Transit"
    );
    expect(stockRoute("/vunapos/stock-transfers/requests/%zz")).toEqual({});
  });
  it("separates sent UOM from stock quantities on transfer details", () => {
    const html = renderToStaticMarkup(
      <StockTransferItems
        canViewRequests
        items={[
          {
            name: "row1",
            item_code: "A",
            item_name: "Milk",
            qty: 2,
            uom: "Carton",
            stock_qty: 48,
            stock_uom: "Pcs",
            received_qty: 24,
            remaining_qty: 24,
            material_request: "MR-1",
            source_warehouse: "Source",
            transit_warehouse: "Transit",
          },
        ]}
      />
    );
    expect(html).toContain("Sent quantity");
    expect(html).toContain("Received");
    expect(html).toContain("Remaining");
    expect(html).toContain("2 Carton");
    expect(html).toContain("48 Pcs");
    expect(html).toContain("24 Pcs");
    expect(html).toContain(stockPath("requests", "MR-1"));
  });
  it("keeps request metadata out of the cart and presents Hold and Checkout", () => {
    const html = renderToStaticMarkup(
      <RequestPage profile="P" warehouse="W" user="U" atTop />
    );
    expect(html).toContain("Hold</button>");
    expect(html).toContain("Checkout</button>");
    expect(html).toContain("Clear Cart</button>");
    expect(html).toContain('grid grid-cols-2 gap-2" aria-label="Cart actions"');
    expect(html).toContain('class="col-span-2"><button');
    expect(html.indexOf("Hold</button>")).toBeLessThan(
      html.indexOf("Clear Cart</button>")
    );
    expect(html.indexOf("Clear Cart</button>")).toBeLessThan(
      html.indexOf("Checkout</button>")
    );
    expect(html).toContain("Cart is empty");
    expect(html).not.toContain("Requested items");
    expect(html).not.toContain("Select items to request replenishment");
    expect(html).not.toContain("Request stock</h1>");
    expect(html).not.toContain("Material Transfer");
    expect(html).not.toContain('type="date"');
    expect(html).not.toContain("textarea");
    expect(html).toContain('aria-label="Destination warehouse"');
    expect(html).toContain('readOnly=""');
    expect(html).toContain('value="W"');
    expect(html).toContain('aria-label="Search or scan barcode"');
    expect(html).toContain('aria-label="Scan with camera"');
  });
  it("shows required-by, notes, destination and item quantities only in checkout", () => {
    const draft = {
      ...newRequestDraft(),
      lines: [{ item, qty: 3, uom: "Carton" }],
    };
    const html = renderToStaticMarkup(
      <RequestCheckout
        draft={draft}
        warehouse="Store A"
        busy={false}
        disabled={false}
        error=""
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Request summary");
    expect(html).toContain("Store A");
    expect(html).toContain("3 Carton");
    expect(html).toContain("Required by");
    expect(html).toContain("Notes");
    expect(html).toContain("Submit request");
    expect(html).not.toContain("No payment is required");
    expect(html).not.toContain("If approval is needed");
  });
  it("saves workflow requests before offering a separate next action", () => {
    const html = renderToStaticMarkup(
      <RequestCheckout
        draft={newRequestDraft()}
        warehouse="W"
        workflow="Stock approval"
        busy={false}
        disabled={false}
        error=""
        onChange={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(html).toContain("Stock approval");
    expect(html).toContain("Save request</button>");
    expect(html).not.toContain("Submit request</button>");
    const result = renderToStaticMarkup(
      <StockResultNotice
        result={{
          name: "MR-1",
          doctype: "Material Request",
          docstatus: 0,
          warehouse: "W",
          workflow: {
            name: "Stock approval",
            state: "Draft",
            actions: [{ action: "Send for approval", next_state: "Pending" }],
          },
        }}
        onWorkflowAction={vi.fn()}
      />
    );
    expect(result).toContain("Send for approval</button>");
    expect(result).toContain("Workflow: <strong>Draft</strong>");
    expect(result).not.toContain("Complete approval or submission in Desk");
  });
  it("reuses sales catalogue cards without showing prices or blocking unavailable items", () => {
    const html = renderToStaticMarkup(
      <ItemGrid items={[item]} ignoreStock hidePricing onAddItem={vi.fn()} />
    );
    expect(html).toContain('aria-label="Add A"');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("0.00");
  });
  it("offers Request separately from sales-order switching", () => {
    const html = renderToStaticMarkup(
      <Header
        orderType="Material Request"
        defaultOrderType="Sales Order"
        allowOrderTypeChange={false}
        allowMaterialRequests
        onOrderTypeChange={vi.fn()}
      />
    );
    expect(html).toContain('value="Material Request"');
    expect(html).toContain('value="Sales Order"');
    expect(html).not.toContain('value="Sales Invoice"');
    expect(html).not.toContain('disabled=""');
  });
  it("does not expose Request without permission", () => {
    const html = renderToStaticMarkup(
      <Header orderType="Sales Invoice" onOrderTypeChange={vi.fn()} />
    );
    expect(html).not.toContain('value="Material Request"');
  });
  it("routes End Transit independently of sales history", () => {
    expect(getPosPagePath("End Transit")).toBe("/vunapos/stock-transfers");
    expect(getPosPageFromPath("/vunapos/stock-transfers")).toBe("End Transit");
  });
  it("does not claim a draft receipt increased warehouse stock", () => {
    const html = renderToStaticMarkup(
      <StockResultNotice
        result={{
          name: "STE-1",
          doctype: "Stock Entry",
          docstatus: 0,
          warehouse: "POS",
        }}
      />
    );
    expect(html).toContain("saved as draft");
    expect(html).toContain("Stock has not yet been received");
    expect(html).toContain("/desk/stock-entry/STE-1");
  });
});
