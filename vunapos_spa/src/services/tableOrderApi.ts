import type { MenuDTO, OrderLineInput, TableOrderResultDTO, TableOrderSetupDTO } from "../features/restaurant/types";
import { VunaApiError, unwrapVunaResponse } from "./vunaApi";

// The guest's QR ordering page. Guests are never signed in, and a staff member who
// scans a code must order as a guest too, so these requests never send cookies.
const METHOD = "/api/method/vunapos.api.table_order.";

async function guestCall<T>(method: string, params: Record<string, unknown>, post = false): Promise<T> {
	const query = new URLSearchParams();
	if (!post)
		Object.entries(params).forEach(([key, value]) => {
			if (value !== undefined && value !== null) query.set(key, String(value));
		});
	let response: Response;
	try {
		response = await fetch(`${METHOD}${method}${post ? "" : `?${query}`}`, {
			method: post ? "POST" : "GET",
			credentials: "omit",
			headers: { Accept: "application/json", ...(post ? { "Content-Type": "application/json" } : {}) },
			body: post ? JSON.stringify(params) : undefined,
		});
	} catch {
		throw new VunaApiError("No connection. Check your internet and try again.", "NETWORK_ERROR");
	}
	if (response.status === 429)
		throw new VunaApiError("Too many requests from this phone. Please wait a few minutes and try again.", "RATE_LIMITED");
	if (!response.ok) throw new VunaApiError("Something went wrong. Please ask a waiter.", "SERVER_ERROR");
	return unwrapVunaResponse<T>(await response.json());
}

export function getTableOrder(token: string) {
	return guestCall<TableOrderSetupDTO>("get_table_order", { token });
}

export function getTableMenu(token: string) {
	return guestCall<MenuDTO>("get_table_menu", { token });
}

export function placeTableOrder(params: { token: string; items: OrderLineInput[]; idempotency_key: string; order_note?: string | null }) {
	return guestCall<TableOrderResultDTO>("place_table_order", params, true);
}

export function getTableOrderStatus(token: string, order: string) {
	return guestCall<TableOrderResultDTO>("get_table_order_status", { token, order });
}
