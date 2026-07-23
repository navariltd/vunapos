import { useMemo, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import type { POSClosingPreviewDTO } from "../types";
import { Button } from "../../../components/ui/Button";
import { cachePosSession } from "../../../lib/cacheEngine";
import { queueRepository } from "../../../lib/repositories/queueRepository";
import type { CachedPosSession } from "../../../lib/types";
import {
	closePosSession,
	unwrapVunaResponse,
	vunaMethods,
} from "../../../services/vunaApi";
import { useQueueStatus } from "../hooks/useQueueStatus";

type CloseShiftPageProps = {
	posProfile: string;
	currency?: string;
	onBack: () => void;
};

export function CloseShiftPage({ posProfile, currency, onBack }: CloseShiftPageProps) {
	const queue = useQueueStatus();
	const previewCall = useFrappeGetCall<unknown>(
		vunaMethods.getClosingPreview,
		{ pos_profile: posProfile },
		["vunapos_closing_preview", posProfile],
		{
			revalidateOnMount: true,
			dedupingInterval: 0,
			keepPreviousData: false,
		},
	);
	const closeCall = useFrappePostCall(vunaMethods.closePosSession);
	const [amounts, setAmounts] = useState<Record<string, string>>({});
	const [error, setError] = useState("");

	const preview = useMemo(() => {
		if (!previewCall.data) return null;
		try {
			const response = unwrapVunaResponse<POSClosingPreviewDTO>(previewCall.data);
			// Be tolerant of a response cached by an older frontend/backend release.
			// The live revalidation above will replace it, but it must not crash this page first.
			return {
				...response,
				invoices: Array.isArray(response.invoices) ? response.invoices : [],
				payments: Array.isArray(response.payments) ? response.payments : [],
			};
		} catch {
			return null;
		}
	}, [previewCall.data]);

	const blocker = !queue.isReachable
		? "Reconnect to the server before closing this shift."
		: queue.pending > 0
			? `Wait for ${queue.pending} pending transaction${queue.pending === 1 ? "" : "s"} to sync.`
			: queue.parked > 0
				? `Resolve ${queue.parked} rejected transaction${queue.parked === 1 ? "" : "s"} before closing.`
				: null;

	async function handleClose() {
		if (!preview || blocker) return;
		const queueEntries = await queueRepository.getAll();
		if (queueEntries.some((entry) => entry.status === "pending" || entry.status === "syncing")) {
			setError("Pending transactions appeared while closing. Wait for synchronization and try again.");
			return;
		}
		if (queueEntries.some((entry) => entry.status === "error")) {
			setError("Resolve rejected transactions before closing the POS shift.");
			return;
		}
		if (preview.payments.some((row) => !amounts[row.mode_of_payment]?.trim())) {
			setError("Enter a counted amount for every payment mode.");
			return;
		}
		const closingBalances = preview.payments.map((row) => ({
			mode_of_payment: row.mode_of_payment,
			closing_amount: Number(amounts[row.mode_of_payment]),
		}));
		if (closingBalances.some((row) => !Number.isFinite(row.closing_amount) || row.closing_amount < 0)) {
			setError("Enter a valid counted amount for every payment mode.");
			return;
		}
		if (!window.confirm("Close this POS shift? You will need a new opening entry before making more sales.")) {
			return;
		}
		setError("");
		try {
			const result = await closePosSession(closeCall.call, {
				pos_profile: posProfile,
				closing_balances: closingBalances,
			});
			if (result.session) {
				await cachePosSession(result.session as CachedPosSession);
			}
			// Re-run the top-level session gate immediately. The cached server result
			// already marks this session as closed, so sales stay blocked even if the
			// live session check is briefly unavailable during the reload.
			window.location.reload();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to close POS session");
		}
	}

	const loadError = previewCall.error?.message || (!previewCall.isLoading && !preview ? "Unable to load closing summary" : "");
	return (
		<section className="h-full overflow-y-auto p-4 pb-[84px] lg:pb-4">
			<div className="mx-auto max-w-4xl space-y-4">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h2 className="text-lg font-semibold">Close POS Shift</h2>
						<p className="text-sm text-on-surface-variant">Reconcile the till and close {posProfile}.</p>
					</div>
					<Button variant="ghost" onClick={onBack}>Back to POS</Button>
				</div>

				{blocker || loadError || error ? (
					<div className="flex gap-2 rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">
						<AlertCircle className="size-4 shrink-0" />
						{blocker || loadError || error}
					</div>
				) : null}

				{previewCall.isLoading ? <p className="py-12 text-center text-sm text-on-surface-variant">Loading shift totals...</p> : null}
				{preview ? (
					<>
						<div className="grid gap-3 sm:grid-cols-3">
							<Summary label="Invoices" value={String(preview.invoice_count)} />
							<Summary label="Net sales" value={money(preview.net_total, currency)} />
							<Summary label="Grand total" value={money(preview.grand_total, currency)} />
						</div>
						{preview.payment_activity ? <div className="rounded-lg border border-outline-variant bg-surface-container-low p-4"><h3 className="font-semibold">Shift payment activity</h3><p className="mt-1 text-xs text-on-surface-variant">Reconciled credits are allocations only and are excluded from cash received.</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Summary label="Checkout collections" value={money(preview.payment_activity.sales_collected, currency)}/><Summary label="Old invoice payments" value={money(preview.payment_activity.outstanding_invoice_payments, currency)}/><Summary label="Customer advances" value={money(preview.payment_activity.customer_advances, currency)}/><Summary label="Credits reconciled" value={money(preview.payment_activity.reconciled_existing_credits, currency)}/><Summary label="Cash received" value={money(preview.payment_activity.cash_received, currency)}/></div></div> : null}
						<div className="rounded-lg border border-outline-variant bg-surface-container-low p-4">
							<h3 className="font-semibold">Payment reconciliation</h3>
							<div className="mt-3 space-y-3">
								{preview.payments.map((row) => {
									const rawAmount = amounts[row.mode_of_payment];
									const counted = Number(rawAmount);
									const difference = rawAmount?.trim() && Number.isFinite(counted) ? counted - row.expected_amount : null;
									return (
										<div key={row.mode_of_payment} className="grid items-center gap-2 rounded-md bg-surface p-3 sm:grid-cols-[1fr_1fr_1fr]">
											<div><p className="text-sm font-medium">{row.mode_of_payment}</p><p className="text-xs text-on-surface-variant">Expected {money(row.expected_amount, currency)}</p></div>
											<input type="number" min="0" step="0.01" placeholder="Counted amount" value={amounts[row.mode_of_payment] ?? ""} onChange={(event) => setAmounts((current) => ({ ...current, [row.mode_of_payment]: event.target.value }))} className="rounded-md border border-outline-variant bg-surface px-3 py-2 text-sm" />
											<p className="text-sm text-on-surface-variant">Difference: {difference === null ? "-" : money(difference, currency)}</p>
										</div>
									);
								})}
							</div>
						</div>
						<div className="flex justify-end gap-2">
							<Button variant="ghost" onClick={() => previewCall.mutate()}><RefreshCw className="mr-2 size-4" />Refresh totals</Button>
							<Button disabled={Boolean(blocker) || closeCall.loading} onClick={handleClose}>{closeCall.loading ? "Closing..." : "Close POS Shift"}</Button>
						</div>
						<div className="rounded-lg border border-outline-variant bg-surface-container-low p-4">
							<div className="flex items-center justify-between gap-3">
								<div>
									<h3 className="font-semibold">Sales in this shift</h3>
									<p className="text-xs text-on-surface-variant">Invoices included in this closing reconciliation.</p>
								</div>
								<span className="text-sm font-medium">{preview.invoice_count} total</span>
							</div>
							{preview.invoices.length ? (
								<div className="mt-3 overflow-x-auto">
									<table className="w-full min-w-[640px] text-left text-sm">
										<thead className="text-xs text-on-surface-variant">
											<tr className="border-b border-outline-variant">
												<th className="px-2 py-2 font-medium">Invoice</th>
												<th className="px-2 py-2 font-medium">Date / time</th>
												<th className="px-2 py-2 font-medium">Customer</th>
												<th className="px-2 py-2 text-right font-medium">Total</th>
											</tr>
										</thead>
										<tbody>
											{preview.invoices.map((invoice) => (
												<tr key={`${invoice.doctype}:${invoice.name}`} className="border-b border-outline-variant last:border-0">
													<td className="px-2 py-2 font-medium">{invoice.name}{invoice.is_return ? " (Return)" : ""}</td>
													<td className="px-2 py-2 text-on-surface-variant">{invoice.posting_date} {invoice.posting_time || ""}</td>
													<td className="px-2 py-2 text-on-surface-variant">{invoice.customer || "-"}</td>
													<td className="px-2 py-2 text-right font-medium">{money(invoice.grand_total, currency)}</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							) : (
								<p className="mt-3 rounded-md bg-surface p-3 text-sm text-on-surface-variant">No submitted VunaPOS invoices belong to this opening session yet.</p>
							)}
						</div>
					</>
				) : null}
			</div>
		</section>
	);
}

function Summary({ label, value }: { label: string; value: string }) {
	return <div className="rounded-lg border border-outline-variant bg-surface-container-low p-4"><p className="text-xs text-on-surface-variant">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>;
}

function money(value: number, currency?: string) {
	return `${currency || ""} ${value.toFixed(2)}`.trim();
}
