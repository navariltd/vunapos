import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { InvoiceDTO } from "../../types";
import { useUiFeedbackStore } from "../uiFeedbackStore";

function makeInvoice(overrides: Partial<InvoiceDTO> = {}): InvoiceDTO {
	return {
		doctype: "Sales Invoice",
		name: "SINV-0001",
		docstatus: 1,
		items: [],
		totals: { net_total: 100, total_taxes_and_charges: 0, grand_total: 100, rounded_total: 100 },
		...overrides,
	};
}

beforeEach(() => {
	useUiFeedbackStore.setState({ toast: null, pageError: null });
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("uiFeedbackStore", () => {
	it("showToast sets the toast", () => {
		const invoice = makeInvoice();

		useUiFeedbackStore.getState().showToast({ type: "submitted", invoice });

		expect(useUiFeedbackStore.getState().toast).toEqual({ type: "submitted", invoice });
	});

	it("auto-dismisses the toast after 5 seconds", () => {
		useUiFeedbackStore.getState().showToast({ type: "held", invoice: makeInvoice({ docstatus: 0 }) });

		vi.advanceTimersByTime(4999);
		expect(useUiFeedbackStore.getState().toast).not.toBeNull();

		vi.advanceTimersByTime(1);
		expect(useUiFeedbackStore.getState().toast).toBeNull();
	});

	it("calling showToast again resets the auto-dismiss timer instead of stacking two", () => {
		useUiFeedbackStore.getState().showToast({ type: "submitted", invoice: makeInvoice({ name: "SINV-0001" }) });

		vi.advanceTimersByTime(3000);
		useUiFeedbackStore.getState().showToast({ type: "submitted", invoice: makeInvoice({ name: "SINV-0002" }) });

		// The first toast's timer must not fire and clear the second toast early.
		vi.advanceTimersByTime(3000);
		expect(useUiFeedbackStore.getState().toast?.invoice.name).toBe("SINV-0002");

		vi.advanceTimersByTime(2000);
		expect(useUiFeedbackStore.getState().toast).toBeNull();
	});

	it("clearToast clears immediately and cancels the pending auto-dismiss", () => {
		useUiFeedbackStore.getState().showToast({ type: "submitted", invoice: makeInvoice() });

		useUiFeedbackStore.getState().clearToast();

		expect(useUiFeedbackStore.getState().toast).toBeNull();
		// No error/leak from the cancelled timer still firing later.
		vi.advanceTimersByTime(5000);
		expect(useUiFeedbackStore.getState().toast).toBeNull();
	});

	it("setPageError round-trips a message and null", () => {
		useUiFeedbackStore.getState().setPageError("Checkout failed");
		expect(useUiFeedbackStore.getState().pageError).toBe("Checkout failed");

		useUiFeedbackStore.getState().setPageError(null);
		expect(useUiFeedbackStore.getState().pageError).toBeNull();
	});
});
