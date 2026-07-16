import { useCallback, useEffect, useMemo, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";
import { useLiveQuery } from "dexie-react-hooks";

import type { CustomerDTO } from "../types";
import { createCustomer, vunaMethods } from "../../../services/vunaApi";
import { customerRepository } from "../../../lib/repositories/customerRepository";

// Search is local (Dexie), never network. Creating a customer still requires
// connectivity - master data is server-authoritative and there's no offline
// create/reconcile flow yet, so offline sales fall back to the default walk-in customer.
export function useCustomerSearch(query: string) {
	const createCall = useFrappePostCall(vunaMethods.createCustomer);
	const [isCreating, setIsCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [createdCustomers, setCreatedCustomers] = useState<CustomerDTO[]>([]);
	const [debouncedQuery, setDebouncedQuery] = useState(query);

	useEffect(() => {
		const timeout = window.setTimeout(() => {
			setDebouncedQuery(query);
		}, 300);

		return () => window.clearTimeout(timeout);
	}, [query]);

	const cachedCustomers = useLiveQuery(() => customerRepository.search(debouncedQuery, 20), [debouncedQuery]);

	const customers = useMemo(() => {
		const merged = [...createdCustomers];
		for (const row of cachedCustomers ?? []) {
			if (!merged.some((created) => created.customer === row.customer)) {
				merged.push(row as CustomerDTO);
			}
		}
		return merged;
	}, [cachedCustomers, createdCustomers]);

	const create = useCallback(
		async (params: { customer_name: string; mobile_no?: string; email_id?: string }) => {
			setIsCreating(true);
			setCreateError(null);
			try {
				const customer = await createCustomer(createCall.call, params);
				setCreatedCustomers((current) => [
					customer,
					...current.filter((row) => row.customer !== customer.customer),
				]);
				return customer;
			} catch (err) {
				console.error(err);
				setCreateError(err instanceof Error ? err.message : "Failed to create customer");
				throw err;
			} finally {
				setIsCreating(false);
			}
		},
		[createCall.call],
	);

	return {
		create,
		customers,
		error: createError,
		isCreating,
		isLoading: query !== debouncedQuery || cachedCustomers === undefined,
		search: () => {},
	};
}
