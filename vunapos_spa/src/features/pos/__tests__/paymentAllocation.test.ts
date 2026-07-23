import { describe, expect, it } from "vitest";

import {
	allocateAllToMode,
	buildPaymentInputs,
	calculatePaymentAllocation,
	createInitialPaymentAmounts,
	minorUnitsToInput,
	parsePaymentAmount,
	totalToMinorUnits,
} from "../paymentAllocation";
import type { ModeOfPaymentDTO } from "../types";

const modes: ModeOfPaymentDTO[] = [
	{ mode_of_payment: "Cash", default: 1 },
	{ mode_of_payment: "M-Pesa" },
	{ mode_of_payment: "Card" },
];

describe("payment allocation", () => {
	it("allocates the full total to the default mode initially", () => {
		expect(createInitialPaymentAmounts(modes, 150000, 2)).toEqual({
			Cash: "1500.00",
			"M-Pesa": "",
			Card: "",
		});
	});

	it("falls back to the first configured mode when there is no default", () => {
		const withoutDefault = modes.map((mode) => ({ ...mode, default: false }));
		expect(createInitialPaymentAmounts(withoutDefault, 150000, 2).Cash).toBe("1500.00");
	});

	it("moves the full allocation to the selected mode", () => {
		expect(allocateAllToMode(modes, "M-Pesa", 150000, 2)).toEqual({
			Cash: "",
			"M-Pesa": "1500.00",
			Card: "",
		});
	});

	it("calculates exact split, underpayment, and overpayment in minor units", () => {
		expect(
			calculatePaymentAllocation(modes, { Cash: "500", "M-Pesa": "1000.00", Card: "" }, 150000, 2),
		).toEqual({ allocatedMinor: 150000, remainingMinor: 0, hasInvalidAmount: false });
		expect(calculatePaymentAllocation(modes, { Cash: "500", "M-Pesa": "900", Card: "" }, 150000, 2))
			.toMatchObject({ remainingMinor: 10000 });
		expect(calculatePaymentAllocation(modes, { Cash: "500", "M-Pesa": "1100", Card: "" }, 150000, 2))
			.toMatchObject({ remainingMinor: -10000 });
	});

	it("rejects negative, exponent, excessive precision, and unsafe values", () => {
		expect(parsePaymentAmount("-1", 2)).toBeNull();
		expect(parsePaymentAmount("1e3", 2)).toBeNull();
		expect(parsePaymentAmount("10.001", 2)).toBeNull();
		expect(parsePaymentAmount("999999999999999999", 2)).toBeNull();
	});

	it("builds payload rows only for positive allocations", () => {
		expect(buildPaymentInputs(modes, { Cash: "500.00", "M-Pesa": "1000", Card: "0" }, 2)).toEqual([
			{ mode_of_payment: "Cash", amount: 500 },
			{ mode_of_payment: "M-Pesa", amount: 1000 },
		]);
	});

	it("supports currencies with zero and three decimal places", () => {
		expect(totalToMinorUnits(10.5, 0)).toBe(11);
		expect(minorUnitsToInput(11, 0)).toBe("11");
		expect(totalToMinorUnits(10.555, 3)).toBe(10555);
		expect(minorUnitsToInput(10555, 3)).toBe("10.555");
	});
});
