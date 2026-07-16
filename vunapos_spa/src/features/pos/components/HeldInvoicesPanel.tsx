import { AlertTriangle, ArchiveRestore, RefreshCw, Smartphone } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import type { HeldInvoiceDTO } from "../types";
import { formatCurrency } from "../utils";

type HeldInvoicesPanelProps = {
	currency?: string;
	heldInvoices: HeldInvoiceDTO[];
	isLoading?: boolean;
	onRefresh: () => void;
	onRestore: (invoice: HeldInvoiceDTO) => void;
};

function formatModified(value?: string) {
	if (!value) {
		return "";
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	return date.toLocaleString(undefined, {
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		month: "short",
	});
}

export function HeldInvoicesPanel({
	currency,
	heldInvoices,
	isLoading,
	onRefresh,
	onRestore,
}: HeldInvoicesPanelProps) {
	return (
		<div className="mt-3 rounded-md border border-outline-variant bg-surface-container-low p-3">
			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="text-sm font-semibold text-on-surface">Held Invoices</p>
					<p className="text-xs text-on-surface-variant">
						{heldInvoices.length ? `${heldInvoices.length} waiting` : "No held invoices"}
					</p>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="h-9 w-9 p-0"
					disabled={isLoading}
					onClick={onRefresh}
					aria-label="Refresh held invoices"
				>
					<RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
				</Button>
			</div>

			{heldInvoices.length ? (
				<div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
					{heldInvoices.map((invoice) => {
						const isParked = invoice.queue_status === "error";
						const isLocalPending = Boolean(invoice.is_local) && !isParked;
						return (
							<button
								key={`${invoice.doctype}-${invoice.name}`}
								type="button"
								className={`w-full rounded-md border p-3 text-left ${
									isParked
										? "border-error bg-error-container text-on-error-container hover:bg-error-container/80"
										: "border-outline-variant bg-surface hover:bg-surface-container"
								}`}
								onClick={() => onRestore(invoice)}
							>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0">
										<p className="truncate text-sm font-semibold">{invoice.name}</p>
										<p className={`truncate text-xs ${isParked ? "opacity-90" : "text-on-surface-variant"}`}>
											{invoice.customer_name || invoice.customer || "No customer"}
										</p>
										{invoice.modified ? (
											<p className={`mt-1 text-xs ${isParked ? "opacity-75" : "text-on-surface-variant"}`}>
												{formatModified(invoice.modified)}
											</p>
										) : null}
										{isParked ? (
											<div className="mt-1 inline-flex items-center gap-1 text-xs font-medium">
												<AlertTriangle className="size-3" />
												Needs attention
											</div>
										) : isLocalPending ? (
											<div className="mt-1 inline-flex items-center gap-1 text-xs text-on-surface-variant">
												<Smartphone className="size-3" />
												Saved on this device
											</div>
										) : null}
									</div>
									<div className="shrink-0 text-right">
										<p className="text-sm font-semibold">
											{formatCurrency(invoice.total, invoice.currency || currency)}
										</p>
										<div className={`mt-1 inline-flex items-center gap-1 text-xs ${isParked ? "" : "text-primary"}`}>
											<ArchiveRestore className="size-3" />
											Restore
										</div>
									</div>
								</div>
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
