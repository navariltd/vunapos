import { create } from "zustand";

type RuntimeCacheStore = {
	revision: number;
	touch: () => void;
};

export const useRuntimeCacheStore = create<RuntimeCacheStore>((set) => ({
	revision: 0,
	touch: () => set((state) => ({ revision: state.revision + 1 })),
}));
