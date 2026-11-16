import { useEffect, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import type { CustomerDTO } from "../types";
import { searchCustomers, vunaMethods } from "../../../services/vunaApi";
import { customerRepository } from "../../../lib/repositories/customerRepository";
import { profileRepository } from "../../../lib/repositories/profileRepository";
import { useRuntimeCacheStore } from "../../../lib/stores/runtimeCacheStore";

// Search the current server-hydrated in-memory customer snapshot. New customers are
// written to it by useCustomerCreate, so they are found at once.
export function useCustomerSearch(query: string, posProfile?: string) {
	const searchCall = useFrappePostCall(vunaMethods.searchCustomers);
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
		void profileRepository.getActive().then(async (profile) => {
			const rows = await customerRepository.search(debouncedQuery, 20, profile?.customer_groups);
			if (rows.length || !debouncedQuery.trim() || !posProfile) return rows;
			try {
				return await searchCustomers(
					searchCall.call,
					{ query: debouncedQuery, limit: 20, pos_profile: posProfile },
				);
			} catch {
				return rows;
			}
		}).then((rows) => {
			if (!cancelled) setCachedCustomers(rows as CustomerDTO[]);
		});
		return () => { cancelled = true; };
	}, [debouncedQuery, posProfile, revision, searchCall.call]);

	return {
		customers: cachedCustomers ?? [],
		isLoading: query !== debouncedQuery || cachedCustomers === undefined,
		search: () => { },
	};
}
