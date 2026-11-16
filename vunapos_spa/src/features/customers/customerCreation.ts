import type { CustomerDTO } from "../pos/types";

// There is no sale to attach a customer to on the Customers page: a new customer,
// or the existing one chosen instead of a duplicate, is opened, and the list
// reloads behind it.
export function openCustomerFromSheet(
	customer: Pick<CustomerDTO, "customer">,
	refresh: () => unknown,
	open: (customer: string) => void,
) {
	void refresh();
	open(customer.customer);
}
