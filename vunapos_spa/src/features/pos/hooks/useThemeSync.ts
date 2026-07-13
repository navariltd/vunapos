import { useEffect } from "react";
import { useFrappeAuth, useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import { unwrapVunaResponse } from "../../../services/vunaApi";
import { useThemeStore, type ThemeMode } from "../../../lib/stores/themeStore";

type DeskThemeValue = { desk_theme?: string };

const TITLE_CASE: Record<ThemeMode, string> = {
	light: "Light",
	dark: "Dark",
	automatic: "Automatic",
};

// Reuses the same User.desk_theme field/methods desk's own ThemeSwitcher does
// (frappe.client.get_value / user.switch_theme, both core).
export function useThemeSync() {
	const { currentUser } = useFrappeAuth();
	const shouldFetch = Boolean(currentUser) && currentUser !== "Guest";

	const themeQuery = useFrappeGetCall<DeskThemeValue>(
		"frappe.client.get_value",
		{ doctype: "User", fieldname: "desk_theme", filters: currentUser },
		shouldFetch ? undefined : null,
	);
	const switchThemeCall = useFrappePostCall("frappe.core.doctype.user.user.switch_theme");

	useEffect(() => {
		if (!themeQuery.data) {
			return;
		}
		// Core Frappe methods (frappe.client.get_value) don't wrap responses in vunapos's
		// own {ok,data,errors} shape - unwrapVunaResponse still works since it just
		// strips .message when there's no "ok" key.
		const value = unwrapVunaResponse<DeskThemeValue>(themeQuery.data);
		useThemeStore.getState().syncFromServer(value.desk_theme);
	}, [themeQuery.data]);

	function setTheme(mode: ThemeMode) {
		// Optimistic, same as desk's own toggle_theme - the DOM/local state flips
		// instantly, the server write happens in the background.
		useThemeStore.getState().setMode(mode);
		switchThemeCall.call({ theme: TITLE_CASE[mode] }).catch((err) => {
			// Not business-critical (this app's "never block the cashier" philosophy
			// applies here too) - it'll reconcile on the next load's read or toggle.
			console.error("Failed to sync theme to the server", err);
		});
	}

	return { setTheme };
}
