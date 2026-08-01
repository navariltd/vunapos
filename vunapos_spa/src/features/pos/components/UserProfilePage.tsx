import { Laptop, LogOut, Moon, Sun, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../../lib/cn";
import { useThemeStore, type ThemeMode } from "../../../lib/stores/themeStore";
import { useThemeSync } from "../hooks/useThemeSync";
import type { BootstrapData, CustomerDTO } from "../types";

type UserProfilePageProps = {
	bootstrap?: BootstrapData;
};

export function UserProfilePage({ bootstrap }: UserProfilePageProps) {
	const defaultCustomer = formatDefaultCustomer(bootstrap?.default_customer);
	const themeMode = useThemeStore((s) => s.mode);
	const { setTheme } = useThemeSync();

	return (
		<section className="h-full overflow-y-auto p-4 sm:p-6">
			<div className="mx-auto max-w-3xl">
				<div className="flex items-start gap-4 border-b border-outline-variant pb-5">
					<span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-container text-on-primary-container">
						<UserRound className="size-6" />
					</span>
					<div className="min-w-0 flex-1">
						<h2 className="truncate text-xl font-semibold text-on-surface">{bootstrap?.current_user || "Cashier"}</h2>
						<p className="mt-1 text-sm text-on-surface-variant">VunaPOS cashier profile</p>
					</div>
					<a
						className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-error px-3 text-sm font-medium text-on-error hover:bg-error-container hover:text-on-error-container"
						href="/?cmd=web_logout"
					>
						<LogOut className="size-4" />
						Logout
					</a>
				</div>

				<div className="mt-6 grid gap-3 sm:grid-cols-2">
					<ProfileField label="POS Profile" value={bootstrap?.pos_profile} />
					<ProfileField label="Company" value={bootstrap?.company} />
					<ProfileField label="Warehouse" value={bootstrap?.warehouse} />
					<ProfileField label="Price List" value={bootstrap?.price_list} />
					<ProfileField label="Invoice Mode" value={bootstrap?.invoice_mode || "Sales Invoice"} />
					<ProfileField label="Default Sale Type" value={bootstrap?.default_sale_type || "Cash Sale"} />
					<ProfileField label="Default Customer" value={defaultCustomer} />
					<ProfileField label="Currency" value={bootstrap?.currency} />
				</div>

				<div className="mt-6 rounded-md border border-outline-variant bg-surface-container-low p-4">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h3 className="text-sm font-semibold text-on-surface">Appearance</h3>
							<p className="mt-1 text-xs text-on-surface-variant">Choose how VunaPOS should display for this user.</p>
						</div>
						<div className="grid grid-cols-3 gap-1 rounded-md border border-outline-variant bg-surface p-1">
							<ThemeButton icon={<Sun className="size-4" />} label="Light" mode="light" activeMode={themeMode} onSelect={setTheme} />
							<ThemeButton icon={<Moon className="size-4" />} label="Dark" mode="dark" activeMode={themeMode} onSelect={setTheme} />
							<ThemeButton icon={<Laptop className="size-4" />} label="Auto" mode="automatic" activeMode={themeMode} onSelect={setTheme} />
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

function ProfileField({ label, value }: { label: string; value?: string | null }) {
	return (
		<div className="rounded-md border border-outline-variant bg-surface-container-low px-4 py-3">
			<p className="text-xs font-medium uppercase text-on-surface-variant">{label}</p>
			<p className="mt-1 truncate text-sm font-semibold text-on-surface">{value || "-"}</p>
		</div>
	);
}

function ThemeButton({
	activeMode,
	icon,
	label,
	mode,
	onSelect,
}: {
	activeMode: ThemeMode;
	icon: ReactNode;
	label: string;
	mode: ThemeMode;
	onSelect: (mode: ThemeMode) => void;
}) {
	const active = activeMode === mode;

	return (
		<button
			type="button"
			className={cn(
				"inline-flex h-9 items-center justify-center gap-2 rounded px-3 text-sm font-medium transition-colors",
				active ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
			)}
			onClick={() => onSelect(mode)}
		>
			{icon}
			<span>{label}</span>
		</button>
	);
}

function formatDefaultCustomer(customer: BootstrapData["default_customer"]) {
	if (!customer) return undefined;
	if (typeof customer === "string") return customer;
	return (customer as CustomerDTO).customer_name || (customer as CustomerDTO).customer;
}
