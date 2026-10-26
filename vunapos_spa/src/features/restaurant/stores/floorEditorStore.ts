import { create } from "zustand";

import { VunaApiError, saveFloorPlan, type FrappeCall } from "../../../services/vunaApi";
import {
	addElement,
	addFloor,
	addTable,
	duplicateItem,
	findErrorTarget,
	moveFloor,
	remapAfterSave,
	removeItem,
	removeUnsavedFloor,
	toDraft,
	toSavePayload,
	updateFloor,
	updateItem,
	type DraftFloor,
	type FloorPlanDraft,
	type ItemPatch,
	type Selection,
} from "../floorPlanDraft";
import type { FloorElementType, FloorPlanDTO } from "../types";

export type SaveError = { message: string; code?: string };

type FloorEditorState = {
	posProfile: string | null;
	version: string;
	original: FloorPlanDraft | null;
	draft: FloorPlanDraft | null;
	activeFloorKey: string | null;
	selection: Selection;
	snap: boolean;
	saving: boolean;
	saveError: SaveError | null;
	conflict: boolean;
};

type FloorEditorActions = {
	load: (plan: FloorPlanDTO) => void;
	reset: () => void;
	setActiveFloor: (floorKey: string) => void;
	select: (selection: Selection) => void;
	setSnap: (snap: boolean) => void;
	addFloor: () => void;
	updateFloor: (floorKey: string, patch: Partial<Pick<DraftFloor, "floor_name" | "is_active" | "background_color">>) => void;
	moveFloor: (floorKey: string, direction: -1 | 1) => void;
	removeUnsavedFloor: (floorKey: string) => void;
	addTable: () => void;
	addElement: (elementType: FloorElementType) => void;
	duplicateSelection: () => void;
	deleteSelection: () => void;
	updateSelected: (patch: ItemPatch) => void;
	updateItem: (selection: Selection, patch: ItemPatch) => void;
	dismissError: () => void;
	// Mutations take the API call as an argument, like cartStore's CartApi, so
	// this store stays free of React and the SDK.
	save: (call: FrappeCall) => Promise<boolean>;
};

const initialState: FloorEditorState = {
	posProfile: null,
	version: "",
	original: null,
	draft: null,
	activeFloorKey: null,
	selection: null,
	snap: true,
	saving: false,
	saveError: null,
	conflict: false,
};

export const useFloorEditorStore = create<FloorEditorState & FloorEditorActions>((set, get) => {
	const edit = (update: (draft: FloorPlanDraft) => FloorPlanDraft) => {
		const { draft } = get();
		if (draft) set({ draft: update(draft), saveError: null });
	};

	return {
		...initialState,
		load: (plan) => {
			const loaded = toDraft(plan);
			const keepFloor = get().activeFloorKey;
			set({
				posProfile: plan.pos_profile,
				version: plan.version,
				original: loaded,
				draft: loaded,
				activeFloorKey: loaded.floors.some((floor) => floor.key === keepFloor)
					? keepFloor
					: loaded.floors[0]?.key ?? null,
				selection: null,
				saving: false,
				saveError: null,
				conflict: false,
			});
		},
		reset: () => set({ ...initialState, snap: get().snap }),
		setActiveFloor: (activeFloorKey) => set({ activeFloorKey, selection: null }),
		select: (selection) => set({ selection }),
		setSnap: (snap) => set({ snap }),
		addFloor: () => {
			const { draft } = get();
			if (!draft) return;
			const result = addFloor(draft);
			set({ draft: result.draft, activeFloorKey: result.key, selection: null, saveError: null });
		},
		updateFloor: (floorKey, patch) => edit((draft) => updateFloor(draft, floorKey, patch)),
		moveFloor: (floorKey, direction) => edit((draft) => moveFloor(draft, floorKey, direction)),
		removeUnsavedFloor: (floorKey) => {
			const { draft, activeFloorKey } = get();
			if (!draft) return;
			const next = removeUnsavedFloor(draft, floorKey);
			set({
				draft: next,
				activeFloorKey: activeFloorKey === floorKey ? next.floors[0]?.key ?? null : activeFloorKey,
				selection: null,
			});
		},
		addTable: () => {
			const { draft, activeFloorKey } = get();
			if (!draft || !activeFloorKey) return;
			const result = addTable(draft, activeFloorKey);
			set({ draft: result.draft, selection: result.selection, saveError: null });
		},
		addElement: (elementType) => {
			const { draft, activeFloorKey } = get();
			if (!draft || !activeFloorKey) return;
			const result = addElement(draft, activeFloorKey, elementType);
			set({ draft: result.draft, selection: result.selection, saveError: null });
		},
		duplicateSelection: () => {
			const { draft, selection } = get();
			if (!draft || !selection) return;
			const result = duplicateItem(draft, selection);
			set({ draft: result.draft, selection: result.selection, saveError: null });
		},
		deleteSelection: () => {
			const { selection } = get();
			if (!selection) return;
			edit((draft) => removeItem(draft, selection));
			set({ selection: null });
		},
		updateSelected: (patch) => {
			const { selection } = get();
			edit((draft) => updateItem(draft, selection, patch));
		},
		updateItem: (selection, patch) => edit((draft) => updateItem(draft, selection, patch)),
		dismissError: () => set({ saveError: null, conflict: false }),
		save: async (call) => {
			const { draft, version, posProfile, selection, activeFloorKey } = get();
			if (!draft || !posProfile || get().saving) return false;
			set({ saving: true, saveError: null, conflict: false });
			try {
				const result = await saveFloorPlan(call, {
					pos_profile: posProfile,
					payload: toSavePayload(draft, version),
				});
				const saved = toDraft(result.plan);
				const remapped = remapAfterSave(draft, saved, result, selection, activeFloorKey);
				set({
					version: result.plan.version,
					original: saved,
					draft: saved,
					selection: remapped.selection,
					activeFloorKey: remapped.activeFloorKey,
					saving: false,
				});
				return true;
			} catch (error) {
				const apiError = error instanceof VunaApiError ? error : null;
				const message = error instanceof Error ? error.message : "The floor plan could not be saved.";
				if (apiError?.code === "FLOOR_PLAN_CONFLICT") {
					set({ saving: false, conflict: true });
					return false;
				}
				// Point the editor at the floor or row the server rejected, if it says which.
				const target = findErrorTarget(draft, apiError?.meta);
				set({
					saving: false,
					saveError: { message, code: apiError?.code },
					...(target ? { activeFloorKey: target.floorKey, selection: target.selection } : {}),
				});
				return false;
			}
		},
	};
});
