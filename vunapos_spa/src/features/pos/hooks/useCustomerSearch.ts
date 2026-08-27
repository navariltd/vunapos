import { useCallback, useEffect, useMemo, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import type { CustomerDTO } from "../types";
import { createCustomer, searchCustomers, vunaMethods } from "../../../services/vunaApi";
import { customerRepository } from "../../../lib/repositories/customerRepository";
import { useRuntimeCacheStore } from "../../../lib/stores/runtimeCacheStore";

// Search the current server-hydrated in-memory customer snapshot. Creating a customer
// remains server-authoritative and requires connectivity.
export function useCustomerSearch(query: string, posProfile?: string) {
	const createCall = useFrappePostCall(vunaMethods.createCustomer);
	const searchCall = useFrappePostCall(vunaMethods.searchCustomers);
	const [isCreating, setIsCreating] = useState(false);
	const [createError, setCreateError] = useState<string | null>(null);
	const [createdCustomers, setCreatedCustomers] = useState<CustomerDTO[]>([]);
	const [debouncedQuery, setDebouncedQuery] = useState(query);
	const [cachedCustomers, setCachedCustomers] = useState<CustomerDTO[]>();
	const revision = useRuntimeCacheStore((state) => state.revision);

	useEffect(() => {
		const timeout = window.setTimeout(() => {
			setDebouncedQuery(query);
		}, 300);

		return () => window.clearTimeout(timeout);
	}, [query]);

	useEffect(() => {
		let cancelled = false;
		void customerRepository.search(debouncedQuery, 20).then(async (rows) => {
			if (rows.length || !debouncedQuery.trim() || !posProfile) return rows;
			try {
				return await searchCustomers(
					searchCall.call,
					{ query: debouncedQuery, limit: 20 },
				);
			} catch {
				return rows;
			}
		}).then((rows) => {
			if (!cancelled) setCachedCustomers(rows as CustomerDTO[]);
		});
		return () => { cancelled = true; };
	}, [debouncedQuery, posProfile, revision, searchCall.call]);

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
				const customer = await createCustomer(createCall.call, { ...params, pos_profile: posProfile });
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
		[createCall.call, posProfile],
	);

	return {
		create,
		customers,
		error: createError,
		isCreating,
		isLoading: query !== debouncedQuery || cachedCustomers === undefined,
		search: () => { },
	};
}
