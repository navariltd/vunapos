import { describe, expect, it } from "vitest";

import { hasValidSessionCookie, shouldRedirectToLogin } from "../authGuard";

describe("hasValidSessionCookie", () => {
	it("is true when a non-Guest user_id cookie is present", () => {
		expect(hasValidSessionCookie("sid=abc; user_id=eammon%40example.com; full_name=Eammon")).toBe(true);
	});

	it("is false when there is no user_id cookie at all", () => {
		expect(hasValidSessionCookie("sid=abc; full_name=Eammon")).toBe(false);
	});

	it("is false when user_id is explicitly Guest", () => {
		expect(hasValidSessionCookie("sid=guest; user_id=Guest")).toBe(false);
	});

	it("is false for an empty cookie string", () => {
		expect(hasValidSessionCookie("")).toBe(false);
	});

	it("handles a user_id cookie with no other cookies present", () => {
		expect(hasValidSessionCookie("user_id=eammon%40example.com")).toBe(true);
	});
});

describe("shouldRedirectToLogin", () => {
	it("never redirects while still loading", () => {
		expect(
			shouldRedirectToLogin({ isLoading: true, isGuest: true, error: new Error("boom"), hasSessionCookie: false }),
		).toBe(false);
	});

	it("does not redirect a confirmed, healthy session", () => {
		expect(shouldRedirectToLogin({ isLoading: false, isGuest: false, error: null, hasSessionCookie: true })).toBe(
			false,
		);
	});

	it("redirects when the server authoritatively rejects the session (real HTTP error)", () => {
		const serverError = { httpStatus: 403, message: "Not permitted" };
		expect(
			shouldRedirectToLogin({ isLoading: false, isGuest: true, error: serverError, hasSessionCookie: true }),
		).toBe(true);
	});

	it("redirects when guest and the server rejects, even with a stale-looking cookie", () => {
		const serverError = { httpStatus: 401, message: "Unauthorized" };
		expect(
			shouldRedirectToLogin({ isLoading: false, isGuest: true, error: serverError, hasSessionCookie: true }),
		).toBe(true);
	});

	// Locks in the bug: DevTools "Offline" throttling can block requests without
	// flipping navigator.onLine, and getLoggedInUser() throws a raw TypeError (no
	// httpStatus) instead of a real HTTP error - a valid session must survive that.
	it("does NOT redirect on a network-level failure (no httpStatus) when a session cookie is present", () => {
		const networkError = new TypeError("Cannot read properties of undefined (reading 'data')");
		expect(
			shouldRedirectToLogin({ isLoading: false, isGuest: true, error: networkError, hasSessionCookie: true }),
		).toBe(false);
	});

	it("does NOT redirect when the auth check simply hasn't been confirmed yet but a session cookie exists", () => {
		expect(
			shouldRedirectToLogin({ isLoading: false, isGuest: true, error: undefined, hasSessionCookie: true }),
		).toBe(false);
	});

	it("redirects on a network-level failure when there is no session cookie either", () => {
		const networkError = new TypeError("Failed to fetch");
		expect(
			shouldRedirectToLogin({ isLoading: false, isGuest: true, error: networkError, hasSessionCookie: false }),
		).toBe(true);
	});

	it("redirects a genuine first-time guest with no cookie and no error", () => {
		expect(
			shouldRedirectToLogin({ isLoading: false, isGuest: true, error: undefined, hasSessionCookie: false }),
		).toBe(true);
	});
});
