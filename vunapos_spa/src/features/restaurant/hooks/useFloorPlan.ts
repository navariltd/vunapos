import { useCallback, useEffect, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import type { FloorPlanDTO } from "../types";
import { VunaApiError, getFloorPlan, vunaMethods } from "../../../services/vunaApi";

// The floor plan is online-only reference data, so it is loaded directly
// rather than through the in-memory catalogue repositories.
export function useFloorPlan(posProfile?: string) {
	const call = useFrappePostCall(vunaMethods.getFloorPlan);
	const [revision, setRevision] = useState(0);
	const requestKey = posProfile ? `${posProfile}:${revision}` : null;
	const [result, setResult] = useState<{
		key: string;
		plan: FloorPlanDTO | null;
		error: string | null;
		errorCode: string | null;
	} | null>(null);

	useEffect(() => {
		let active = true;
		if (!requestKey || !posProfile) return () => { active = false; };
		void getFloorPlan(call.call, posProfile)
			.then((plan) => {
				if (active) setResult({ key: requestKey, plan, error: null, errorCode: null });
			})
			.catch((requestError: unknown) => {
				if (!active) return;
				setResult({
					key: requestKey,
					plan: null,
					error: requestError instanceof Error ? requestError.message : "The floor plan could not be loaded.",
					errorCode: requestError instanceof VunaApiError ? requestError.code || null : null,
				});
			});
		return () => { active = false; };
	}, [call.call, posProfile, requestKey]);

	const reload = useCallback(() => setRevision((current) => current + 1), []);
	const current = result?.key === requestKey ? result : null;

	return {
		// While a reload is in flight, keep showing the previous plan.
		plan: current ? current.plan : (result?.plan ?? null),
		error: current?.error ?? null,
		errorCode: current?.errorCode ?? null,
		isLoading: Boolean(requestKey) && !current,
		reload,
	};
}
