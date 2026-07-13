// `user_id` is a non-httpOnly cookie Frappe sets so client JS can read login state
// without a network round trip; frappe-react-sdk uses it internally (getLoggedInUser())
// but never exposes the parsed value, so we read it directly here.
export function hasValidSessionCookie(
	cookieString: string = typeof document !== "undefined" ? document.cookie : "",
): boolean {
	const match = cookieString.split(";").find((part) => part.trim().startsWith("user_id="));
	if (!match) {
		return false;
	}
	const value = decodeURIComponent(match.split("=").slice(1).join("=").trim());
	return Boolean(value) && value !== "Guest";
}

// A real HTTP response (401/403, marked by httpStatus) is authoritative proof of an
// invalid session. Anything else isn't: frappe-react-sdk's getLoggedInUser()
// unconditionally reads err.response.data in its catch handler, so a pure network
// failure throws a plain TypeError with no httpStatus rather than a structured HTTP
// error - "no httpStatus" means "couldn't reach the server," not "server said no."
function isServerConfirmedAuthError(error: unknown): boolean {
	return Boolean(error && typeof error === "object" && "httpStatus" in error);
}

/** Pure decision logic, exported for direct unit testing (no DOM/React needed). */
export function shouldRedirectToLogin(input: {
	isLoading: boolean;
	isGuest: boolean;
	error: unknown;
	hasSessionCookie: boolean;
}): boolean {
	if (input.isLoading) {
		return false;
	}
	if (!input.isGuest && !input.error) {
		return false;
	}
	if (isServerConfirmedAuthError(input.error)) {
		return true;
	}
	// No authoritative rejection yet - trust a local session cookie over
	// navigator.onLine, which Chrome DevTools' "Offline" throttling can leave true
	// while still blocking requests, previously bouncing valid sessions to login.
	return !input.hasSessionCookie;
}
