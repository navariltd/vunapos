import type { CachedServiceType } from "../../lib/types";
import type { OrderLineInput, RestaurantOrderDTO } from "./types";

// An order being taken on this device. `order` is what the server last returned
// (null until the first save); everything else is waiting to be sent with Save.
export const MAX_NOTE_LENGTH = 500;

export type UnsentLine = {
	line_id: string;
	item_code: string;
	item_name: string;
	uom?: string;
	qty: number;
	note: string;
};

// Pending changes to a line already on the order. Quantity may only go up: lowering
// it removes items, which follows the removal rules (stage 2).
export type SentLineEdit = { qty?: number; note?: string };

// Guests (pax) are not asked for: the server keeps its default.
export type OrderHeader = {
	customer: string | null;
	customer_name: string | null;
	order_note: string;
};

export type OrderDraft = {
	order: RestaurantOrderDTO | null;
	pos_profile: string;
	// Null until chosen when the profile has no default service type.
	service_type: string | null;
	table: string | null;
	table_label: string | null;
	// Sent with create_order, so a retried first save returns the same order.
	idempotency_key: string;
	// The saved header (or the starting values of a new order), plus local edits
	// waiting to be sent. Edits are kept apart so a reload never overwrites someone
	// else's change with a stale local copy.
	header: OrderHeader;
	headerEdits: Partial<OrderHeader>;
	unsent: UnsentLine[];
	edits: Record<string, SentLineEdit>;
};

export function newOrderDraft(params: {
	pos_profile: string;
	service_type?: string | null;
	table?: string | null;
	table_label?: string | null;
	customer?: string | null;
	customer_name?: string | null;
	idempotency_key: string;
}): OrderDraft {
	return {
		order: null,
		pos_profile: params.pos_profile,
		service_type: params.service_type ?? null,
		table: params.table ?? null,
		table_label: params.table_label ?? null,
		idempotency_key: params.idempotency_key,
		header: {
			customer: params.customer ?? null,
			customer_name: params.customer_name ?? null,
			order_note: "",
		},
		headerEdits: {},
		unsent: [],
		edits: {},
	};
}

function headerFromOrder(order: RestaurantOrderDTO): OrderHeader {
	return {
		customer: order.customer,
		customer_name: order.customer_name,
		order_note: order.order_note || "",
	};
}

// Rebuilds the draft from a server order, keeping only the changes still waiting.
export function withServerOrder(draft: OrderDraft | null, order: RestaurantOrderDTO): OrderDraft {
	const savedIds = new Set(order.items.map((line) => line.line_id));
	const keepPending = draft?.order?.name === order.name || (draft !== null && draft.order === null);
	const edits: Record<string, SentLineEdit> = {};
	if (keepPending && draft) {
		for (const [lineId, edit] of Object.entries(draft.edits)) {
			const line = order.items.find((row) => row.line_id === lineId);
			if (!line) continue;
			const pending = trimEdit(edit, line.qty, line.note || "");
			if (pending) edits[lineId] = pending;
		}
	}
	return {
		order,
		pos_profile: order.pos_profile,
		service_type: order.service_type,
		table: order.table,
		table_label: order.table_label,
		idempotency_key: draft?.idempotency_key ?? "",
		header: headerFromOrder(order),
		headerEdits: keepPending && draft ? trimHeaderEdits(draft.headerEdits, headerFromOrder(order)) : {},
		unsent: keepPending && draft ? draft.unsent.filter((line) => !savedIds.has(line.line_id)) : [],
		edits,
	};
}

function sameHeaderValue<K extends keyof OrderHeader>(key: K, a: OrderHeader[K], b: OrderHeader[K]) {
	if (key === "order_note") return String(a ?? "").trim() === String(b ?? "").trim();
	if (key === "customer" || key === "customer_name") return (a || null) === (b || null);
	return a === b;
}

