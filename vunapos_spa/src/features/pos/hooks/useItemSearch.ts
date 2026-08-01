import { useEffect, useState } from "react";

import type { ItemDTO } from "../types";
import { itemRepository } from "../../../lib/repositories/itemRepository";
import { profileRepository } from "../../../lib/repositories/profileRepository";
import { useRuntimeCacheStore } from "../../../lib/stores/runtimeCacheStore";

// Search the current server-hydrated in-memory catalogue without a request per keypress.
// Reloading the application starts empty and requires a fresh server bootstrap.
export function useItemSearch(query: string) {
	const [debouncedQuery, setDebouncedQuery] = useState(query);
	const [items, setItems] = useState<ItemDTO[]>();
	const revision = useRuntimeCacheStore((state) => state.revision);

	useEffect(() => {
		const timeout = window.setTimeout(() => {
			setDebouncedQuery(query);
		}, 300);

		return () => window.clearTimeout(timeout);
	}, [query]);

	useEffect(() => {
		void profileRepository.getActive().then((profile) =>
			itemRepository.search(debouncedQuery, 60, {
				hideUnavailable: Boolean(profile?.hide_unavailable_items),
			}),
		).then((rows) => setItems(rows as ItemDTO[]));
	}, [debouncedQuery, revision]);

	return {
		error: null as string | null,
		isLoading: query !== debouncedQuery || items === undefined,
		items: (items ?? []) as ItemDTO[],
		reload: () => { },
	};
}
