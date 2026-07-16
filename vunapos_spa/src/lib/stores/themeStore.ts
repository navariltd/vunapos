import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "automatic";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "vunapos_theme_mode";

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
	if (mode === "automatic") {
		return prefersDark ? "dark" : "light";
	}
	return mode;
}

// Maps desk's User.desk_theme ("Light"/"Dark"/"Automatic") to lowercase ThemeMode; unrecognized
// values fall back to "light" to match desk's own `bootinfo["desk_theme"] = ... or "Light"`.
export function normalizeServerTheme(value: string | null | undefined): ThemeMode {
	const lower = (value || "").toLowerCase();
	return lower === "dark" || lower === "automatic" ? lower : "light";
}

// Guarded: vitest runs this in Node (no window/document, see setup.ts). In the browser,
// index.html's inline pre-paint script already reads this same key before React mounts -
// re-reading here just seeds in-memory state to match, avoiding a wrong-icon flash.
function readStoredMode(): ThemeMode {
	if (typeof window === "undefined") {
		return "light";
	}
	try {
		return normalizeServerTheme(window.localStorage.getItem(STORAGE_KEY));
	} catch {
		return "light";
	}
}

function prefersDarkNow(): boolean {
	return typeof window !== "undefined" && typeof window.matchMedia === "function"
		? window.matchMedia("(prefers-color-scheme: dark)").matches
		: false;
}

function applyDomTheme(mode: ThemeMode, resolved: ResolvedTheme) {
	if (typeof document !== "undefined") {
		document.documentElement.setAttribute("data-theme-mode", mode);
		document.documentElement.setAttribute("data-theme", resolved);
	}
	if (typeof window !== "undefined") {
		try {
			window.localStorage.setItem(STORAGE_KEY, mode);
		} catch {
			// Storage can be unavailable (private browsing, quota) - the theme
			// still applies for this session, it just won't survive a reload.
		}
	}
}

type ThemeStore = {
	mode: ThemeMode;
	resolved: ResolvedTheme;
	/** Optimistic local change - callers still owe the server write (useThemeSync). */
	setMode: (mode: ThemeMode) => void;
	/** Reconciles against desk's real desk_theme once the read call resolves. */
	syncFromServer: (deskTheme: string | null | undefined) => void;
};

export const useThemeStore = create<ThemeStore>((set, get) => {
	const mode = readStoredMode();
	const resolved = resolveTheme(mode, prefersDarkNow());
	applyDomTheme(mode, resolved);

	return {
		mode,
		resolved,
		setMode: (nextMode) => {
			const nextResolved = resolveTheme(nextMode, prefersDarkNow());
			applyDomTheme(nextMode, nextResolved);
			set({ mode: nextMode, resolved: nextResolved });
		},
		syncFromServer: (deskTheme) => {
			const nextMode = normalizeServerTheme(deskTheme);
			if (nextMode === get().mode) {
				return;
			}
			const nextResolved = resolveTheme(nextMode, prefersDarkNow());
			applyDomTheme(nextMode, nextResolved);
			set({ mode: nextMode, resolved: nextResolved });
		},
	};
});

// Updates `resolved` live when mode is "automatic" and OS preference changes (mirrors desk's
// theme_switcher.js). Invoked explicitly from main.tsx, not at module-import time, so
// importing this store never touches `window` - required for the Node test env above.
export function initSystemThemeListener() {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
		return;
	}
	const query = window.matchMedia("(prefers-color-scheme: dark)");
	query.addEventListener("change", (event) => {
		const { mode } = useThemeStore.getState();
		if (mode !== "automatic") {
			return;
		}
		const resolved: ResolvedTheme = event.matches ? "dark" : "light";
		applyDomTheme(mode, resolved);
		useThemeStore.setState({ resolved });
	});
}
