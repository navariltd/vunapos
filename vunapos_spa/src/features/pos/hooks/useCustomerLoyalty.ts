import { useEffect, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import type { CustomerLoyaltyDTO } from "../types";
import { getCustomerLoyalty, vunaMethods } from "../../../services/vunaApi";

export function useCustomerLoyalty(customer?: string, posProfile?: string, isOnline = true) {
	const call = useFrappePostCall(vunaMethods.getCustomerLoyalty);
	const requestKey = customer && posProfile && isOnline ? `${posProfile}:${customer}` : null;
	const [result, setResult] = useState<{
		key: string;
		data: CustomerLoyaltyDTO | null;
		error: string | null;
	} | null>(null);

	useEffect(() => {
		let active = true;
		if (!requestKey || !customer || !posProfile) return () => { active = false; };
		void getCustomerLoyalty(call.call, { customer, pos_profile: posProfile })
			.then((loyalty) => {
				if (active) setResult({ key: requestKey, data: loyalty, error: null });
			})
			.catch((requestError: unknown) => {
				if (!active) return;
				setResult({
					key: requestKey,
					data: null,
					error: requestError instanceof Error ? requestError.message : "Loyalty balance is unavailable.",
				});
			});

		return () => { active = false; };
	}, [call.call, customer, posProfile, requestKey]);

	if (!requestKey) return { data: null, error: null, isLoading: false };
	return {
		data: result?.key === requestKey ? result.data : null,
		error: result?.key === requestKey ? result.error : null,
		isLoading: result?.key !== requestKey,
	};
}
