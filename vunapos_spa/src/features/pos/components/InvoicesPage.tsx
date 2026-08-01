import { useState, type MouseEvent, type ReactNode } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import { Button } from "../../../components/ui/Button";
import { navigateToInvoice } from "../../../lib/stores/navigationStore";
import { unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";
import type { HeldInvoiceDTO, ModeOfPaymentDTO } from "../types";
import { HeldInvoicesPanel } from "./HeldInvoicesPanel";
import { CheckoutQueuePanel } from "./CheckoutQueuePanel";

type Props = { posProfile?: string; currency?: string; paymentModes: ModeOfPaymentDTO[]; heldInvoices?: HeldInvoiceDTO[]; heldLoading: boolean; onBack: () => void; onRefreshHeld: () => void; onRestoreHeld: (invoice: HeldInvoiceDTO) => void };
type Filters = { invoice: string; customer: string; from_date: string; to_date: string; status: string; payment_mode: string; sale_type: string; current_shift: string };
type InvoicePayment = { mode_of_payment: string; amount: number; transaction_reference?: string; ke_payment_request?: string };
type HistoryInvoice = { name: string; doctype: string; posting_date: string; posting_time?: string; due_date?: string; customer: string; customer_name?: string; currency?: string; grand_total: number; paid_amount: number; outstanding_amount: number; total_qty: number; status: string; is_return: boolean; vunapos_credit_sale?: boolean; return_against?: string; vunapos_session_cashier?: string; vunapos_opening_entry?: string; vunapos_closing_entry?: string; payments: InvoicePayment[] };
type History = { invoices: HistoryInvoice[]; has_more: boolean; opening_entry?: string; summary: { invoice_count: number; returns_count: number; gross_sales: number; returns: number; net_sales: number; outstanding: number; credit_sales: number; credit_outstanding: number } };
const fieldClass = "rounded-md border border-outline-variant bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

export function InvoicesPage({ posProfile, currency, paymentModes, heldInvoices, heldLoading, onBack, onRefreshHeld, onRestoreHeld }: Props) {
	const [tab, setTab] = useState<"history" | "queue" | "issues">("history");
	const [filters, setFilters] = useState<Filters>({ invoice: "", customer: "", from_date: "", to_date: "", status: "", payment_mode: "", sale_type: "", current_shift: "1" });
	const [start, setStart] = useState(0);
	const call = useFrappeGetCall<unknown>(vunaMethods.getInvoiceHistory, { pos_profile: posProfile, ...filters, start, page_length: 50 }, posProfile && tab === "history" ? ["vunapos_invoice_history", posProfile, filters, start] : null);
	let history: History | null = null; let error = call.error?.message || "";
	try { if (call.data) history = unwrapVunaResponse<History>(call.data); } catch (err) { error = err instanceof Error ? err.message : "Unable to load invoice history"; }
	const update = (field: keyof Filters, value: string) => { setFilters((current) => ({ ...current, [field]: value })); setStart(0); };
	const clearFilters = () => {
		setFilters({ invoice: "", customer: "", from_date: "", to_date: "", status: "", payment_mode: "", sale_type: "", current_shift: "1" });
		setStart(0);
	};
	const openDetails = (event: MouseEvent<HTMLElement>) => {
		const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/app/"]');
		if (!link) return;
		event.preventDefault();
		navigateToInvoice(decodeURIComponent(link.pathname.split("/").pop() || ""));
	};

	return <section onClick={openDetails} className="min-h-0 flex-1 overflow-y-auto border-t border-outline-variant bg-surface p-4 pb-[84px] lg:pb-4"><div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
		<div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Invoices</h2><p className="text-sm text-on-surface-variant">Review completed sales and restore held invoices.</p></div><Button onClick={onBack}>Back to POS</Button></div>
		<div className="flex border-b border-outline-variant"><Tab active={tab === "history"} onClick={() => setTab("history")}>Sales History</Tab><Tab active={tab === "queue"} onClick={() => setTab("queue")}>Checkout Queue</Tab><Tab active={tab === "issues"} onClick={() => setTab("issues")}>Held Invoices</Tab></div>
		{tab === "queue" ? <CheckoutQueuePanel posProfile={posProfile} currency={currency}/> : tab === "issues" ? <HeldInvoicesPanel currency={currency} heldInvoices={heldInvoices} isLoading={heldLoading} onRefresh={onRefreshHeld} onRestore={onRestoreHeld}/> : <>
			<div className="grid gap-3 rounded-lg border border-outline-variant p-4 sm:grid-cols-2 lg:grid-cols-4"><input className={fieldClass} placeholder="Invoice number" value={filters.invoice} onChange={(event) => update("invoice", event.target.value)}/><input className={fieldClass} placeholder="Customer ID" value={filters.customer} onChange={(event) => update("customer", event.target.value)}/><DateFilter label="From date" value={filters.from_date} onChange={(value) => update("from_date", value)}/><DateFilter label="To date" value={filters.to_date} onChange={(value) => update("to_date", value)}/><select className={fieldClass} value={filters.status} onChange={(event) => update("status", event.target.value)}><option value="">All statuses</option>{["Paid", "Partly Paid", "Unpaid", "Overdue", "Credit Note", "Cancelled"].map((value) => <option key={value}>{value}</option>)}</select><select className={fieldClass} value={filters.payment_mode} onChange={(event) => update("payment_mode", event.target.value)}><option value="">All payment modes</option>{paymentModes.map((row) => <option key={row.mode_of_payment}>{row.mode_of_payment}</option>)}</select><select className={fieldClass} value={filters.sale_type} onChange={(event) => update("sale_type", event.target.value)}><option value="">All sale types</option><option>Cash Sale</option><option>Credit Sale</option></select><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={filters.current_shift === "1"} onChange={(event) => update("current_shift", event.target.checked ? "1" : "0")}/>Current shift only</label><Button variant="ghost" onClick={clearFilters}>Clear filters</Button></div>
			{error ? <Notice>{error}</Notice> : null}
			{history ? <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Summary label="Invoices" value={String(history.summary.invoice_count)}/><Summary label="Gross sales" value={money(history.summary.gross_sales, currency)}/><Summary label="Returns" value={money(history.summary.returns, currency)}/><Summary label="Outstanding" value={money(history.summary.outstanding, currency)}/><Summary label="Credit sales" value={money(history.summary.credit_sales, currency)}/><Summary label="Credit outstanding" value={money(history.summary.credit_outstanding, currency)}/></div><div className="overflow-x-auto rounded-lg border border-outline-variant"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-surface-container-low text-xs text-on-surface-variant"><tr><th className="px-3 py-3">Invoice</th><th>Date / time</th><th>Customer</th><th>Cashier / shift</th><th>Items</th><th>Payment</th><th>Total</th><th>Outstanding</th><th>Status</th></tr></thead><tbody>{history.invoices.length ? history.invoices.map((row) => <tr key={row.name} className="border-t border-outline-variant"><td className="px-3 py-3"><a className="font-medium text-primary hover:underline" href={`/app/${row.doctype.toLowerCase().replaceAll(" ", "-")}/${encodeURIComponent(row.name)}`} target="_blank" rel="noreferrer">{row.name}</a>{row.vunapos_credit_sale ? <span className="mt-1 block w-fit rounded-full bg-tertiary-container px-2 py-0.5 text-xs font-medium text-on-tertiary-container">Credit Sale</span> : null}</td><td>{formatDate(row.posting_date)}<span className="block text-xs text-on-surface-variant">{formatTime(row.posting_time || row.posting_date)}</span>{row.vunapos_credit_sale && row.due_date ? <span className="block text-xs text-on-surface-variant">Due {formatDate(row.due_date)}</span> : null}</td><td>{row.customer_name || row.customer}<span className="block text-xs text-on-surface-variant">{row.customer}</span></td><td>{row.vunapos_session_cashier || "-"}<span className="block text-xs text-on-surface-variant">{row.vunapos_opening_entry || "No shift"}</span></td><td>{row.total_qty}</td><td>{row.payments.length ? row.payments.map((payment) => <PaymentLine key={`${payment.mode_of_payment}-${payment.transaction_reference || payment.ke_payment_request || payment.amount}`} payment={payment} currency={row.currency || currency}/>) : row.vunapos_credit_sale ? "No deposit" : "-"}</td><td className="font-medium">{money(row.grand_total, row.currency || currency)}</td><td>{money(row.outstanding_amount, row.currency || currency)}</td><td><Status value={row.status}/></td></tr>) : <tr><td colSpan={9} className="p-8 text-center text-on-surface-variant">No invoices match these filters.</td></tr>}</tbody></table></div><div className="flex justify-end gap-2"><Button variant="ghost" disabled={!start} onClick={() => setStart(Math.max(0, start - 50))}>Previous</Button><Button variant="ghost" disabled={!history.has_more} onClick={() => setStart(start + 50)}>Next</Button></div></> : call.isLoading ? <p className="py-12 text-center text-sm text-on-surface-variant">Loading invoice history...</p> : null}
		</>}
	</div></section>;
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) { return <button className={`px-5 py-3 text-sm font-medium ${active ? "border-b-2 border-primary text-primary" : "text-on-surface-variant"}`} onClick={onClick}>{children}</button>; }
function DateFilter({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <input className={fieldClass} type="date" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}/>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-outline-variant bg-surface-container-low p-4"><p className="text-xs text-on-surface-variant">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>; }
function PaymentLine({ payment, currency }: { payment: InvoicePayment; currency?: string }) {
	const reference = payment.transaction_reference || payment.ke_payment_request;
	return <span className="block">
		{payment.mode_of_payment}: {money(payment.amount, currency)}
		{reference ? <span className="block text-xs text-on-surface-variant">Ref {reference}</span> : null}
	</span>;
}
function Status({ value }: { value: string }) { return <span className={`rounded-full px-2 py-1 text-xs font-medium ${value === "Paid" ? "bg-secondary-container text-on-secondary-container" : value === "Cancelled" || value === "Overdue" ? "bg-error-container text-on-error-container" : "bg-surface-container-high text-on-surface"}`}>{value}</span>; }
function Notice({ children }: { children: ReactNode }) { return <div className="rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">{children}</div>; }
function money(value: number, currency?: string) { return new Intl.NumberFormat(undefined, { style: currency ? "currency" : "decimal", currency: currency || undefined }).format(value); }
function formatDate(value?: string) {
	if (!value) return "-";
	const date = value.split(" ")[0];
	const [year, month, day] = date.split("-");
	return year && month && day ? `${day}/${month}/${year}` : date;
}
function formatTime(value?: string) {
	if (!value) return "";
	const time = value.split(" ")[1] || value;
	const parts = time.split(".")[0].split(":");
	return parts.length >= 2 ? `${parts[0]}:${parts[1]}:${parts[2] || "00"}` : time.split(".")[0];
}
