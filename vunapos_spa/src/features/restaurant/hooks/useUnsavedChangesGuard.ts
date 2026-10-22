import { useCallback, useEffect, useState } from "react";

import { navigateToPosPage, setNavigationGuard, type POSPage } from "../../../lib/stores/navigationStore";

// Holds in-app navigation (sidebar, bottom nav, back button) while there are
// unsaved changes, and asks the browser to warn before closing or reloading.
export function useUnsavedChangesGuard(dirty: boolean) {
	const [pendingPage, setPendingPage] = useState<POSPage | null>(null);

	useEffect(() => {
		if (!dirty) return;
		setNavigationGuard((page) => {
			setPendingPage(page);
			return false;
		});
		const warnBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
		};
		window.addEventListener("beforeunload", warnBeforeUnload);
		return () => {
			setNavigationGuard(null);
			window.removeEventListener("beforeunload", warnBeforeUnload);
		};
	}, [dirty]);

	// Leave without saving: drop the guard first so the navigation goes through.
	const discardAndLeave = useCallback((page: POSPage) => {
		setNavigationGuard(null);
		setPendingPage(null);
		navigateToPosPage(page);
	}, []);

	const stay = useCallback(() => setPendingPage(null), []);

	return { pendingPage, requestLeave: setPendingPage, discardAndLeave, stay };
}
