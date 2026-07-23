import { useMemo } from "react";
import { useFrappeAuth } from "frappe-react-sdk";
import { useLiveQuery } from "dexie-react-hooks";

import type { BootstrapData } from "../types";
import { applyDelta } from "../../../lib/cacheEngine";
import { profileRepository } from "../../../lib/repositories/profileRepository";

//  The POS profile comes from the local cache, reactively
// (useLiveQuery re-renders the moment the Cache Engine writes a fresher profile)
export function useBootstrapData() {
	const profile = useLiveQuery(() => profileRepository.getActive());
	const { currentUser } = useFrappeAuth();

	const data = useMemo<BootstrapData | null>(() => {
		if (!profile) {
			return null;
		}
		return {
			current_user: currentUser || undefined,
			pos_profile: profile.name,
			company: profile.company,
			warehouse: profile.warehouse,
			price_list: profile.price_list,
			currency: profile.currency,
			currency_precision: profile.currency_precision,
			default_customer: profile.default_customer as BootstrapData["default_customer"],
			modes_of_payment: profile.modes_of_payment,
			print_format: profile.print_format,
			invoice_mode: profile.invoice_mode,
		};
	}, [profile, currentUser]);

	return {
		data,
		error: null as string | null,
		isLoading: profile === undefined,
		reload: () => applyDelta(),
	};
}
