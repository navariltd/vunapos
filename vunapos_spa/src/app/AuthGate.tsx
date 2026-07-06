import { useEffect } from "react";
import { useFrappeAuth } from "frappe-react-sdk";

import { CsrfTokenLoader } from "./CsrfTokenLoader";

type AuthGateProps = {
	children: React.ReactNode;
};

function redirectToLogin() {
	const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
	window.location.href = `/login?redirect-to=${encodeURIComponent(redirectTo)}`;
}

export function AuthGate({ children }: AuthGateProps) {
	const { currentUser, isLoading, error } = useFrappeAuth();
	const isGuest = !currentUser || currentUser === "Guest";

	useEffect(() => {
		if (!isLoading && (isGuest || error)) {
			redirectToLogin();
		}
	}, [error, isGuest, isLoading]);

	if (isLoading || (isGuest && !error)) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-6 text-on-surface">
				<div className="text-sm font-medium text-on-surface-variant">Loading VunaPOS...</div>
			</div>
		);
	}

	if (isGuest || error) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background px-6 text-on-surface">
				<div className="text-sm font-medium text-on-surface-variant">Redirecting to login...</div>
			</div>
		);
	}

	return <CsrfTokenLoader>{children}</CsrfTokenLoader>;
}
