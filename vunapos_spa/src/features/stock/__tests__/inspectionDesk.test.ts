/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, it, expect, vi } from "vitest";

const bridge = readFileSync(
  new URL(
    "../../../../../vunapos/public/js/receipt_inspection_context.js",
    import.meta.url
  ),
  "utf8"
);
const script = readFileSync(
  new URL(
    "../../../../../vunapos/public/js/quality_inspection.js",
    import.meta.url
  ),
  "utf8"
);
describe("receipt inspection Desk bridge", () => {
  it("preserves the exact receipt row through native new-document routing without recording a result", async () => {
    const location = {
      pathname: "/desk/quality-inspection/new",
      search:
        "?vunapos_profile=P&vunapos_source=S&vunapos_receipt=R&vunapos_row=row-2",
    };
    const win = { location };
    const defaults = {
      reference_type: "Stock Entry",
      reference_name: "R",
      item_code: "A",
      child_row_reference: "row-2",
    };
    let handlers: { onload: (frm: unknown) => Promise<void> } | undefined;
    const frappe = {
      ui: {
        form: {
          on: (_name: string, value: typeof handlers) => {
            handlers = value;
          },
        },
      },
      call: vi
        .fn()
        .mockResolvedValue({ message: { ok: true, data: { defaults } } }),
      set_route: vi.fn(),
      msgprint: vi.fn(),
    };
    const context = {
      window: win,
      URLSearchParams,
      frappe,
      __: (value: string) => value,
    };
    runInNewContext(bridge, context);
    location.search = "";
    runInNewContext(script, context);
    const frm = {
      is_new: () => true,
      doc: { reference_type: "Stock Entry", reference_name: "R" },
      disable_save: vi.fn(),
      enable_save: vi.fn(),
      set_value: vi.fn().mockResolvedValue(undefined),
    };
    await handlers?.onload(frm);
    expect(frappe.call.mock.calls[0][0].args.row_name).toBe("row-2");
    expect(frm.set_value).toHaveBeenCalledWith(defaults);
    expect(frm.enable_save).toHaveBeenCalled();
    expect(frm.set_value.mock.calls[0][0]).not.toHaveProperty("status");
    expect(frm.set_value.mock.calls[0][0]).not.toHaveProperty("readings");
  });
});
