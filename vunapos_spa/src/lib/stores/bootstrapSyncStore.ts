import { create } from "zustand";

export type BootstrapPhase = "hydrating" | "ready" | "blocked";

type BootstrapSyncStore = {
	phase: BootstrapPhase;
	error: string | null;
	setPhase: (phase: BootstrapPhase) => void;
	setError: (error: string | null) => void;
};

// §10.1: Install -> Authenticate -> Bootstrap -> Verify -> Ready. Owned by
// useOfflineSync.ts's bootstrap sequencing effect; BootstrapGate.tsx reads it to
// decide whether to render the app, a loading screen, or the hard-block screen.
export const useBootstrapSyncStore = create<BootstrapSyncStore>((set) => ({
	phase: "hydrating",
	error: null,
	setPhase: (phase) => set({ phase }),
	setError: (error) => set({ error }),
}));
