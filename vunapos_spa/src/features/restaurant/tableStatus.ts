import type { CachedServiceType } from "../../lib/types";
import type { TableOrderRefDTO, TableStatusDTO } from "./types";

// Status kinds drawn on the floor. Colours come from design decision 13; later
// stages add "bill-requested", "in-kitchen", "served" and "reserved".
export type TableStatusKind = "free" | "occupied";

export const TABLE_STATUS_ORDER: readonly TableStatusKind[] = ["free", "occupied"];

export const TABLE_STATUS_LABEL: Record<TableStatusKind, string> = {
	free: "Free",
	occupied: "Occupied",
};

export type TableStatusView = {
	kind: TableStatusKind;
	orders: TableOrderRefDTO[];
	// Totals across the table's open orders.
	guests: number;
	// The earliest open order, which the time badge counts from.
	openedAt: string | null;
	// Distinct waiters on the table's open orders, in order of opening.
	waiters: string[];
};

const FREE: TableStatusView = { kind: "free", orders: [], guests: 0, openedAt: null, waiters: [] };

export function deriveTableStatuses(rows: TableStatusDTO[]): Map<string, TableStatusView> {
	const result = new Map<string, TableStatusView>();
	for (const row of rows) {
		if (row.status !== "Occupied" || !row.orders.length) {
			result.set(row.table, FREE);
			continue;
		}
		const orders = [...row.orders].sort((a, b) => a.opened_at.localeCompare(b.opened_at));
		const waiters: string[] = [];
		for (const order of orders) {
			const name = order.waiter_name || order.waiter;
			if (name && !waiters.includes(name)) waiters.push(name);
		}
		result.set(row.table, {
			kind: "occupied",
			orders,
			guests: orders.reduce((sum, order) => sum + (order.pax || 0), 0),
			openedAt: orders[0].opened_at,
			waiters,
		});
	}
	return result;
}

// A table missing from the status response (just added, or not loaded yet) is free.
export function statusFor(statuses: Map<string, TableStatusView>, table: string): TableStatusView {
	return statuses.get(table) ?? FREE;
}

// The legend lists only the statuses currently shown on the floor, in a fixed order.
export function legendStatuses(views: Iterable<TableStatusView>): TableStatusKind[] {
	const used = new Set<TableStatusKind>();
	for (const view of views) used.add(view.kind);
	return TABLE_STATUS_ORDER.filter((kind) => used.has(kind));
}

// Server datetimes are naive "YYYY-MM-DD HH:MM:SS[.ffffff]" in site time. The
// JavaScript date format allows at most milliseconds, so the microseconds go.
export function parseServerDatetime(value: string): Date {
	return new Date(value.replace(" ", "T").replace(/(\.\d{3})\d+$/, "$1"));
}

export function elapsedLabel(openedAt: string | null, now: Date): string | null {
	if (!openedAt) return null;
	const opened = parseServerDatetime(openedAt);
	if (Number.isNaN(opened.getTime())) return null;
	const minutes = Math.max(0, Math.floor((now.getTime() - opened.getTime()) / 60000));
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export type TableTapAction =
	| { kind: "start" }
	| { kind: "open"; order: string }
	| { kind: "choose"; orders: TableOrderRefDTO[] };

// Free: start an order on it. Occupied: open its order, or let the user choose when
// the profile allows several orders on one table.
export function tableTapAction(view: TableStatusView, allowMultipleOrders: boolean): TableTapAction {
	if (view.kind === "free" || !view.orders.length) return { kind: "start" };
	if (allowMultipleOrders) return { kind: "choose", orders: view.orders };
	return { kind: "open", order: view.orders[0].name };
}

// The service type for an order started by tapping a free table: the default when
// it uses tables, otherwise the first type (in display order) that does.
export function tableServiceType(serviceTypes: CachedServiceType[]): CachedServiceType | null {
	const ordered = [...serviceTypes].sort((a, b) => a.display_order - b.display_order);
	const fallback = ordered.find((row) => row.requires_table) ?? null;
	const preferred = ordered.find((row) => row.is_default);
	return preferred?.requires_table ? preferred : fallback;
}

export function sortedServiceTypes(serviceTypes: CachedServiceType[]): CachedServiceType[] {
	return [...serviceTypes].sort((a, b) => a.display_order - b.display_order);
}

function shortName(name: string): string {
	// "Jane Wanjiku" -> "Jane"; a user id keeps its local part.
	return name.split("@")[0].split(" ")[0];
}

export function waitersLabel(waiters: string[]): string {
	if (!waiters.length) return "";
	const first = shortName(waiters[0]);
	return waiters.length > 1 ? `${first} +${waiters.length - 1}` : first;
}

function guestsLabel(guests: number): string | null {
	return guests > 0 ? `${guests} ${guests === 1 ? "guest" : "guests"}` : null;
}

// Secondary lines drawn on a table, most important first (they drop out from the
// end when the table is small). The status word is always first: never colour alone.
export function tableStatusLines(view: TableStatusView, seats: number, now: Date): string[] {
	if (view.kind === "free") return [TABLE_STATUS_LABEL.free, `${seats} ${seats === 1 ? "seat" : "seats"}`];
	const elapsed = elapsedLabel(view.openedAt, now);
	const second = [guestsLabel(view.guests), waitersLabel(view.waiters)].filter(Boolean).join(" · ");
	return [[TABLE_STATUS_LABEL.occupied, elapsed].filter(Boolean).join(" · "), second].filter(Boolean);
}

// A small table drops status text that does not fit. Whenever any is dropped, the
// table gets a status badge (an icon per status), so status never rests on colour.
export function tableStatusBadge(view: TableStatusView, lines: string[], shown: number): TableStatusKind | null {
	return shown < lines.length ? view.kind : null;
}

// Screen readers get everything, including the full waiter names.
export function tableAccessibleName(label: string, seats: number, view: TableStatusView, now: Date): string {
	const parts = [`Table ${label}`, `${seats} ${seats === 1 ? "seat" : "seats"}`, TABLE_STATUS_LABEL[view.kind].toLowerCase()];
	if (view.kind === "occupied") {
		const guests = guestsLabel(view.guests);
		if (guests) parts.push(guests);
		if (view.waiters.length) parts.push(`waiter ${view.waiters.join(", ")}`);
		const elapsed = elapsedLabel(view.openedAt, now);
		if (elapsed) parts.push(elapsed === "now" ? "opened just now" : `open ${elapsed}`);
	}
	return parts.join(", ");
}
