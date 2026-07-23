import { useMemo, useRef, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";
import { CreditCard, Search } from "lucide-react";

import { Button } from "../../components/ui/Button";
import { navigateToPosPage } from "../../lib/stores/navigationStore";
import { unwrapVunaResponse, vunaMethods } from "../../services/vunaApi";
import { useCustomerSearch } from "../pos/hooks/useCustomerSearch";
import type { CustomerDetailsDTO, ModeOfPaymentDTO } from "../pos/types";

type Props = { posProfile?: string; currency?: string; paymentModes: ModeOfPaymentDTO[]; isOnline: boolean };
type PaymentResult = { name: string; duplicate: boolean; unallocated_amount: number };

export function PaymentsPage({ posProfile, currency, paymentModes, isOnline }: Props) {
	const initial = useMemo(() => new URLSearchParams(window.location.search), []);
	const [customer, setCustomer] = useState(initial.get("customer") || "");
	const [invoice, setInvoice] = useState(initial.get("invoice") || "");
	const [query, setQuery] = useState("");
	const [amount, setAmount] = useState("");
	const [mode, setMode] = useState(paymentModes.find((row) => row.default)?.mode_of_payment || paymentModes[0]?.mode_of_payment || "");
	const [referenceNo, setReferenceNo] = useState("");
	const [remarks, setRemarks] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<PaymentResult | null>(null);
	const idempotencyKey = useRef(crypto.randomUUID());
	const customerSearch = useCustomerSearch(query);
	const createCall = useFrappePostCall(vunaMethods.receiveCustomerPayment);
	const detailsCall = useFrappeGetCall<unknown>(vunaMethods.getCustomerDetails, { pos_profile: posProfile, customer }, posProfile && customer && isOnline ? ["vunapos_payment_customer", posProfile, customer, result?.name] : null);
	let details: CustomerDetailsDTO | null = null;
	let detailsError: string | null = null;
	if (detailsCall.data) {
		try { details = unwrapVunaResponse<CustomerDetailsDTO>(detailsCall.data); }
		catch (err) { detailsError = err instanceof Error ? err.message : "Unable to load customer"; }
	}
	const outstandingInvoices = details?.invoices.filter((row) => !row.is_return && row.outstanding_amount > 0) || [];
	const selectedOutstanding = outstandingInvoices.find((row) => row.name === invoice)?.outstanding_amount;
	const displayedAmount = amount || (invoice && selectedOutstanding !== undefined ? String(selectedOutstanding) : "");

	async function submit() {
		setError(null); setResult(null);
		if (!isOnline) { setError("Customer payments require an active server connection."); return; }
		if (!customer || !mode || !(Number(displayedAmount) > 0)) { setError("Select a customer, payment mode, and valid amount."); return; }
		try {
			const response = await createCall.call({
				pos_profile: posProfile, customer, amount: Number(displayedAmount), mode_of_payment: mode,
				sales_invoice: invoice || undefined, allocated_amount: invoice ? Number(displayedAmount) : undefined,
				reference_no: referenceNo || undefined, reference_date: referenceNo ? new Date().toISOString().slice(0, 10) : undefined,
				remarks: remarks || undefined, idempotency_key: idempotencyKey.current,
			});
			const created = unwrapVunaResponse<PaymentResult>(response);
			setResult(created);
			idempotencyKey.current = crypto.randomUUID();
			setAmount(""); setInvoice(""); setReferenceNo(""); setRemarks("");
			await detailsCall.mutate();
		} catch (err) { setError(err instanceof Error ? err.message : "Failed to receive payment"); }
	}

	return <section className="min-h-0 flex-1 overflow-y-auto border-t border-outline-variant bg-surface p-4 pb-[84px] lg:pb-4"><div className="mx-auto flex max-w-4xl flex-col gap-4">
		<div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Receive customer payment</h2><p className="text-sm text-on-surface-variant">Allocate a receipt to an invoice or leave it as a customer advance.</p></div><Button variant="ghost" onClick={() => navigateToPosPage("Home")}>Back to POS</Button></div>
		{!isOnline ? <div className="rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">Payments are online-only. Reconnect before receiving money.</div> : null}
		{result ? <div className="rounded-md border border-secondary bg-secondary-container p-3 text-sm text-on-secondary-container">Payment Entry {result.name} was submitted successfully.</div> : null}
		{error || detailsError ? <div className="rounded-md border border-error bg-error-container p-3 text-sm text-on-error-container">{error || detailsError}</div> : null}
		<div className="grid gap-4 rounded-lg border border-outline-variant p-4 md:grid-cols-2">
			<div className="md:col-span-2"><label className="text-sm font-medium">Customer</label>{customer && details ? <div className="mt-2 flex items-center justify-between rounded-md bg-surface-container-low p-3"><div><p className="font-medium">{details.customer.customer_name}</p><p className="text-xs text-on-surface-variant">Balance {money(details.balance, details.customer.currency || currency)}</p></div><Button variant="ghost" onClick={() => { setCustomer(""); setInvoice(""); }}>Change</Button></div> : <><label className="mt-2 flex items-center gap-2 rounded-md border border-outline-variant px-3"><Search className="size-4"/><input className="flex-1 bg-transparent py-2 outline-none" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer"/></label><div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-outline-variant">{customerSearch.customers.map((row) => <button key={row.customer} className="block w-full border-t border-outline-variant px-3 py-2 text-left text-sm first:border-t-0 hover:bg-surface-container-low" onClick={() => { setCustomer(row.customer); setQuery(""); }}>{row.customer_name}<span className="ml-2 text-xs text-on-surface-variant">{row.mobile_no || row.customer}</span></button>)}</div></>}</div>
			<label className="text-sm font-medium">Apply to invoice<select className="mt-2 w-full rounded-md border border-outline-variant bg-surface px-3 py-2" value={invoice} onChange={(event) => { const next = event.target.value; setInvoice(next); setAmount(next ? String(outstandingInvoices.find((row) => row.name === next)?.outstanding_amount || "") : ""); }} disabled={!customer}><option value="">Customer advance / unallocated</option>{outstandingInvoices.map((row) => <option key={row.name} value={row.name}>{row.name} — {money(row.outstanding_amount, row.currency)}</option>)}</select></label>
			<label className="text-sm font-medium">Mode of Payment<select className="mt-2 w-full rounded-md border border-outline-variant bg-surface px-3 py-2" value={mode} onChange={(event) => setMode(event.target.value)}>{paymentModes.map((row) => <option key={row.mode_of_payment}>{row.mode_of_payment}</option>)}</select></label>
			<label className="text-sm font-medium">Amount<input type="number" min="0" step="0.01" className="mt-2 w-full rounded-md border border-outline-variant bg-surface px-3 py-2" value={displayedAmount} onChange={(event) => setAmount(event.target.value)}/></label>
			<label className="text-sm font-medium">External reference (optional)<input className="mt-2 w-full rounded-md border border-outline-variant bg-surface px-3 py-2" value={referenceNo} onChange={(event) => setReferenceNo(event.target.value)}/></label>
			<label className="text-sm font-medium md:col-span-2">Remarks (optional)<textarea className="mt-2 w-full rounded-md border border-outline-variant bg-surface px-3 py-2" value={remarks} onChange={(event) => setRemarks(event.target.value)}/></label>
			<Button className="md:col-span-2" disabled={!isOnline || createCall.loading || !customer} onClick={submit}><CreditCard className="mr-2 size-4"/>{createCall.loading ? "Submitting..." : invoice ? "Receive and allocate payment" : "Receive customer advance"}</Button>
		</div>
	</div></section>;
}

function money(value: number, currency?: string | null) { return new Intl.NumberFormat(undefined, { style: currency ? "currency" : "decimal", currency: currency || undefined }).format(value); }