// Drops edits that match the base header (already saved, or changed back).
function trimHeaderEdits(edits: Partial<OrderHeader>, base: OrderHeader): Partial<OrderHeader> {
	const pending: Partial<OrderHeader> = {};
	for (const key of Object.keys(edits) as Array<keyof OrderHeader>) {
		if (key === "customer_name") continue;
		const value = edits[key];
		if (value === undefined || sameHeaderValue(key, value, base[key])) continue;
		Object.assign(pending, { [key]: value });
		if (key === "customer") pending.customer_name = edits.customer_name ?? null;
	}
	return pending;
}

export function effectiveHeader(draft: OrderDraft): OrderHeader {
	return { ...draft.header, ...draft.headerEdits };
}

function trimEdit(edit: SentLineEdit, serverQty: number, serverNote: string): SentLineEdit | null {
	const pending: SentLineEdit = {};
	if (edit.qty !== undefined && edit.qty > serverQty) pending.qty = edit.qty;
	if (edit.note !== undefined && edit.note !== serverNote) pending.note = edit.note;
	return Object.keys(pending).length ? pending : null;
}

// ---- editing ----

export function addMenuItem(
	draft: OrderDraft,
	item: { item_code: string; item_name: string; uom?: string },
	newLineId: () => string,
): OrderDraft {
	// Taps on the same item add to its waiting line, unless that line has a note
	// (a different instruction gets its own line).
	const existing = draft.unsent.find((line) => line.item_code === item.item_code && !line.note);
	if (existing) {
		return setUnsentQty(draft, existing.line_id, existing.qty + 1);
	}
	return {
		...draft,
		unsent: [
			...draft.unsent,
			{ line_id: newLineId(), item_code: item.item_code, item_name: item.item_name, uom: item.uom, qty: 1, note: "" },
		],
	};
}

export function setUnsentQty(draft: OrderDraft, lineId: string, qty: number): OrderDraft {
	const value = Math.max(1, Math.floor(qty) || 1);
	return { ...draft, unsent: draft.unsent.map((line) => (line.line_id === lineId ? { ...line, qty: value } : line)) };
}

export function setUnsentNote(draft: OrderDraft, lineId: string, note: string): OrderDraft {
	const value = note.slice(0, MAX_NOTE_LENGTH);
	return { ...draft, unsent: draft.unsent.map((line) => (line.line_id === lineId ? { ...line, note: value } : line)) };
}

export function removeUnsent(draft: OrderDraft, lineId: string): OrderDraft {
	return { ...draft, unsent: draft.unsent.filter((line) => line.line_id !== lineId) };
}

function sentLine(draft: OrderDraft, lineId: string) {
	return draft.order?.items.find((line) => line.line_id === lineId);
}

// The quantity shown for a sent line: its pending increase, else the saved quantity.
export function sentQty(draft: OrderDraft, lineId: string): number {
	return draft.edits[lineId]?.qty ?? sentLine(draft, lineId)?.qty ?? 0;
}

export function sentNote(draft: OrderDraft, lineId: string): string {
	return draft.edits[lineId]?.note ?? sentLine(draft, lineId)?.note ?? "";
}

// Never below the saved quantity (see SentLineEdit).
export function setSentQty(draft: OrderDraft, lineId: string, qty: number): OrderDraft {
	const line = sentLine(draft, lineId);
	if (!line) return draft;
	const value = Math.max(line.qty, Math.floor(qty) || line.qty);
	return withEdit(draft, lineId, { ...draft.edits[lineId], qty: value }, line.qty, line.note || "");
}

export function setSentNote(draft: OrderDraft, lineId: string, note: string): OrderDraft {
	const line = sentLine(draft, lineId);
	if (!line) return draft;
	const value = note.slice(0, MAX_NOTE_LENGTH);
	return withEdit(draft, lineId, { ...draft.edits[lineId], note: value }, line.qty, line.note || "");
}

