// What the order screens do with each error code from vunapos.api.restaurant
// (frontend guide §6). Stage 1 has no checkout, cancel or line removal, so their
// codes fall through to the plain message.
export type OrderErrorAction =
	| "open-order" // TABLE_OCCUPIED: open the order that is already on the table
	| "reload-menu" // the menu changed under the waiting lines
	| "reload-order" // the order changed or closed elsewhere
	| "pick-service-type"
	| "pick-table"
	| "none";

export type OrderErrorView = {
	message: string;
	action: OrderErrorAction;
	// The order to open (TABLE_OCCUPIED) or the item to drop (MENU_ITEM_NOT_AVAILABLE).
	order?: string;
	itemCode?: string;
};

type ErrorLike = { code?: string; message?: string; meta?: Record<string, unknown> } | null | undefined;

const SETUP_MESSAGE = "Ask a manager to check the service type setup.";

function text(value: unknown): string | undefined {
	return typeof value === "string" && value ? value : undefined;
}

export function describeOrderError(error: ErrorLike, fallback = "The order could not be saved."): OrderErrorView {
	const message = error?.message || fallback;
	const meta = error?.meta ?? {};
	switch (error?.code) {
		case "TABLE_OCCUPIED":
			return {
				message: "This table already has an open order.",
				action: text(meta.order) ? "open-order" : "pick-table",
				order: text(meta.order),
			};
		case "TABLE_REQUIRED":
			return { message: "Choose a table for this order.", action: "pick-table" };
		case "TABLE_NOT_FOUND":
		case "TABLE_INACTIVE":
			return { message: "That table is no longer available. Choose another table.", action: "pick-table" };
		case "SERVICE_TYPE_REQUIRED":
		case "SERVICE_TYPE_NOT_ALLOWED":
			return { message: "Choose a service type for this order.", action: "pick-service-type" };
		case "MENU_ITEM_NOT_AVAILABLE":
			return {
				message: "An item is no longer on the menu here. It was removed from the order; check the menu.",
				action: "reload-menu",
				itemCode: text(meta.item_code),
			};
		case "ITEM_NOT_PRICED_FOR_SERVICE_TYPE":
			return { message, action: "none", itemCode: text(meta.item_code) };
		case "ITEM_HAS_VARIANTS":
			return { message: "Items with variants can't be ordered yet.", action: "none", itemCode: text(meta.item_code) };
		case "SERVICE_ITEMS_DISABLED":
		case "ITEM_NOT_SELLABLE":
			return { message, action: "none", itemCode: text(meta.item_code) };
		case "INVALID_QTY":
		case "INVALID_PAX":
		case "NOTE_TOO_LONG":
			return { message, action: "none" };
		case "ORDER_NOT_FOUND":
		case "ORDER_LINE_NOT_FOUND":
			return { message: "This order changed on another device. It has been reloaded.", action: "reload-order" };
		case "ORDER_NOT_OPEN":
			return { message: "This order has been billed or cancelled and can no longer be changed.", action: "reload-order" };
		case "SERVICE_TYPE_PRICE_LIST_INVALID":
		case "SERVICE_TYPE_TAX_TEMPLATE_INVALID":
			return { message: SETUP_MESSAGE, action: "none" };
		default:
			return { message, action: "none" };
	}
}
