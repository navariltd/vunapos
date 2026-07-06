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

	const data = useMemo(() => {
		if (!response.data) {
			return null;
		}
		try {
			return unwrapVunaResponse<BootstrapData>(response.data);
		} catch (err) {
			console.error(err);
			return null;
		}
	}, [response.data]);

	const parseError = useMemo(() => {
		if (!response.data) {
			return null;
		}
		try {
			unwrapVunaResponse<BootstrapData>(response.data);
			return null;
		} catch (err) {
			return err instanceof Error ? err.message : "Failed to load POS bootstrap data";
		}
	}, [response.data]);

	const error = parseError || response.error?.message || null;

	return {
		data,
		error,
		isLoading: response.isLoading,
		reload: response.mutate,
	};
}
