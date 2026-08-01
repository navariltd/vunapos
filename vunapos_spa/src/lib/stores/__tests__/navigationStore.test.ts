import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPosPageFromPath, getPosPagePath, replacePosPage, useNavigationStore } from "../navigationStore";

beforeEach(() => {
	useNavigationStore.setState({ activePage: "Home" });
});

afterEach(() => {
	vi.unstubAllGlobals();
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

	it("maps POS pages to clean application paths", () => {
		expect(getPosPagePath("Home")).toBe("/vunapos");
		expect(getPosPagePath("Invoices")).toBe("/vunapos/invoices");
		expect(getPosPagePath("Payments")).toBe("/vunapos/payments");
		expect(getPosPagePath("Customers")).toBe("/vunapos/customers");
		expect(getPosPagePath("Close Shift")).toBe("/vunapos/close-shift");
		expect(getPosPagePath("Profile")).toBe("/vunapos/profile");
	});

	it("replaces the current history entry when returning home after opening a shift", () => {
		const replaceState = vi.fn();
		vi.stubGlobal("window", {
			history: { replaceState },
			location: { pathname: "/vunapos/close-shift" },
		});

		replacePosPage("Home");

		expect(replaceState).toHaveBeenCalledWith({ vunaposPage: "Home" }, "", "/vunapos");
		expect(useNavigationStore.getState().activePage).toBe("Home");
	});

	it("resolves application paths and tolerates a trailing slash", () => {
		expect(getPosPageFromPath("/vunapos/close-shift")).toBe("Close Shift");
		expect(getPosPageFromPath("/vunapos/profile")).toBe("Profile");
		expect(getPosPageFromPath("/vunapos/invoices/")).toBe("Invoices");
		expect(getPosPageFromPath("/vunapos/not-built-yet")).toBe("Home");
	});
});
