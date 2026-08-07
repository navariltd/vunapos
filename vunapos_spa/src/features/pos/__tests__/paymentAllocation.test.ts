import { describe, expect, it } from "vitest";

import {
	allocateAllToMode,
	allocatePaymentRemainderToNextMode,
	buildPaymentInputs,
	canCompletePaymentAllocation,
	calculatePaymentAllocation,
	createInitialPaymentAmounts,
	minorUnitsToInput,
	parsePaymentAmount,
	totalToMinorUnits,
} from "../paymentAllocation";
import type { ModeOfPaymentDTO } from "../types";

const modes: ModeOfPaymentDTO[] = [
	{ mode_of_payment: "Cash", default: 1, type: "Cash" },
	{ mode_of_payment: "M-Pesa", type: "Phone" },
	{ mode_of_payment: "Card", type: "Bank" },
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

	it("allocates the remaining balance to the next manual mode", () => {
		expect(
			allocatePaymentRemainderToNextMode(
				modes,
				{ Cash: "500", "M-Pesa": "", Card: "" },
				"Cash",
				150000,
				2,
			),
		).toEqual({ Cash: "500", "M-Pesa": "1000.00", Card: "" });
	});

	it("skips gateway modes when finding the next automatic allocation target", () => {
		const gatewayModes: ModeOfPaymentDTO[] = [
			{ mode_of_payment: "Cash", default: 1, type: "Cash" },
			{ mode_of_payment: "M-Pesa", type: "Phone", payment_gateway: "Mpesa-Test" },
			{ mode_of_payment: "Card", type: "Bank" },
		];
		expect(
			allocatePaymentRemainderToNextMode(
				gatewayModes,
				{ Cash: "500", "M-Pesa": "", Card: "" },
				"Cash",
				150000,
				2,
			),
		).toEqual({ Cash: "500", "M-Pesa": "", Card: "1000.00" });
	});

	it("does not allocate gateway modes initially but allows explicit all allocation", () => {
		const gatewayModes: ModeOfPaymentDTO[] = [
			{ mode_of_payment: "M-Pesa", default: 1, type: "Phone", payment_gateway: "Mpesa-Test" },
			{ mode_of_payment: "Cash", type: "Cash" },
		];
		expect(createInitialPaymentAmounts(gatewayModes, 150000, 2)).toEqual({
			"M-Pesa": "",
			Cash: "1500.00",
		});
		expect(allocateAllToMode(gatewayModes, "M-Pesa", 150000, 2)).toEqual({
			"M-Pesa": "1500.00",
			Cash: "",
		});
	});

	it("calculates exact split, underpayment, and overpayment in minor units", () => {
		expect(
			calculatePaymentAllocation(modes, { Cash: "500", "M-Pesa": "1000.00", Card: "" }, 150000, 2),
		).toEqual({
			allocatedMinor: 150000,
			cashMinor: 50000,
			nonCashMinor: 100000,
			remainingMinor: 0,
			hasInvalidAmount: false,
		});
		expect(calculatePaymentAllocation(modes, { Cash: "500", "M-Pesa": "900", Card: "" }, 150000, 2))
			.toMatchObject({ remainingMinor: 10000 });
		expect(calculatePaymentAllocation(modes, { Cash: "500", "M-Pesa": "1100", Card: "" }, 150000, 2))
			.toMatchObject({ remainingMinor: -10000 });
	});

	it("allows cash change but prevents electronic overpayment", () => {
		const cashChange = calculatePaymentAllocation(modes, { Cash: "700", "M-Pesa": "0", Card: "0" }, 65400, 2);
		expect(cashChange.remainingMinor).toBe(-4600);
		expect(canCompletePaymentAllocation(cashChange, 65400, false)).toBe(true);

		const electronicOverpayment = calculatePaymentAllocation(
			modes,
			{ Cash: "0", "M-Pesa": "700", Card: "0" },
			65400,
			2,
		);
		expect(canCompletePaymentAllocation(electronicOverpayment, 65400, false)).toBe(false);
	});

	it("allows underpayment only when partial payment is enabled", () => {
		const partial = calculatePaymentAllocation(modes, { Cash: "500", "M-Pesa": "0", Card: "0" }, 65400, 2);
		expect(canCompletePaymentAllocation(partial, 65400, false)).toBe(false);
		expect(canCompletePaymentAllocation(partial, 65400, true)).toBe(true);
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
