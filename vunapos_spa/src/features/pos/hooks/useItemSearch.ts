import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import type { ItemDTO } from "../types";
import { unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";


export function useItemSearch(
	query: string,
	posProfile?: string,
	customer?: string,
	enabled = true,
) {
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const canLoadItems = Boolean(enabled && posProfile);


	useEffect(() => {
		const timer = window.setTimeout(() => {
			setDebouncedQuery(query.trim());
		}, 500);

		return () => clearTimeout(timer);
	}, [query]);


	const params = useMemo(() => {
		if (!canLoadItems || !posProfile) {
			return undefined;
		}

		return {
			query: debouncedQuery,
			pos_profile: posProfile,
			customer,
		};

	}, [
		canLoadItems,
		debouncedQuery,
		posProfile,
		customer,
	]);


	const {
		data,
		error,
		isLoading,
		isValidating,
		mutate,
	} = useFrappeGetCall(
		vunaMethods.searchItems,
		params,
		undefined,
		{
			dedupingInterval: 300000,
			revalidateOnFocus: false,
			errorRetryCount: 1,
		}
	);


	const items = useMemo(() => {
		if (!canLoadItems || !data) {
			return [];
		}

		try {
			const result = unwrapVunaResponse<ItemDTO[]>(data);
			return Array.isArray(result) ? result : [];
		} catch {
			// The API error is exposed through the hook's error value. Do not throw
			// during render, otherwise the POS setup dialog cannot be displayed.
			return [];
		}

	}, [canLoadItems, data]);


	return {
		items:items ?? [],

		error:
			canLoadItems && error instanceof Error
				? error.message
				: null,

		isLoading:
			canLoadItems && (query.trim() !== debouncedQuery || isLoading),

		isFetching: isValidating,

		reload: mutate,
	};
}
