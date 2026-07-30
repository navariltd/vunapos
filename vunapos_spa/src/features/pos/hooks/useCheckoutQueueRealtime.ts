import { useFrappeEventListener } from "frappe-react-sdk";

export const CHECKOUT_QUEUE_EVENT = "vunapos_checkout_queue_changed";

export type CheckoutQueueChangeEvent = {
	invoice_doctype: string;
	invoice_name: string;
	pos_profile?: string;
	opening_entry?: string;
	status: "Queued" | "Processing" | "Submitted" | "Failed" | "Requires Review" | "Cancelled";
	attempts: number;
	error?: string;
};

export function useCheckoutQueueRealtime(
	onChange: (event: CheckoutQueueChangeEvent) => void,
) {
	useFrappeEventListener<CheckoutQueueChangeEvent>(CHECKOUT_QUEUE_EVENT, onChange);
}