function withEdit(draft: OrderDraft, lineId: string, edit: SentLineEdit, serverQty: number, serverNote: string) {
	const edits = { ...draft.edits };
	const pending = trimEdit(edit, serverQty, serverNote);
	if (pending) edits[lineId] = pending;
	else delete edits[lineId];
	return { ...draft, edits };
}

export function setHeader(draft: OrderDraft, patch: Partial<OrderHeader>): OrderDraft {
	const clean = { ...patch };
	if (clean.order_note !== undefined) clean.order_note = clean.order_note.slice(0, MAX_NOTE_LENGTH);
	return { ...draft, headerEdits: trimHeaderEdits({ ...draft.headerEdits, ...clean }, draft.header) };
}

// Before the first save, the order context can still change (a saved order's
// service type and table are fixed until table transfer, stage 2).
export function setContext(
	draft: OrderDraft,
	context: { service_type: string | null; table: string | null; table_label: string | null },
): OrderDraft {
	if (draft.order) return draft;
	return { ...draft, ...context };
}

// Switching to a type without tables clears the table.
export function chooseServiceType(draft: OrderDraft, serviceType: CachedServiceType): OrderDraft {
	return setContext(draft, {
		service_type: serviceType.name,
		table: serviceType.requires_table ? draft.table : null,
		table_label: serviceType.requires_table ? draft.table_label : null,
	});
}

export function chooseTable(draft: OrderDraft, table: { name: string; table_label: string }): OrderDraft {
	return setContext(draft, { service_type: draft.service_type, table: table.name, table_label: table.table_label });
}

export function removeUnsentLines(draft: OrderDraft, lineIds: Iterable<string>): OrderDraft {
	const drop = new Set(lineIds);
	return { ...draft, unsent: draft.unsent.filter((line) => !drop.has(line.line_id)) };
}

// The profile's default service type, if it has one.
export function defaultServiceType(serviceTypes: CachedServiceType[]): CachedServiceType | null {
	return serviceTypes.find((row) => row.is_default) ?? null;
}

export type SendBlocker = "needs-service-type" | "needs-table" | null;

// What must be chosen before a new order can be sent. A saved order has both.
export function sendBlocker(draft: OrderDraft, serviceTypes: CachedServiceType[]): SendBlocker {
	if (draft.order) return null;
	const serviceType = serviceTypes.find((row) => row.name === draft.service_type);
	if (!serviceType) return "needs-service-type";
	if (serviceType.requires_table && !draft.table) return "needs-table";
	return null;
}

export type MergeResult = {
	draft: OrderDraft;
	// Set when both orders have a note: the target's is kept and the draft's dropped.
	droppedNote: string | null;
};

// "Add to this order": the lines being built move onto an open order, keeping
// their line ids (so a retried send can't add them twice). The target's customer
// is kept; the draft's note is sent only when the target has none.
export function mergeIntoOrder(draft: OrderDraft, target: RestaurantOrderDTO): MergeResult {
	const base = withServerOrder(null, target);
	const note = effectiveHeader(draft).order_note.trim();
	const targetNote = (target.order_note || "").trim();
	const merged: OrderDraft = { ...base, idempotency_key: draft.idempotency_key, unsent: draft.unsent };
	if (!note || note === targetNote) return { draft: merged, droppedNote: null };
	if (!targetNote) return { draft: setHeader(merged, { order_note: note }), droppedNote: null };
	return { draft: merged, droppedNote: note };
}

// ---- saving ----

export type SaveStep =
	| {
			kind: "create";
			params: {
				pos_profile: string;
				service_type: string;
				table: string | null;
				customer: string | null;
				order_note: string | null;
				items: OrderLineInput[];
				idempotency_key: string;
			};
	  }
	| { kind: "update_order"; params: { order: string; customer?: string; order_note?: string } }
	| { kind: "add_items"; params: { order: string; items: OrderLineInput[] } }
	| { kind: "update_item"; params: { order: string; line_id: string; qty?: number; note?: string } };

