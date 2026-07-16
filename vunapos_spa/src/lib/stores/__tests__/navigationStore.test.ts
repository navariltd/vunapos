import { beforeEach, describe, expect, it } from "vitest";

import { useNavigationStore } from "../navigationStore";

beforeEach(() => {
	useNavigationStore.setState({ activePage: "Home" });
});

describe("navigationStore", () => {
	it("defaults to Home", () => {
		expect(useNavigationStore.getState().activePage).toBe("Home");
	});

	it("setActivePage updates the active page", () => {
		useNavigationStore.getState().setActivePage("Invoices");

		expect(useNavigationStore.getState().activePage).toBe("Invoices");
	});

	it("notifies subscribers when the page changes", () => {
		const seen: string[] = [];
		const unsubscribe = useNavigationStore.subscribe((s) => seen.push(s.activePage));

		useNavigationStore.getState().setActivePage("Payments");
		useNavigationStore.getState().setActivePage("Customers");
		unsubscribe();

		expect(seen).toEqual(["Payments", "Customers"]);
	});
});
