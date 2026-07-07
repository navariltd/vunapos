type HeaderProps = {
	cashier?: string;
	posProfile?: string;
	warehouse?: string;
};

export function Header({ cashier, posProfile, warehouse }: HeaderProps) {
	return (
		<header className="sticky top-0 z-40 h-12 shrink-0 border-b border-outline-variant bg-surface px-3 sm:px-5">
			<div className="flex h-full items-center justify-between gap-3">
				<h1 className="shrink-0 text-sm font-semibold tracking-tight text-on-surface">VunaPOS</h1>
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
			</div>
		</header>
	);
}
