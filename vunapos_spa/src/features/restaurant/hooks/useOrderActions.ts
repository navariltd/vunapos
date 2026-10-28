import { useCallback, useState } from "react";
import { useFrappePostCall } from "frappe-react-sdk";

import {
	VunaApiError,
	addRestaurantOrderItems,
	createRestaurantOrder,
	getRestaurantOrder,
	previewRestaurantOrder,
	updateRestaurantOrder,
	updateRestaurantOrderItem,
	vunaMethods,
} from "../../../services/vunaApi";
import { planSave, withServerOrder, type SaveStep } from "../orderDraft";
import { describeOrderError, type OrderErrorView } from "../orderErrors";
import { useOrderDraftStore } from "../stores/orderDraftStore";
import type { OrderPreviewDTO, RestaurantOrderDTO } from "../types";

export type SaveResult = { ok: boolean; created: RestaurantOrderDTO | null };

// Loading, saving and previewing the order in the draft store. Save sends the
// planned steps one by one; after each success the draft is rebuilt from the
// server's order, so a failure part-way leaves only the unsent part pending.
export function useOrderActions({ onMenuChanged }: { onMenuChanged?: () => void } = {}) {
	const createCall = useFrappePostCall(vunaMethods.createRestaurantOrder);
	const updateCall = useFrappePostCall(vunaMethods.updateRestaurantOrder);
	const addCall = useFrappePostCall(vunaMethods.addRestaurantOrderItems);
	const updateItemCall = useFrappePostCall(vunaMethods.updateRestaurantOrderItem);
	const getCall = useFrappePostCall(vunaMethods.getRestaurantOrder);
	const previewCall = useFrappePostCall(vunaMethods.previewRestaurantOrder);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<OrderErrorView | null>(null);

	const runStep = useCallback(
		(step: SaveStep): Promise<RestaurantOrderDTO> => {
			switch (step.kind) {
				case "create":
					return createRestaurantOrder(createCall.call, step.params);
				case "update_order":
					return updateRestaurantOrder(updateCall.call, step.params);
				case "add_items":
					return addRestaurantOrderItems(addCall.call, step.params);
				case "update_item":
					return updateRestaurantOrderItem(updateItemCall.call, step.params);
			}
		},
		[addCall.call, createCall.call, updateCall.call, updateItemCall.call],
	);

	const load = useCallback(
		async (order: string) => {
			const loaded = await getRestaurantOrder(getCall.call, order);
			const { draft, setDraft } = useOrderDraftStore.getState();
			// Pending changes carry over only for the same order: a new order's lines
			// never leak into an existing one (that's mergeIntoOrder's job).
			setDraft(withServerOrder(draft?.order?.name === loaded.name ? draft : null, loaded));
			return loaded;
		},
		[getCall.call],
	);

	// Sends the draft. A new order's create step leaves the draft as it is and returns
	// the created order, so the screen can reset to the next new order.
	const save = useCallback(async (): Promise<SaveResult> => {
		const store = useOrderDraftStore.getState();
		if (!store.draft) return { ok: false, created: null };
		const steps = planSave(store.draft);
		if (!steps.length) return { ok: true, created: null };
		setSaving(true);
		setError(null);
		let changed = false;
		try {
			for (const step of steps) {
				const order = await runStep(step);
				changed = true;
				if (step.kind === "create") return { ok: true, created: order };
				const current = useOrderDraftStore.getState().draft;
				useOrderDraftStore.getState().setDraft(withServerOrder(current, order));
			}
			return { ok: true, created: null };
		} catch (caught) {
			const view = describeOrderError(caught instanceof VunaApiError ? caught : (caught as Error));
			if (view.action === "reload-menu") {
				// Take the item off the waiting lines, then offer the current menu.
				if (view.itemCode) {
					useOrderDraftStore.getState().updateDraft((draft) => ({
						...draft,
						unsent: draft.unsent.filter((line) => line.item_code !== view.itemCode),
					}));
				}
				onMenuChanged?.();
			}
			if (view.action === "reload-order") {
				const name = useOrderDraftStore.getState().draft?.order?.name;
				if (name) await load(name).catch(() => undefined);
			}
			setError(view);
			return { ok: false, created: null };
		} finally {
			setSaving(false);
			if (changed) useOrderDraftStore.getState().markOrdersChanged();
		}
	}, [load, onMenuChanged, runStep]);

	const preview = useCallback(
		(order: string): Promise<OrderPreviewDTO> => previewRestaurantOrder(previewCall.call, order),
		[previewCall.call],
	);

	return { save, load, preview, saving, error, clearError: () => setError(null) };
}
