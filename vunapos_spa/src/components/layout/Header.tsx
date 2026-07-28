import { Moon, Sun } from "lucide-react";

import { useThemeSync } from "../../features/pos/hooks/useThemeSync";
import { useThemeStore } from "../../lib/stores/themeStore";

type HeaderProps = {
	cashier?: string;
	posProfile?: string;
	warehouse?: string;
};

export function Header({ cashier, posProfile, warehouse }: HeaderProps) {
	const resolved = useThemeStore((s) => s.resolved);
	const { setTheme } = useThemeSync();

	return (
		<header className="sticky top-0 z-40 h-12 shrink-0 border-b border-outline-variant bg-surface px-3 sm:px-5">
			<div className="flex h-full items-center justify-between gap-3">
				<div className="flex shrink-0 items-center gap-2">
					<h1 className="text-sm font-semibold tracking-tight text-on-surface">VunaPOS</h1>
				</div>
				<div className="flex min-w-0 items-center gap-3">
					<div className="min-w-0 text-right text-[11px] leading-4 text-on-surface-variant sm:flex sm:flex-wrap sm:items-center sm:justify-end sm:gap-x-4 sm:gap-y-1 sm:text-xs">
						<span className="block truncate sm:inline">
							Profile <strong className="font-semibold text-on-surface">{posProfile || "-"}</strong>
						</span>
						<span className="block truncate sm:inline">
							Warehouse <strong className="font-semibold text-on-surface">{warehouse || "-"}</strong>
						</span>
						<span className="block truncate sm:inline">
							Cashier <strong className="font-semibold text-on-surface">{cashier || "-"}</strong>
						</span>
					</div>
					<button
						type="button"
						className="flex size-8 shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
						title={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
						aria-label={resolved === "dark" ? "Switch to light theme" : "Switch to dark theme"}
						onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
					>
						{resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
					</button>
				</div>
			</div>
		</header>
	);
}
