import { create } from "zustand";

import type { ModeOfPaymentDTO } from "../features/pos/types";

type ModesOfPaymentState = {
	posProfile: string | null;
	modesOfPayment: ModeOfPaymentDTO[];
	setModesOfPayment: (posProfile: string | null | undefined, modes: ModeOfPaymentDTO[]) => void;
};

export const useModesOfPaymentStore = create<ModesOfPaymentState>((set) => ({
	posProfile: null,
	modesOfPayment: [],
	setModesOfPayment: (posProfile, modes) =>
		set({
			posProfile: posProfile ?? null,
			modesOfPayment: modes,
		}),
}));
