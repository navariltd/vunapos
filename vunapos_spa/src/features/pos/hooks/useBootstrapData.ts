import { useEffect, useMemo, useState } from "react";
import { useFrappeAuth } from "frappe-react-sdk";

import { toBootstrapData } from "../bootstrapData";
import type { BootstrapData } from "../types";
import { applyDelta } from "../../../lib/cacheEngine";
import { profileRepository } from "../../../lib/repositories/profileRepository";
import type { CachedProfile } from "../../../lib/types";
import { useRuntimeCacheStore } from "../../../lib/stores/runtimeCacheStore";

// The POS profile comes from the process-local read store and updates whenever
// a successful server bootstrap refreshes that store.
export function useBootstrapData() {
	const revision = useRuntimeCacheStore((state) => state.revision);
	const [profile, setProfile] = useState<CachedProfile>();
	const { currentUser } = useFrappeAuth();

	useEffect(() => {
		void profileRepository.getActive().then(setProfile);
	}, [revision]);

	const data = useMemo<BootstrapData | null>(() => {
		if (!profile) {
			return null;
		}
		return toBootstrapData(profile, currentUser);
	}, [profile, currentUser]);

	return {
		data,
		error: null as string | null,
		isLoading: profile === undefined,
		reload: () => applyDelta(),
	};
}
