import { useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { RefreshCw, RotateCcw, XCircle } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";

type QueueRow = {
	name: string;
	customer?: string;
	customer_name?: string;
	currency?: string;
	grand_total?: number;
	rounded_total?: number;
	posting_date?: string;
	posting_time?: string;
	queue_status: "Queued" | "Processing" | "Failed" | "Requires Review";
	queue_attempts: number;
	queue_error?: string;
	queued_at?: string;
	processing_started_at?: string;
};

export function CheckoutQueuePanel({ posProfile, currency }: { posProfile?: string; currency?: string }) {
	const [actionError, setActionError] = useState("");
	const [activeInvoice, setActiveInvoice] = useState("");
	const call = useFrappeGetCall<unknown>(
		vunaMethods.getCheckoutQueue,
		{ pos_profile: posProfile },
		posProfile ? ["vunapos_checkout_queue", posProfile] : null,
	);
	const retryCall = useFrappePostCall(vunaMethods.retryQueuedInvoice);
	const cancelCall = useFrappePostCall(vunaMethods.cancelQueuedInvoice);
	let rows: QueueRow[] = [];
	let loadError = call.error?.message || "";
	try {
		if (call.data) rows = unwrapVunaResponse<QueueRow[]>(call.data);
	} catch (error) {
		loadError = error instanceof Error ? error.message : "Unable to load queued sales";
	}

	async function runAction(action: "retry" | "cancel", invoice: string) {
		if (action === "cancel" && !window.confirm(`Cancel queued sale ${invoice} and release its stock?`)) return;
		setActiveInvoice(invoice);
		setActionError("");
		try {
			const mutation = action === "retry" ? retryCall : cancelCall;
			const response = await mutation.call({ pos_profile: posProfile, invoice_name: invoice });
			unwrapVunaResponse(response);
			await call.mutate();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : `Unable to ${action} queued sale`);
		} finally {
			setActiveInvoice("");
		}
	}

	return <div className="flex flex-col gap-4">
		<div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-outline-variant bg-surface-container-low p-4">
			<div><h3 className="font-semibold">Checkout queue</h3><p className="text-sm text-on-surface-variant">Reserved sales awaiting submission or cashier attention.</p></div>
			<Button variant="ghost" disabled={call.isLoading} onClick={() => void call.mutate()}><RefreshCw className="mr-2 size-4"/>Refresh</Button>
		</div>
		{loadError || actionError ? <div className="rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">{actionError || loadError}</div> : null}
		{call.isLoading ? <p className="py-10 text-center text-sm text-on-surface-variant">Loading checkout queue...</p> : rows.length ? <div className="overflow-x-auto rounded-lg border border-outline-variant"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-surface-container-low text-xs text-on-surface-variant"><tr><th className="px-4 py-3">Invoice</th><th>Customer</th><th>Total</th><th>Status</th><th>Attempts</th><th>Error</th><th className="px-4 text-right">Actions</th></tr></thead><tbody>{rows.map((row) => {
			const retryable = row.queue_status === "Failed";
			const cancellable = row.queue_status !== "Processing";
			return <tr key={row.name} className="border-t border-outline-variant"><td className="px-4 py-3"><a className="font-medium text-primary hover:underline" href={`/app/sales-invoice/${encodeURIComponent(row.name)}`} target="_blank" rel="noreferrer">{row.name}</a><span className="block text-xs text-on-surface-variant">{row.queued_at || row.posting_date || ""}</span></td><td>{row.customer_name || row.customer || "-"}<span className="block text-xs text-on-surface-variant">{row.customer}</span></td><td className="font-medium">{money(row.rounded_total || row.grand_total || 0, row.currency || currency)}</td><td><QueueStatus value={row.queue_status}/></td><td>{row.queue_attempts || 0}</td><td className="max-w-xs"><span className="line-clamp-2 text-xs text-error">{row.queue_error || "-"}</span></td><td className="px-4"><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={!retryable || Boolean(activeInvoice)} onClick={() => void runAction("retry", row.name)}><RotateCcw className="mr-1 size-4"/>Retry</Button><Button size="sm" variant="ghost" disabled={!cancellable || Boolean(activeInvoice)} onClick={() => void runAction("cancel", row.name)}><XCircle className="mr-1 size-4"/>Cancel</Button></div></td></tr>;
		})}</tbody></table></div> : <div className="rounded-lg border border-dashed border-outline-variant p-10 text-center"><p className="font-medium">The checkout queue is clear</p><p className="mt-1 text-sm text-on-surface-variant">There are no reserved sales waiting for submission or review.</p></div>}
	</div>;
}

function QueueStatus({ value }: { value: QueueRow["queue_status"] }) {
	const tone = value === "Failed" || value === "Requires Review" ? "bg-error-container text-on-error-container" : value === "Processing" ? "bg-tertiary-container text-on-tertiary-container" : "bg-primary-container text-on-primary-container";
	return <span className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}>{value}</span>;
}

function money(value: number, currency?: string) {
	return new Intl.NumberFormat(undefined, { style: currency ? "currency" : "decimal", currency: currency || undefined }).format(value);
}
