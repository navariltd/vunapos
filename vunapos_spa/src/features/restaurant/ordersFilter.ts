import type { RestaurantOrderSummaryDTO } from "./types";

export type OrdersSort = "oldest" | "newest";

// The Orders page filters, applied on this device to the polled open orders.
export type OrdersFilter = {
	serviceType: string | null;
	floor: string | null;
	mine: boolean;
	// Kiosk orders waiting for a cashier to confirm payment.
	awaitingPayment: boolean;
	query: string;
	sort: OrdersSort;
};

export const DEFAULT_ORDERS_FILTER: OrdersFilter = {
	serviceType: null,
	floor: null,
	mine: false,
	awaitingPayment: false,
	query: "",
	sort: "oldest",
};

type FilterContext = {
	// The signed-in user id, compared with each order's waiter.
	currentUser?: string | null;
	// Table name -> floor name, from the floor plan.
	floorOfTable: Map<string, string>;
};

function matchesQuery(order: RestaurantOrderSummaryDTO, needle: string): boolean {
	if (!needle) return true;
	// "47" or "Order 47" finds kiosk order 47.
	const number = needle.replace(/^order\s*/, "");
	if (order.order_number && number === String(order.order_number)) return true;
	return [order.table_label, order.name, order.customer, ...(order.sales_orders ?? [])].some((value) =>
		value?.toLowerCase().includes(needle),
	);
}

export function isAwaitingPayment(order: RestaurantOrderSummaryDTO): boolean {
	return order.kiosk_status === "Awaiting Payment";
}

// A guest's QR order waiting for staff to accept or reject it.
export function isPendingQrOrder(order: RestaurantOrderSummaryDTO): boolean {
	return order.qr_status === "Pending";
}

// Kiosk and QR orders name their source; a waiter's order does not.
export function orderSourceLabel(order: RestaurantOrderSummaryDTO): string | null {
	if (order.order_source === "QR") return "QR order";
	if (order.order_source === "Kiosk" || order.kiosk_status) return "Kiosk order";
	return null;
}

// A kiosk order paid at the counter first, whose table waits to be cleared.
export function isPaidKioskOrder(order: RestaurantOrderSummaryDTO): boolean {
	return order.kiosk_status === "Paid";
}

export function filterOrders(
	orders: RestaurantOrderSummaryDTO[],
	filter: OrdersFilter,
	context: FilterContext,
): RestaurantOrderSummaryDTO[] {
	const needle = filter.query.trim().toLowerCase();
	const result = orders.filter(
		(order) =>
			(!filter.serviceType || order.service_type === filter.serviceType) &&
			// Orders without a table (takeaway, delivery) are on no floor.
			(!filter.floor || (order.table ? context.floorOfTable.get(order.table) === filter.floor : false)) &&
			(!filter.mine || (Boolean(context.currentUser) && order.waiter === context.currentUser)) &&
			(!filter.awaitingPayment || isAwaitingPayment(order)) &&
			matchesQuery(order, needle),
	);
	const direction = filter.sort === "newest" ? -1 : 1;
	return result.sort(
		(a, b) => direction * (a.opened_at.localeCompare(b.opened_at) || a.name.localeCompare(b.name)),
	);
}

// Whether anything narrows the list (the sort order doesn't).
export function isFiltered(filter: OrdersFilter): boolean {
	return Boolean(filter.serviceType || filter.floor || filter.mine || filter.awaitingPayment || filter.query.trim());
}
