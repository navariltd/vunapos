import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import type { ItemDTO } from "../types";
import { unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";

export function useItemSearch(query: string, posProfile?: string, customer?: string) {
	const [debouncedQuery, setDebouncedQuery] = useState(query);

	useEffect(() => {
		const timeout = window.setTimeout(() => {
			setDebouncedQuery(query);
		}, 300);

		return () => window.clearTimeout(timeout);
	}, [query]);

	const response = useFrappeGetCall<unknown>(
		vunaMethods.searchItems,
		{ query: debouncedQuery, pos_profile: posProfile, customer },
		["vunapos_items", debouncedQuery, posProfile || "", customer || ""],
	);

	const { error, items } = useMemo(() => {
		if (!response.data) {
			return { error: null, items: [] };
		}
		try {
			const items = unwrapVunaResponse<ItemDTO[]>(response.data);
			if (!Array.isArray(items)) {
				return { error: "Failed to search items", items: [] };
			}
			return { error: null, items };
		} catch (err) {
			console.error(err);
			return {
				error: err instanceof Error ? err.message : "Failed to search items",
				items: [],
			};
		}
	}, [response.data]);

	return {
		error: error || response.error?.message || null,
		isLoading: query !== debouncedQuery || response.isLoading,
		items,
		reload: response.mutate,
	};
}
