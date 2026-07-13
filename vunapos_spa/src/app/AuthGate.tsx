import { useEffect } from "react";
import { useFrappeAuth } from "frappe-react-sdk";

import { hasValidSessionCookie, shouldRedirectToLogin } from "./authGuard";
import { CsrfTokenLoader } from "./CsrfTokenLoader";

type AuthGateProps = {
	children: React.ReactNode;
};

function redirectToLogin() {
	// Guards against a nested redirect-to loop
	if (window.location.pathname === "/login") {
		return;
	}
	const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
	window.location.href = `/login?redirect-to=${encodeURIComponent(redirectTo)}`;
}

export function AuthGate({ children }: AuthGateProps) {
	const { currentUser, isLoading, error } = useFrappeAuth();
	const isGuest = !currentUser || currentUser === "Guest";
	const shouldRedirect = shouldRedirectToLogin({
		isLoading,
		isGuest,
		error,
		hasSessionCookie: hasValidSessionCookie(),
	});

	useEffect(() => {
		if (shouldRedirect) {
			redirectToLogin();
		}
	}, [shouldRedirect]);

	if (isLoading) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-6 text-on-surface">
				<div className="text-sm font-medium text-on-surface-variant">Loading VunaPOS...</div>
			</div>
		);
	}

	if (shouldRedirect) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-6 text-on-surface">
				<div className="text-sm font-medium text-on-surface-variant">Redirecting to login...</div>
			</div>
		);
	}

	// Confirmed session, or an unconfirmed one trusted via cookie (no server rejection
	// yet); BootstrapGate separately checks whether cached data is enough to sell.
	return <CsrfTokenLoader>{children}</CsrfTokenLoader>;
}
