import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { InvoiceDetailsPage } from "../components/InvoiceDetailsPage";
import { vunaMethods } from "../../../services/vunaApi";

const mocks = vi.hoisted(() => ({
  details: {} as Record<string, unknown>,
  bootstrap: {
    pos_profile: "Counter 1",
    print_format: "Counter Receipt" as string | null | undefined,
  },
  profileLoading: false,
  render: vi.fn(),
  print: null as null | (() => Promise<void>),
}));

vi.mock("../hooks/useBootstrapData", () => ({
  useBootstrapData: () => ({
    data: mocks.bootstrap,
    isLoading: mocks.profileLoading,
  }),
}));

vi.mock("frappe-react-sdk", () => ({
  useFrappeGetCall: (method: string) => ({
    data:
      method === vunaMethods.getInvoiceDetails
        ? { message: { ok: true, data: mocks.details } }
        : undefined,
  }),
  useFrappePostCall: () => ({ call: mocks.render }),
}));
vi.mock("../../../components/ui/Button", () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => Promise<void>;
  }) => {
    const content = Array.isArray(children) ? children : [children];
    if (
      content.some(
        (child) => typeof child === "string" && child.trim() === "Print receipt"
      )
    )
      mocks.print = onClick || null;
    return (
      <button type="button" onClick={onClick}>
        {children}
      </button>
    );
  },
}));

describe("invoice detail receipt printing", () => {
  const frame = {
    opener: {},
    document: { write: vi.fn(), close: vi.fn() },
    focus: vi.fn(),
    print: vi.fn(),
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.print = null;
    mocks.bootstrap = {
      pos_profile: "Counter 1",
      print_format: "Counter Receipt",
    };
    mocks.profileLoading = false;
    mocks.details = {
      doctype: "Sales Invoice",
      name: "SINV-1",
      docstatus: 1,
      status: "Paid",
      customer: "Guest",
      items: [],
      payments: [],
      taxes: [],
      returns: [],
      payment_entries: [],
      totals: { grand_total: 100, paid_amount: 100, outstanding_amount: 0 },
    };
    mocks.render.mockResolvedValue({
      message: { ok: true, data: { html: "<p>Profile receipt</p>" } },
    });
    vi.stubGlobal("window", { open: vi.fn(() => frame) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["Sales Invoice", "POS Invoice", "Sales Order"])(
    "passes the active POS Profile format when reprinting a %s",
    async (doctype) => {
      mocks.details.doctype = doctype;
      renderToStaticMarkup(
        <InvoiceDetailsPage
          invoice="SINV-1"
          invoiceDoctype={doctype}
          posProfile="Counter 1"
          isOnline
          onStartSale={() => {}}
        />
      );
      expect(mocks.print, vunaMethods.getInvoiceDetails).not.toBeNull();
      await mocks.print!();
      expect(mocks.render).toHaveBeenCalledExactlyOnceWith({
        invoice_doctype: doctype,
        invoice_name: "SINV-1",
        print_format: "Counter Receipt",
      });
      expect(frame.document.write).toHaveBeenCalledWith(
        "<p>Profile receipt</p>"
      );
      expect(frame.print).toHaveBeenCalledOnce();
    }
  );

  it.each([undefined, null, ""])(
    "preserves the server fallback when the profile format is %s",
    async (printFormat) => {
      mocks.bootstrap.print_format = printFormat;
      renderToStaticMarkup(
        <InvoiceDetailsPage
          invoice="SINV-1"
          posProfile="Counter 1"
          isOnline
          onStartSale={() => {}}
        />
      );
      expect(mocks.print).not.toBeNull();
      await mocks.print!();
      expect(mocks.render).toHaveBeenCalledExactlyOnceWith({
        invoice_doctype: "Sales Invoice",
        invoice_name: "SINV-1",
        print_format: undefined,
      });
    }
  );

  it("waits for the active profile instead of printing with a premature fallback", async () => {
    mocks.profileLoading = true;
    renderToStaticMarkup(
      <InvoiceDetailsPage
        invoice="SINV-1"
        posProfile="Counter 1"
        isOnline
        onStartSale={() => {}}
      />
    );
    expect(mocks.print).not.toBeNull();
    await mocks.print!();
    expect(mocks.render).not.toHaveBeenCalled();
    expect(frame.print).not.toHaveBeenCalled();
  });

  it("does not apply another profile's cached print format", async () => {
    mocks.bootstrap.pos_profile = "Other Counter";
    renderToStaticMarkup(
      <InvoiceDetailsPage
        invoice="SINV-1"
        posProfile="Counter 1"
        isOnline
        onStartSale={() => {}}
      />
    );
    await mocks.print!();
    expect(mocks.render).toHaveBeenCalledWith(
      expect.objectContaining({ print_format: undefined })
    );
  });
});
