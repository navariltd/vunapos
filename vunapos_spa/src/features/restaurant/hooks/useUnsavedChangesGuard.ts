import { useCallback, useEffect, useRef, useState } from "react";

import {
	getOrderFromPath,
	navigateToOrder,
	navigateToPosPage,
	setNavigationGuard,
	type POSPage,
} from "../../../lib/stores/navigationStore";

// Holds in-app navigation (sidebar, bottom nav, back button) while there are
// unsaved changes, and asks the browser to warn before closing or reloading.
// `allow` lets some navigations through, e.g. to the floor to pick a table.
export function useUnsavedChangesGuard(dirty: boolean, allow?: (page: POSPage, path: string) => boolean) {
	const [pendingPage, setPendingPage] = useState<POSPage | null>(null);
	const allowRef = useRef(allow);
	// Where a held navigation was going: the order screen has a path per order.
	const pendingPathRef = useRef<string | null>(null);
	useEffect(() => {
		allowRef.current = allow;
	}, [allow]);

	useEffect(() => {
		if (!dirty) return;
		setNavigationGuard((page, path) => {
			if (allowRef.current?.(page, path)) return true;
			pendingPathRef.current = path;
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
		const path = pendingPathRef.current;
		pendingPathRef.current = null;
		if (page === "Order") navigateToOrder(path ? getOrderFromPath(path) : null);
		else navigateToPosPage(page);
	}, []);

	const stay = useCallback(() => setPendingPage(null), []);

	const requestLeave = useCallback((page: POSPage) => {
		pendingPathRef.current = null;
		setPendingPage(page);
	}, []);

	return { pendingPage, requestLeave, discardAndLeave, stay };
}