function lineInput(line: UnsentLine): OrderLineInput {
	const input: OrderLineInput = { line_id: line.line_id, item_code: line.item_code, qty: line.qty };
	if (line.uom) input.uom = line.uom;
	if (line.note.trim()) input.note = line.note.trim();
	return input;
}

export function headerChanges(draft: OrderDraft) {
	if (!draft.order) return {};
	const edits = trimHeaderEdits(draft.headerEdits, draft.header);
	const changes: { customer?: string; order_note?: string } = {};
	// "" clears a field on the server.
	if (edits.customer !== undefined) changes.customer = edits.customer || "";
	if (edits.order_note !== undefined) changes.order_note = edits.order_note.trim();
	return changes;
}

// The calls Save makes, in order. Every one is safe to repeat: the idempotency
// key and line ids make the server ignore what it already has, and updates set values.
// A new order without a service type can't be planned yet (see sendBlocker).
export function planSave(draft: OrderDraft): SaveStep[] {
	if (!draft.order) {
		if (!draft.unsent.length || !draft.service_type) return [];
		const header = effectiveHeader(draft);
		return [
			{
				kind: "create",
				params: {
					pos_profile: draft.pos_profile,
					service_type: draft.service_type,
					table: draft.table,
					customer: header.customer,
					order_note: header.order_note.trim() || null,
					items: draft.unsent.map(lineInput),
					idempotency_key: draft.idempotency_key,
				},
			},
		];
	}
	const order = draft.order.name;
	const steps: SaveStep[] = [];
	const header = headerChanges(draft);
	if (Object.keys(header).length) steps.push({ kind: "update_order", params: { order, ...header } });
	if (draft.unsent.length) steps.push({ kind: "add_items", params: { order, items: draft.unsent.map(lineInput) } });
	for (const [lineId, edit] of Object.entries(draft.edits)) {
		const params: { order: string; line_id: string; qty?: number; note?: string } = { order, line_id: lineId };
		if (edit.qty !== undefined) params.qty = edit.qty;
		if (edit.note !== undefined) params.note = edit.note.trim();
		steps.push({ kind: "update_item", params });
	}
	return steps;
}

// Anything waiting to be sent. A new order's lines count even before its service
// type is chosen.
export function hasPendingChanges(draft: OrderDraft | null): boolean {
	if (!draft) return false;
	if (!draft.order) return draft.unsent.length > 0;
	return planSave(draft).length > 0;
}

export function unsentCount(draft: OrderDraft | null): number {
	return draft?.unsent.reduce((sum, line) => sum + line.qty, 0) ?? 0;
}

// How many of each item are on the order, sent and waiting, for the menu's "+" buttons.
export function itemQuantities(draft: OrderDraft | null): Map<string, number> {
	const result = new Map<string, number>();
	if (!draft) return result;
	const bump = (itemCode: string, qty: number) => result.set(itemCode, (result.get(itemCode) ?? 0) + qty);
	for (const line of draft.order?.items ?? []) bump(line.item_code, sentQty(draft, line.line_id));
	for (const line of draft.unsent) bump(line.item_code, line.qty);
	return result;
}

// Running subtotal from menu rates (before service charge and taxes). Lines whose
// item is not on the current menu are left out and reported.
export function draftSubtotal(draft: OrderDraft, rates: Map<string, number>): { amount: number; unpriced: number } {
	let amount = 0;
	let unpriced = 0;
	const add = (itemCode: string, qty: number) => {
		const rate = rates.get(itemCode);
		if (rate === undefined) unpriced += 1;
		else amount += rate * qty;
	};
	for (const line of draft.order?.items ?? []) add(line.item_code, sentQty(draft, line.line_id));
	for (const line of draft.unsent) add(line.item_code, line.qty);
	return { amount, unpriced };
}
