import { VunaApiError } from "../../services/vunaApi";
import type { CustomerCreateOptionsDTO, CustomerDTO, CustomerMatchesDTO } from "./types";

export type CustomerCreateForm = {
	customer_name: string;
	customer_type: string;
	mobile_country: string;
	mobile_no: string;
	email_id: string;
};

export type CreateCustomerParams = {
	customer_name: string;
	customer_type: string;
	mobile_country?: string;
	mobile_no?: string;
	email_id?: string;
	pos_profile?: string;
};

export type CustomerCreateResult =
	| { status: "created"; customer: CustomerDTO }
	| { status: "error"; message: string; field?: string };

export function emptyCustomerForm(
	options?: CustomerCreateOptionsDTO | null,
	customerName = "",
): CustomerCreateForm {
	return {
		customer_name: customerName,
		customer_type: options?.default_customer_type || options?.customer_types[0] || "",
		mobile_country: options?.default_country || "",
		mobile_no: "",
		email_id: "",
	};
}

// Typing keeps only what a phone number can contain; the server normalises it.
export function cleanPhoneInput(value: string) {
	return value.replace(/[^\d+\-()\s]/g, "").slice(0, 25);
}

export function countryIsd(options: CustomerCreateOptionsDTO | null | undefined, country: string) {
	return options?.countries.find((row) => row.country === country)?.isd || "";
}

export function buildCreateCustomerParams(form: CustomerCreateForm, posProfile?: string): CreateCustomerParams {
	const mobile = form.mobile_no.trim();
	const email = form.email_id.trim();
	return {
		customer_name: form.customer_name.trim(),
		customer_type: form.customer_type,
		...(mobile ? { mobile_no: mobile, mobile_country: form.mobile_country || undefined } : {}),
		...(email ? { email_id: email } : {}),
		pos_profile: posProfile,
	};
}

// With a mobile number, customers who already have it are shown; without one,
// customers with a similar name. Both are warnings: saving stays allowed, because
// ERPNext keeps numbers on Contacts that can link to several customers.
export function customerSuggestions(form: CustomerCreateForm, matches?: CustomerMatchesDTO | null) {
	if (!matches) return { kind: "none" as const, customers: [] as CustomerDTO[] };
	if (form.mobile_no.trim()) {
		return matches.mobile_matches.length
			? { kind: "mobile" as const, customers: matches.mobile_matches }
			: { kind: "none" as const, customers: [] as CustomerDTO[] };
	}
	return matches.similar.length
		? { kind: "similar" as const, customers: matches.similar }
		: { kind: "none" as const, customers: [] as CustomerDTO[] };
}

export function canSaveCustomer(form: CustomerCreateForm, busy = false) {
	return !busy && Boolean(form.customer_name.trim()) && Boolean(form.customer_type);
}

export function saveCustomerLabel(form: CustomerCreateForm, matches?: CustomerMatchesDTO | null, busy = false) {
	if (busy) return "Saving…";
	return customerSuggestions(form, matches).kind === "mobile" ? "Create anyway" : "Save customer";
}

export async function submitCustomerCreate(
	form: CustomerCreateForm,
	posProfile: string | undefined,
	create: (params: CreateCustomerParams) => Promise<CustomerDTO>,
	onCreated: (customer: CustomerDTO) => void | Promise<void>,
): Promise<CustomerCreateResult> {
	let customer: CustomerDTO;
	try {
		customer = await create(buildCreateCustomerParams(form, posProfile));
	} catch (caught) {
		return {
			status: "error",
			message: caught instanceof Error ? caught.message : "Unable to create the customer.",
			field: caught instanceof VunaApiError ? caught.field : undefined,
		};
	}
	// The customer exists now; selecting it reports its own errors on the order.
	try {
		await onCreated(customer);
	} catch {
		// Already shown where the customer is applied.
	}
	return { status: "created", customer };
}
