import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { useThemeSync } from "../../features/pos/hooks/useThemeSync";

type OrderType = "Sales Invoice" | "Sales Order";

export function Header() {
	useThemeSync();
	const [orderType, setOrderType] = useState<OrderType>("Sales Invoice");

	return (
		<header className="sticky top-0 z-40 h-12 shrink-0 border-b border-outline-variant bg-surface px-3 sm:px-5">
			<div className="flex h-full items-center justify-between gap-3">
				<div className="flex shrink-0 items-center gap-2">
					<h1 className="text-sm font-semibold tracking-tight text-on-surface">VunaPOS</h1>
				</div>
				<div className="flex min-w-0 items-center gap-2">
					<label className="flex items-center gap-2 text-xs text-on-surface-variant">
						<span className="hidden sm:inline">Order Type</span>
						<span className="relative">
							<select
								className="h-8 max-w-36 appearance-none rounded-md border border-outline-variant bg-surface-container-low py-0 pl-2 pr-7 text-xs font-medium text-on-surface outline-none hover:border-outline focus:border-primary sm:max-w-none sm:pl-3 sm:pr-8 sm:text-sm"
								value={orderType}
								onChange={(event) => setOrderType(event.target.value as OrderType)}
							>
								<option>Sales Invoice</option>
								<option>Sales Order</option>
							</select>
							<ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
						</span>
					</label>
				</div>
			</div>
		</header>
	);
}
