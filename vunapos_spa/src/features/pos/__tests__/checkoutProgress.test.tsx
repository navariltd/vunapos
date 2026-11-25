import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { CheckoutDialog } from "../components/CheckoutDialog";
import type { InvoiceDTO } from "../types";
import { useUiFeedbackStore } from "../stores/uiFeedbackStore";

const mocks = vi.hoisted(() => ({
  invoice: null as InvoiceDTO | null,
  isMutating: false,
  confirm: null as null | (() => Promise<void>),
}));
vi.mock("../stores/cartStore", () => ({
  useCartStore: (select: (value: typeof mocks) => unknown) => select(mocks),
}));
vi.mock("../hooks/useGatewayPaymentRealtime", () => ({
  useGatewayPaymentRealtime: () => {},
}));
vi.mock("../../../components/ui/Button", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../components/ui/Button")
  >();
  return {
    ...actual,
    Button: (props: ComponentProps<typeof actual.Button>) => {
      const text = renderToStaticMarkup(<>{props.children}</>);
      const handler = props.onClick;
      if (text.includes("Complete sale") && handler)
        mocks.confirm = async () => {
          await handler({} as Parameters<typeof handler>[0]);
        };
      return <actual.Button {...props} />;
    },
  };
});

function render(onConfirm: () => Promise<void>) {
  return renderToStaticMarkup(
    <CheckoutDialog
      isOpen
      modesOfPayment={[{ mode_of_payment: "Cash", default: 1 }]}
      onClose={vi.fn()}
      onClear={vi.fn()}
      onHold={vi.fn()}
      onConfirm={onConfirm}
      onPreviewLoyalty={vi.fn()}
    />
  );
}

describe("checkout progress and duplicate-click protection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.isMutating = false;
    mocks.confirm = null;
    mocks.invoice = {
      doctype: "Sales Invoice",
      name: "Draft",
      docstatus: 0,
      items: [
        {
          row_name: "row",
          item_code: "Item",
          item_name: "Item",
          qty: 1,
          rate: 100,
          amount: 100,
        },
      ],
      totals: { grand_total: 100, rounded_total: 100 },
      payments: [],
      taxes: [],
    } as unknown as InvoiceDTO;
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    useUiFeedbackStore.setState({ toast: null, toastClosing: false });
  });

  it("awaits the complete checkout callback, even after individual cart mutations end", async () => {
    let finish: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const onConfirm = vi.fn(() => waiting);
    render(onConfirm);
    expect(mocks.confirm).not.toBeNull();
    const first = mocks.confirm!();
    await mocks.confirm!();
    expect(onConfirm).toHaveBeenCalledOnce();
    finish();
    await first;
  });

  it("releases the guard and reports a rejected checkout without swallowing the next retry", async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error("Stock changed"))
      .mockResolvedValue(undefined);
    render(onConfirm);
    await mocks.confirm!();
    expect(useUiFeedbackStore.getState().toast).toMatchObject({
      type: "error",
      message: "Stock changed",
    });
    await mocks.confirm!();
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it("shows an accessible processing message on desktop and mobile", () => {
    mocks.isMutating = true;
    const html = render(vi.fn());
    expect(html).toContain('role="status"');
    expect(html).toContain("Finalising checkout… Please wait.");
    expect(html.match(/Processing…/g)).toHaveLength(2);
  });
});
