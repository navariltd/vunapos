import { useCallback, useEffect, useMemo, useState } from "react";
import { useFrappeGetCall, useFrappePostCall } from "frappe-react-sdk";

import type { CustomerDTO } from "../types";
import { createCustomer, unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";

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

	const response = useFrappeGetCall<unknown>(
		vunaMethods.searchCustomers,
		{ query: debouncedQuery, limit: 12 },
		["vunapos_customers", debouncedQuery],
	);

	const { customers, searchError } = useMemo(() => {
		if (!response.data) {
			return { customers: createdCustomers, searchError: null };
		}
		try {
			const rows = unwrapVunaResponse<CustomerDTO[]>(response.data);
			const merged = [...createdCustomers];
			for (const row of rows) {
				if (!merged.some((created) => created.customer === row.customer)) {
					merged.push(row);
				}
			}
			return { customers: merged, searchError: null };
		} catch (err) {
			console.error(err);
			return {
				customers: createdCustomers,
				searchError: err instanceof Error ? err.message : "Failed to search customers",
			};
		}
	}, [createdCustomers, response.data]);

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
		error: createError || searchError || response.error?.message || null,
		isCreating,
		isLoading: query !== debouncedQuery || response.isLoading,
		search: response.mutate,
	};
}
