import { newOrderDraft, type OrderDraft } from "../restaurant/orderDraft";
import type { QrOrderStatus, TableOrderResultDTO } from "../restaurant/types";

// A guest's path after scanning a table's QR code: the menu and cart, a review, then
// the sent order's status until staff accept or reject it. The table and service type
// come from the code; the guest never chooses them.
export type TableOrderStep = "menu" | "review" | "sent";

export type TableOrderState = {
	step: TableOrderStep;
	draft: OrderDraft;
	sent: TableOrderResultDTO | null;
};

// How often a sent order's status is checked while staff have not answered.
export const STATUS_POLL_SECONDS = 10;

const TABLE_PATH = /^\/vunapos\/table\/([A-Za-z0-9_-]{20,100})\/?$/;

export function tableTokenFromPath(pathname: string): string | null {
	return pathname.match(TABLE_PATH)?.[1] ?? null;
}

export function startTableOrder(serviceType: string, newKey: () => string): TableOrderState {
	return {
		step: "menu",
		draft: newOrderDraft({ pos_profile: "", service_type: serviceType, idempotency_key: newKey() }),
		sent: null,
	};
}

export function updateTableCart(state: TableOrderState, update: (draft: OrderDraft) => OrderDraft): TableOrderState {
	return state.step === "sent" ? state : { ...state, draft: update(state.draft) };
}

export function tableCartQuantity(state: TableOrderState): number {
	return state.draft.unsent.reduce((sum, line) => sum + line.qty, 0);
}

export function reviewTableOrder(state: TableOrderState): TableOrderState {
	return state.step === "menu" && tableCartQuantity(state) ? { ...state, step: "review" } : state;
}

export function backToMenu(state: TableOrderState): TableOrderState {
	return state.step === "review" ? { ...state, step: "menu" } : state;
}

export function tableOrderSent(state: TableOrderState, result: TableOrderResultDTO): TableOrderState {
	return { ...state, step: "sent", sent: result };
}

// A refresh keeps showing the sent order's status, never its contents.
export function resumeSentOrder(state: TableOrderState, sent: TableOrderResultDTO | null): TableOrderState {
	return sent ? { ...state, step: "sent", sent } : state;
}

export function withStatus(state: TableOrderState, status: QrOrderStatus): TableOrderState {
	return state.sent ? { ...state, sent: { ...state.sent, status } } : state;
}

export const SENT_MESSAGE: Record<QrOrderStatus, { title: string; detail: string }> = {
	Pending: { title: "Order sent", detail: "A waiter will confirm it shortly." },
	Accepted: { title: "Your order has been accepted", detail: "It is on its way to the kitchen. Ask a waiter if you would like anything else." },
	Rejected: { title: "Your order could not be accepted", detail: "Sorry, the restaurant could not accept this order. Please ask a waiter." },
};

export function sentOrderStorageKey(token: string): string {
	return `vunapos_table_order:${token}`;
}

export function parseSentOrder(value: string | null): TableOrderResultDTO | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value) as Partial<TableOrderResultDTO>;
		return typeof parsed.order === "string" && parsed.status && parsed.status in SENT_MESSAGE
			? { order: parsed.order, status: parsed.status }
			: null;
	} catch {
		return null;
	}
}
