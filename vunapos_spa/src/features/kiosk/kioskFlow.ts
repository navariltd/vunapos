import type { CachedServiceType } from "../../lib/types";
import { newOrderDraft, type OrderDraft } from "../restaurant/orderDraft";
import type { KioskOrderDTO } from "../restaurant/types";

// The customer's path through the kiosk: the service type (the kiosk's home screen,
// skipped with only one), a table for dine-in, the menu and cart, a review, then the
// confirmation with the order number.
export type KioskStep = "service" | "table" | "menu" | "review" | "done";

// How the customer arrived. A future QR code on a table starts with that table chosen.
export type KioskEntry = { table?: { name: string; table_label: string } | null };

export type KioskState = {
	step: KioskStep;
	service: CachedServiceType | null;
	draft: OrderDraft | null;
	placed: KioskOrderDTO | null;
	entry: KioskEntry;
};

export const KIOSK_START: KioskState = { step: "service", service: null, draft: null, placed: null, entry: {} };

// How long the "Still there?" prompt waits before the kiosk starts over.
export const IDLE_WARNING_SECONDS = 15;
// How long the confirmation stays up before the kiosk returns to its home screen.
export const DONE_SECONDS = 20;

// The home screen for the next customer. With one service type there is nothing to
// choose, so it opens on that type straight away.
export function startOrder(
	services: CachedServiceType[],
	posProfile: string,
	newKey: () => string,
	entry: KioskEntry = {},
): KioskState {
	const state: KioskState = { ...KIOSK_START, entry };
	return services.length === 1 ? chooseService(state, services[0], posProfile, newKey) : state;
}

// Choosing (or switching) the service type. The cart is kept when switching, so a
// customer who started at a table can still change to takeaway. A table chosen on
// arrival skips the table step.
export function chooseService(
	state: KioskState,
	service: CachedServiceType,
	posProfile: string,
	newKey: () => string,
): KioskState {
	const preset = service.requires_table ? state.entry.table : null;
	const draft = {
		...newOrderDraft({
			pos_profile: posProfile,
			service_type: service.name,
			table: preset?.name,
			table_label: preset?.table_label,
			idempotency_key: newKey(),
		}),
		unsent: state.draft?.unsent ?? [],
	};
	return { ...state, service, draft, step: service.requires_table && !preset ? "table" : "menu" };
}

export function chooseTable(state: KioskState, table: { name: string; table_label: string }): KioskState {
	if (!state.draft) return state;
	return { ...state, draft: { ...state.draft, table: table.name, table_label: table.table_label }, step: "menu" };
}

export function updateCart(state: KioskState, update: (draft: OrderDraft) => OrderDraft): KioskState {
	return state.draft ? { ...state, draft: update(state.draft) } : state;
}

export function cartQuantity(state: KioskState): number {
	return state.draft?.unsent.reduce((sum, line) => sum + line.qty, 0) ?? 0;
}

export function review(state: KioskState): KioskState {
	return cartQuantity(state) ? { ...state, step: "review" } : state;
}

// One step back. Going back to the service choice keeps the cart.
export function back(state: KioskState): KioskState {
	const serviceStep: KioskState = { ...state, step: "service" };
	switch (state.step) {
		case "review":
			return { ...state, step: "menu" };
		case "menu":
			return state.service?.requires_table && !state.entry.table ? { ...state, step: "table" } : serviceStep;
		case "table":
			return serviceStep;
		default:
			return state;
	}
}

export function placed(state: KioskState, order: KioskOrderDTO): KioskState {
	return { ...state, placed: order, step: "done" };
}

// The idle prompt only matters while a customer is part-way through an order: on the
// table step, or once something is in the cart.
export function tracksIdle(state: KioskState): boolean {
	if (state.step === "done") return false;
	return state.step === "table" || state.step === "review" || cartQuantity(state) > 0;
}

export type IdlePhase = "active" | "warning" | "expired";

export function idlePhase(idleMs: number, idleSeconds: number): IdlePhase {
	if (idleMs >= (idleSeconds + IDLE_WARNING_SECONDS) * 1000) return "expired";
	if (idleMs >= idleSeconds * 1000) return "warning";
	return "active";
}

export function idleSecondsLeft(idleMs: number, idleSeconds: number): number {
	return Math.max(0, Math.ceil(idleSeconds + IDLE_WARNING_SECONDS - idleMs / 1000));
}

// The cart's running subtotal from menu rates and paid choices, before taxes and charges.
// The review step shows the server's total.
export function kioskSubtotal(draft: OrderDraft | null, rates: Map<string, number>): number {
	return (draft?.unsent ?? []).reduce((sum, line) => {
		const extras = (line.modifiers ?? []).reduce((total, choice) => total + (choice.extra_rate || 0), 0);
		return sum + ((rates.get(line.item_code) ?? 0) + extras) * line.qty;
	}, 0);
}
