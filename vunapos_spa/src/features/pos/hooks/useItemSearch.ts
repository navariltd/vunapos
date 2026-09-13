import { useEffect, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import type { ItemDTO } from "../types";
import { itemRepository } from "../../../lib/repositories/itemRepository";
import { profileRepository } from "../../../lib/repositories/profileRepository";
import { useRuntimeCacheStore } from "../../../lib/stores/runtimeCacheStore";
import { searchItems } from "../../../services/vunaApi";

// Search the current server-hydrated in-memory catalogue without a request per keypress.
// Reloading the application starts empty and requires a fresh server bootstrap.
export function useItemSearch(query: string) {
	const searchCall = useFrappePostCall("vunapos.api.item.search_items");
	const [debouncedQuery, setDebouncedQuery] = useState(query);
	const [items, setItems] = useState<ItemDTO[]>();
	const revision = useRuntimeCacheStore((state) => state.revision);
	const catalogueReady = useRuntimeCacheStore((state) => state.catalogueReady);

	useEffect(() => {
		const timeout = window.setTimeout(() => {
			setDebouncedQuery(query);
		}, 300);

		return () => window.clearTimeout(timeout);
	}, [query]);

	useEffect(() => {
		let cancelled = false;
		void profileRepository.getActive().then(async (profile) => {
			const localRows = await itemRepository.search(debouncedQuery, 60, {
				hideUnavailable: Boolean(profile?.hide_unavailable_items),
			});
			// Normal item/name searches stay entirely in the hydrated catalogue. Use
			// the server only when the local catalogue cannot resolve the query,
			// which is the common case for serial and batch identifiers.
			if (!debouncedQuery.trim() || !profile?.name || localRows.length) return localRows;
			try {
				const serverRows = await searchItems(searchCall.call, {
					query: debouncedQuery,
					pos_profile: profile.name,
					limit: 60,
				});
				const visibleServerRows = profile.hide_unavailable_items
					? serverRows.filter((row) => {
						const isUnavailable = Boolean(row.is_stock_item ?? true)
							&& !row.allow_negative_stock
							&& Number(row.actual_qty || 0) <= 0;
						return !isUnavailable;
					})
					: serverRows;
				const merged = new Map(
					[...localRows, ...visibleServerRows].map((row) => [row.item_code, row]),
				);
				return Array.from(merged.values()).slice(0, 60);
			} catch {
				return localRows;
			}
		}).then((rows) => {
			if (!cancelled) setItems(rows as ItemDTO[]);
		});
		return () => { cancelled = true; };
	}, [debouncedQuery, revision, searchCall.call]);

	return {
		error: null as string | null,
		isLoading: query !== debouncedQuery || items === undefined || (!catalogueReady && items.length === 0),
		items: (items ?? []) as ItemDTO[],
		reload: () => { },
	};
}
