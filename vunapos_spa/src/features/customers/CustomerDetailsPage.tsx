import { useFrappeGetCall } from "frappe-react-sdk";
import { ArrowLeft, CreditCard, MapPin, ReceiptText, ShoppingCart, UserRound } from "lucide-react";

import { Button } from "../../components/ui/Button";
import { navigateToCustomerPayment, navigateToPosPage } from "../../lib/stores/navigationStore";
import { unwrapVunaResponse, vunaMethods } from "../../services/vunaApi";
import type { CustomerDetailsDTO } from "../pos/types";

type Props = { customer: string; posProfile?: string; onStartSale: (customer: CustomerDetailsDTO["customer"]) => void };

function money(value: number, currency?: string | null) {
	return new Intl.NumberFormat(undefined, { style: currency ? "currency" : "decimal", currency: currency || undefined }).format(value);
}

const statusStyle: Record<string, string> = {
	Paid: "bg-secondary-container text-on-secondary-container",
	"Partly Paid": "bg-tertiary-container text-on-tertiary-container",
	Unpaid: "bg-surface-container-high text-on-surface",
	Overdue: "bg-error-container text-on-error-container",
	"Credit Note": "bg-primary-container text-on-primary-container",
};

export function CustomerDetailsPage({ customer, posProfile, onStartSale }: Props) {
	const response = useFrappeGetCall<unknown>(
		vunaMethods.getCustomerDetails,
		{ pos_profile: posProfile, customer },
		posProfile ? ["vunapos_customer_details", posProfile, customer] : null,
	);
	let details: CustomerDetailsDTO | null = null;
	let parseError: string | null = null;
	if (response.data) {
		try { details = unwrapVunaResponse<CustomerDetailsDTO>(response.data); }
		catch (error) { parseError = error instanceof Error ? error.message : "Unable to load customer"; }
	}
	if (response.isLoading) return <section className="flex flex-1 items-center justify-center"><p className="text-sm text-on-surface-variant">Loading customer details...</p></section>;
	const error = parseError || response.error?.message;
	if (error || !details) return <section className="flex flex-1 items-center justify-center p-6"><div className="max-w-md text-center"><p className="text-sm text-error">{error || "Customer not found"}</p><Button className="mt-3" variant="ghost" onClick={() => navigateToPosPage("Customers")}>Back to customers</Button></div></section>;

	const { customer: row } = details;
	const address = details.address;
	const contact = details.contact;
	return <section className="min-h-0 flex-1 overflow-y-auto border-t border-outline-variant bg-surface p-4 pb-[84px] lg:pb-4">
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex gap-3"><button className="mt-1 text-on-surface-variant" onClick={() => navigateToPosPage("Customers")} aria-label="Back to customers"><ArrowLeft className="size-5"/></button><div><h2 className="text-xl font-semibold text-on-surface">{row.customer_name}</h2><p className="text-sm text-on-surface-variant">{row.customer} · {row.customer_group || "Uncategorized"}</p></div></div>
				<div className="flex flex-wrap gap-2"><Button onClick={() => onStartSale(row)}><ShoppingCart className="mr-2 size-4"/>Start new sale</Button><Button variant="ghost" onClick={() => navigateToCustomerPayment(row.customer)}><CreditCard className="mr-2 size-4"/>Receive payment</Button></div>
			</div>

			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<Summary label="Current balance" value={money(details.balance, row.currency)} />
				<Summary label="Loyalty points" value={details.loyalty ? details.loyalty.points.toLocaleString() : "Not enrolled"} sub={details.loyalty?.tier || details.loyalty?.program} />
				<Summary label="Customer type" value={row.customer_type || "-"} sub={row.territory || undefined} />
				<Summary label="Last updated" value={formatDateTime(details.as_of)} />
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<div className="rounded-lg border border-outline-variant p-4"><h3 className="flex items-center gap-2 font-semibold"><UserRound className="size-4"/>Contact information</h3><div className="mt-3 space-y-2 text-sm"><p>{row.mobile_no || contact?.mobile_no || contact?.phone || "No phone number"}</p><p>{row.email_id || contact?.email_id || "No email address"}</p>{row.tax_id ? <p>Tax ID: {row.tax_id}</p> : null}</div></div>
				<div className="rounded-lg border border-outline-variant p-4"><h3 className="flex items-center gap-2 font-semibold"><MapPin className="size-4"/>Primary address</h3><div className="mt-3 text-sm text-on-surface-variant">{address ? <p>{[address.address_line1, address.address_line2, address.city, address.state, address.country, address.pincode].filter(Boolean).join(", ")}</p> : <p>No permitted primary address available.</p>}</div></div>
			</div>

			<div className="rounded-lg border border-outline-variant"><div className="border-b border-outline-variant px-4 py-3"><h3 className="flex items-center gap-2 font-semibold"><ReceiptText className="size-4"/>Recent invoices</h3></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-surface-container-low text-xs uppercase text-on-surface-variant"><tr><th className="px-4 py-3">Invoice</th><th>Date</th><th>Status</th><th>Total</th><th>Paid</th><th>Outstanding</th><th></th></tr></thead><tbody>{details.invoices.length ? details.invoices.map((invoice) => <tr key={invoice.name} className="border-t border-outline-variant"><td className="px-4 py-3 font-medium">{invoice.name}</td><td>{formatDate(invoice.posting_date)}</td><td><span className={`rounded-full px-2 py-1 text-xs font-medium ${statusStyle[invoice.status] || ""}`}>{invoice.status}</span></td><td>{money(invoice.grand_total, invoice.currency)}</td><td>{money(invoice.paid_amount, invoice.currency)}</td><td>{money(invoice.outstanding_amount, invoice.currency)}</td><td><a className="text-primary hover:underline" href={`/app/${invoice.doctype.toLowerCase().replaceAll(" ", "-")}/${encodeURIComponent(invoice.name)}`} target="_blank" rel="noreferrer">View</a></td></tr>) : <tr><td colSpan={7} className="p-6 text-center text-on-surface-variant">No submitted invoices available.</td></tr>}</tbody></table></div></div>

			<div className="rounded-lg border border-outline-variant"><div className="border-b border-outline-variant px-4 py-3"><h3 className="flex items-center gap-2 font-semibold"><CreditCard className="size-4"/>Recent payments</h3></div>{details.payments.length ? details.payments.map((payment) => <div key={payment.name} className="grid gap-2 border-t border-outline-variant px-4 py-3 text-sm first:border-t-0 sm:grid-cols-[1.3fr_1fr_1fr_1fr]"><div><p className="font-medium">{payment.name}</p><p className="text-xs text-on-surface-variant">{formatDate(payment.posting_date)}</p></div><p>{payment.mode_of_payment || "Unspecified"}</p><p>{money(payment.received_amount, row.currency)}</p><p className="text-on-surface-variant">Unallocated {money(payment.unallocated_amount, row.currency)}</p></div>) : <p className="p-6 text-center text-sm text-on-surface-variant">No permitted Payment Entries available.</p>}</div>
		</div>
	</section>;
}

function Summary({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
	return <div className="rounded-lg border border-outline-variant bg-surface-container-low p-4"><p className="text-xs uppercase text-on-surface-variant">{label}</p><p className="mt-1 font-semibold text-on-surface">{value}</p>{sub ? <p className="mt-1 text-xs text-on-surface-variant">{sub}</p> : null}</div>;
}

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

function formatDateTime(value?: string) {
	const time = formatTime(value);
	return time ? `${formatDate(value)} ${time}` : formatDate(value);
}
