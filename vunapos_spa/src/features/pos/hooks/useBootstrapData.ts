import { useMemo } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import type { BootstrapData } from "../types";
import { unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";

export function useBootstrapData(posProfile?: string) {
	const response = useFrappeGetCall<unknown>(
		vunaMethods.getBootstrapData,
		{ pos_profile: posProfile },
		["vunapos_bootstrap", posProfile || ""],
	);

	const parsedResponse = useMemo(() => {
		if (!response.data) {
			return { data: null, error: null };
		}
		try {
			return { data: unwrapVunaResponse<BootstrapData>(response.data), error: null };
		} catch (err) {
			return {
				data: null,
				error: err instanceof Error ? err.message : "Failed to load POS bootstrap data",
			};
		}
	}, [response.data]);

	const error = parsedResponse.error || response.error?.message || null;

	return {
		data: parsedResponse.data,
		error,
		isLoading: response.isLoading,
		reload: response.mutate,
	};
}
