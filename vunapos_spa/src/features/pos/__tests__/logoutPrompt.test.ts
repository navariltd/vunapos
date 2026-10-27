import { describe, expect, it } from "vitest";

import { shiftCheckNeeded, shouldConfirmLogout } from "../logoutPrompt";

describe("shouldConfirmLogout", () => {
	it("asks a restaurant cashier with an open shift", () => {
		expect(shouldConfirmLogout({ posMode: "Restaurant", canTakePayment: true, shiftOpen: true })).toBe(true);
	});

	it("does not ask restaurant users who don't take payment", () => {
		expect(shouldConfirmLogout({ posMode: "Restaurant", canTakePayment: false, shiftOpen: true })).toBe(false);
		expect(shouldConfirmLogout({ posMode: "Restaurant", shiftOpen: true })).toBe(false);
	});

	it("asks any retail user with an open shift", () => {
		expect(shouldConfirmLogout({ posMode: "Retail", canTakePayment: false, shiftOpen: true })).toBe(true);
		expect(shouldConfirmLogout({ posMode: undefined, shiftOpen: true })).toBe(true);
	});

	it("never asks without an open shift", () => {
		expect(shouldConfirmLogout({ posMode: "Restaurant", canTakePayment: true, shiftOpen: false })).toBe(false);
		expect(shouldConfirmLogout({ posMode: "Retail", shiftOpen: false })).toBe(false);
	});
});

describe("shiftCheckNeeded", () => {
	it("skips the session request for restaurant users without payment rights", () => {
		expect(shiftCheckNeeded({ posMode: "Restaurant", canTakePayment: false })).toBe(false);
		expect(shiftCheckNeeded({ posMode: "Restaurant", canTakePayment: true })).toBe(true);
		expect(shiftCheckNeeded({ posMode: "Retail" })).toBe(true);
	});
});
