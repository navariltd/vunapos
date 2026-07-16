import { beforeEach, describe, expect, it } from "vitest";

import { normalizeServerTheme, resolveTheme, useThemeStore } from "../themeStore";

describe("resolveTheme (pure)", () => {
	it("resolves light/dark modes to themselves regardless of OS preference", () => {
		expect(resolveTheme("light", true)).toBe("light");
		expect(resolveTheme("dark", false)).toBe("dark");
	});

	it("resolves automatic against the OS preference", () => {
		expect(resolveTheme("automatic", true)).toBe("dark");
		expect(resolveTheme("automatic", false)).toBe("light");
	});
});

describe("normalizeServerTheme (pure)", () => {
	it("lowercases a recognized desk_theme value", () => {
		expect(normalizeServerTheme("Dark")).toBe("dark");
		expect(normalizeServerTheme("Automatic")).toBe("automatic");
		expect(normalizeServerTheme("Light")).toBe("light");
	});

	it("falls back to light for null/undefined/unrecognized values - matches desk's own bootinfo fallback", () => {
		expect(normalizeServerTheme(null)).toBe("light");
		expect(normalizeServerTheme(undefined)).toBe("light");
		expect(normalizeServerTheme("")).toBe("light");
		expect(normalizeServerTheme("Solarized")).toBe("light");
	});
});

describe("useThemeStore", () => {
	beforeEach(() => {
		useThemeStore.setState({ mode: "light", resolved: "light" });
	});

	it("defaults to light/light - this test suite runs in a plain Node environment with no window", () => {
		expect(useThemeStore.getState().mode).toBe("light");
		expect(useThemeStore.getState().resolved).toBe("light");
	});

	it("setMode updates both mode and resolved", () => {
		useThemeStore.getState().setMode("dark");

		expect(useThemeStore.getState().mode).toBe("dark");
		expect(useThemeStore.getState().resolved).toBe("dark");
	});

	it("setMode('automatic') resolves to light when there's no window.matchMedia to consult", () => {
		useThemeStore.getState().setMode("automatic");

		expect(useThemeStore.getState().mode).toBe("automatic");
		expect(useThemeStore.getState().resolved).toBe("light");
	});

	it("syncFromServer applies a differing server value", () => {
		useThemeStore.getState().syncFromServer("Dark");

		expect(useThemeStore.getState().mode).toBe("dark");
		expect(useThemeStore.getState().resolved).toBe("dark");
	});

	it("syncFromServer is a no-op when the server value already matches - no redundant state change", () => {
		useThemeStore.getState().setMode("dark");
		const before = useThemeStore.getState();

		useThemeStore.getState().syncFromServer("Dark");

		expect(useThemeStore.getState()).toBe(before);
	});

	it("syncFromServer treats a missing/never-set desk_theme as light", () => {
		useThemeStore.getState().setMode("dark");

		useThemeStore.getState().syncFromServer(null);

		expect(useThemeStore.getState().mode).toBe("light");
	});
});
