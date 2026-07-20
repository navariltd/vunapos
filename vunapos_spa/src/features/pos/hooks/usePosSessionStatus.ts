import { useEffect } from "react";
import { useFrappeGetCall } from "frappe-react-sdk";

import { cachePosSession } from "../../../lib/cacheEngine";
import type { CachedPosSession } from "../../../lib/types";
import { unwrapVunaResponse, vunaMethods } from "../../../services/vunaApi";
import type { BootstrapData, POSSessionDTO } from "../types";

// Whether today's POS Opening Entry exists can't be trusted from the offline cache
// (it changes the moment a cashier opens/closes their till, unlike items/customers/
// tax templates) - this is its own small, always-live fetch, same shape as
// useThemeSync.ts's read path, kept separate from useBootstrapData.ts on purpose.
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

	useEffect(() => {
		if (
			session?.cashier &&
			session.pos_profile &&
			session.status &&
			typeof session.ready === "boolean"
		) {
			void cachePosSession(session as CachedPosSession);
		}
	}, [session]);

	return {
		session,
		error: error || response.error?.message || null,
		isLoading: response.isLoading,
		reload: response.mutate,
	};
}
