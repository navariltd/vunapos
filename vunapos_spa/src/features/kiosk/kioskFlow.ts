import type { CachedServiceType } from "../../lib/types";
import { newOrderDraft, type OrderDraft } from "../restaurant/orderDraft";
import type { KioskOrderDTO } from "../restaurant/types";

// The customer's path through the kiosk: start, service type, a table for dine-in,
// the menu and cart, a review, then the confirmation with the order number.
export type KioskStep = "start" | "service" | "table" | "menu" | "review" | "done";

export type KioskState = {
	step: KioskStep;
	service: CachedServiceType | null;
	draft: OrderDraft | null;
	placed: KioskOrderDTO | null;
};

export const KIOSK_START: KioskState = { step: "start", service: null, draft: null, placed: null };

// How long the "Still there?" prompt waits before the kiosk starts over.
export const IDLE_WARNING_SECONDS = 15;
// How long the confirmation stays up before the next customer's start screen.
export const DONE_SECONDS = 20;

export function startOrder(services: CachedServiceType[], posProfile: string, newKey: () => string): KioskState {
	// With one service type there is nothing to choose.
	const state: KioskState = { ...KIOSK_START, step: "service" };
	return services.length === 1 ? chooseService(state, services[0], posProfile, newKey) : state;
}

export function chooseService(
	state: KioskState,
	service: CachedServiceType,
	posProfile: string,
	newKey: () => string,
): KioskState {
	const draft = newOrderDraft({ pos_profile: posProfile, service_type: service.name, idempotency_key: newKey() });
	return { ...state, service, draft, step: service.requires_table ? "table" : "menu" };
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

// One step back. The cart is kept, except when going back past the service type,
// which with a single service type means the start screen.
export function back(state: KioskState, serviceCount: number): KioskState {
	const serviceStep: KioskState = serviceCount > 1 ? { ...KIOSK_START, step: "service" } : KIOSK_START;
	switch (state.step) {
		case "review":
			return { ...state, step: "menu" };
		case "menu":
			return state.service?.requires_table ? { ...state, step: "table" } : serviceStep;
		case "table":
			return serviceStep;
		default:
			return KIOSK_START;
	}
}

export function placed(state: KioskState, order: KioskOrderDTO): KioskState {
	return { ...state, placed: order, step: "done" };
}

// The idle prompt only matters while a customer is part-way through an order.
export function tracksIdle(step: KioskStep): boolean {
	return step !== "start" && step !== "done";
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
