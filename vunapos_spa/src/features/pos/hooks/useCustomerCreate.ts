import { useCallback, useEffect, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import type { CustomerCreateOptionsDTO, CustomerDTO, CustomerMatchesDTO } from "../types";
import { emptyCustomerForm, type CreateCustomerParams, type CustomerCreateForm } from "../customerCreate";
import {
	createCustomer,
	findCustomerMatches,
	getCustomerCreateOptions,
	vunaMethods,
} from "../../../services/vunaApi";
import { customerRepository } from "../../../lib/repositories/customerRepository";
import { useRuntimeCacheStore } from "../../../lib/stores/runtimeCacheStore";

// The POS create form in both modes. Creation stays server-authoritative;
// the new customer is written to the local store so search finds it at once.
export function useCustomerCreate(posProfile: string | undefined, draft: Partial<CustomerCreateForm>, enabled = true) {
	const optionsCall = useFrappePostCall(vunaMethods.getCustomerCreateOptions);
	const matchesCall = useFrappePostCall(vunaMethods.findCustomerMatches);
	const createCall = useFrappePostCall(vunaMethods.createCustomer);
	const [options, setOptions] = useState<CustomerCreateOptionsDTO | null>(null);
	const [optionsError, setOptionsError] = useState<string | null>(null);
	// Results are kept with the input they answer, so stale lookups never show.
	const [lookup, setLookup] = useState<{ key: string; data: CustomerMatchesDTO | null } | null>(null);

	useEffect(() => {
		if (!enabled || options) return;
		let cancelled = false;
		getCustomerCreateOptions(optionsCall.call, { pos_profile: posProfile })
			.then((data) => {
				if (!cancelled) setOptions(data);
			})
			.catch((caught) => {
				if (!cancelled)
					setOptionsError(caught instanceof Error ? caught.message : "Unable to load customer options.");
			});
		return () => {
			cancelled = true;
		};
	}, [enabled, options, optionsCall.call, posProfile]);

	// Type and country come from the server until the user picks their own.
	const form: CustomerCreateForm = { ...emptyCustomerForm(options), ...draft };
	const name = form.customer_name.trim();
	const mobile = form.mobile_no.trim();
	const country = form.mobile_country;
	const lookupKey = enabled && (mobile || name.length >= 2) ? JSON.stringify([name, mobile, country]) : "";
	useEffect(() => {
		if (!lookupKey) return;
		let cancelled = false;
		const timeout = window.setTimeout(() => {
			findCustomerMatches(matchesCall.call, {
				pos_profile: posProfile,
				customer_name: name,
				mobile_no: mobile || undefined,
				mobile_country: mobile ? country || undefined : undefined,
			})
				.then((data) => {
					if (!cancelled) setLookup({ key: lookupKey, data });
				})
				.catch(() => {
					if (!cancelled) setLookup({ key: lookupKey, data: null });
				});
		}, 350);
		return () => {
			cancelled = true;
			window.clearTimeout(timeout);
		};
	}, [lookupKey, name, mobile, country, matchesCall.call, posProfile]);
	const matches = lookupKey && lookup?.key === lookupKey ? lookup.data : null;
	const isChecking = Boolean(lookupKey) && lookup?.key !== lookupKey;

	const create = useCallback(
		async (params: CreateCustomerParams): Promise<CustomerDTO> => {
			const customer = await createCustomer(createCall.call, params);
			const modified = (customer as CustomerDTO & { modified?: string }).modified;
			await customerRepository.put({ ...customer, modified: modified || new Date().toISOString() });
			useRuntimeCacheStore.getState().touch();
			return customer;
		},
		[createCall.call],
	);

	return { form, options, optionsError, matches, isChecking, create };
}
