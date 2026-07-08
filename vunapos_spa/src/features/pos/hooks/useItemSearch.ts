import { useEffect, useMemo, useState } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import type { ItemDTO } from "../types";
import { unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";


export function useItemSearch(
	query: string,
	posProfile?: string,
	customer?: string
) {
	const [debouncedQuery, setDebouncedQuery] = useState("");


	useEffect(() => {
		const timer = window.setTimeout(() => {
			setDebouncedQuery(query.trim());
		}, 500);

		return () => clearTimeout(timer);
	}, [query]);


	const shouldSearch = debouncedQuery.length >= 2;


	const params = useMemo(() => {
		if (!shouldSearch) {
			return undefined;
		}

		return {
			query: debouncedQuery,
			pos_profile: posProfile,
			customer,
		};

	}, [
		shouldSearch,
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
		const result = unwrapVunaResponse<ItemDTO[]>(data);

		return Array.isArray(result)
			? result
			: [];

	}, [data]);


	return {
		items,

		error:
			error instanceof Error
				? error.message
				: null,

		isLoading:
			query.trim() !== debouncedQuery ||
			isLoading,

		isFetching: isValidating,

		reload: mutate,
	};
}