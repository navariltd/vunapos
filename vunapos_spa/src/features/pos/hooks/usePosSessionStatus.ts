import { useFrappeGetCall } from "frappe-react-sdk";

import { unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";
import type { BootstrapData, POSSessionDTO } from "../types";

// Opening-entry state changes independently of catalogue data, so it always uses a
// dedicated live server request.
export function usePosSessionStatus(posProfile: string | undefined, user?: string) {
	const response = useFrappeGetCall<unknown>(
		vunaMethods.getBootstrapData,
		{ pos_profile: posProfile },
		posProfile ? ["vunapos_session_status", user || "current-user", posProfile] : null,
		{ revalidateOnMount: true, keepPreviousData: false },
	);

	let session: POSSessionDTO | undefined;
	let error: string | null = null;
	if (response.data) {
		try {
			session = unwrapVunaResponse<BootstrapData>(response.data).session;
			if (session && (session.pos_profile !== posProfile || (user && session.cashier !== user))) {
				session = undefined;
				error = "The session response does not match the selected user and POS Profile.";
			}
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
