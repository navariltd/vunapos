import { create } from "zustand";

type RuntimeCacheStore = {
	revision: number;
	catalogueReady: boolean;
	touch: () => void;
	markCatalogueReady: () => void;
};

export const useRuntimeCacheStore = create<RuntimeCacheStore>((set) => ({
	revision: 0,
	catalogueReady: false,
	touch: () => set((state) => ({ revision: state.revision + 1 })),
	markCatalogueReady: () => set((state) => ({ revision: state.revision + 1, catalogueReady: true })),
}));
