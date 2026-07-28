import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import type { ItemDTO } from "../types";
import { itemRepository } from "../../../lib/repositories/itemRepository";

// Read-path cutover (P5, I3): item search never touches the network - it's a Dexie
// prefix/substring query against the last-synced catalog (useItemSearch's job is
// speed and offline availability; freshness is the Cache Engine's job, separately).
// develop's useFrappeGetCall/SWR version (customer/pos_profile-aware server search)
// was superseded by this cutover rather than merged - the two are incompatible
// (one requires a network round trip, the other must work with zero connectivity)
// and offline availability is this branch's whole point.
//
// KNOWN GAP: pricing offline is the item's cached bootstrap rate (default-customer
// pricing) - selecting a different customer with a distinct price list will not
// re-price offline the way the previous online-only flow did. See invoiceEngine.ts.
export function useItemSearch(query: string) {
	const [debouncedQuery, setDebouncedQuery] = useState(query);

	useEffect(() => {
		const timeout = window.setTimeout(() => {
			setDebouncedQuery(query);
		}, 300);

		return () => window.clearTimeout(timeout);
	}, [query]);

	const items = useLiveQuery(() => itemRepository.search(debouncedQuery, 60), [debouncedQuery]);

	return {
		error: null as string | null,
		isLoading: query !== debouncedQuery || items === undefined,
		items: (items ?? []) as ItemDTO[],
		reload: () => {},
	};
}
