import { useFrappeGetCall } from "frappe-react-sdk";

import { unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";
import type { BootstrapData, POSSessionDTO } from "../types";

// Opening-entry state changes independently of catalogue data, so it always uses a
// dedicated live server request.
export function usePosSessionStatus(posProfile: string | undefined) {
	const response = useFrappeGetCall<unknown>(
		vunaMethods.getBootstrapData,
		{ pos_profile: posProfile },
		posProfile ? ["vunapos_session_status", posProfile] : null,
	);

	let session: POSSessionDTO | undefined;
	let error: string | null = null;
	if (response.data) {
		try {
			session = unwrapVunaResponse<BootstrapData>(response.data).session;
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to load POS session status";
		}
	}

	return {
		session,
		error: error || response.error?.message || null,
		isLoading: response.isLoading,
		reload: response.mutate,
	};
}
