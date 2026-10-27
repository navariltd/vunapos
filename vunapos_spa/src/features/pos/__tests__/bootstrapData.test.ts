import { describe, expect, it } from "vitest";

import type { CachedProfile } from "../../../lib/types";
import { toBootstrapData } from "../bootstrapData";

// Required<> makes tsc fail when CachedProfile gains a field this sample lacks,
// so every cached field is either mapped or listed in NOT_MAPPED below.
const cached: Required<CachedProfile> = {
	name: "Nairobi",
	company: "VUNA",
	warehouse: "Stores - V",
	price_list: "Standard Selling",
	allow_price_list_switching: false,
	allowed_price_lists: [],
	currency: "KES",
	currency_precision: 2,
	disable_rounded_total: false,
	smallest_currency_fraction_value: null,
	rounding_method: "Banker's Rounding",
	allow_partial_payment: false,
	allow_credit_sales: false,
	auto_allocate_payment_balance: true,
	new_item_position: "Top",
	default_sale_type: "Cash Sale",
	allow_rate_change: false,
	allow_discount_change: false,
	hide_images: false,
	hide_unavailable_items: false,
	automatically_add_filtered_item_to_cart: false,
	ignore_pricing_rule: false,
	item_prices_include_tax: false,
	default_order_type: "Sales Invoice",
	pos_mode: "Restaurant",
	allow_service_items: true,
	allow_delivery_charges: false,
	allow_delivery_charge_change: false,
	delivery_charge_item: null,
	allow_order_type_change: false,
	allow_customer_management: true,
	allow_customer_creation: true,
	allow_customer_payments: true,
	allow_sales_order_payments: false,
	allow_payment_reconciliation: false,
	allow_payment_history: true,
	allow_returns: true,
	checkout_fields: [],
	workflow: { enabled: false, workflows: {} },
	default_customer: "Walk-in Customer",
	modes_of_payment: [{ mode_of_payment: "Cash", default: true }],
	print_format: null,
	invoice_mode: "Sales Invoice",
	background_submission: { enabled: false, max_attempts: 3, processing_timeout_minutes: 10 },
	enable_salesperson_pin: false,
	require_manager_pin_item_removal: false,
	require_pin_before_every_sale: false,
	pin_max_attempts: 5,
	pin_lockout_minutes: 15,
	salesperson_pin_session_minutes: 30,
	pin_users: [],
	taxes_and_charges: null,
	restaurant: {
		service_types: [
			{ name: "Dine In", service_type_name: "Dine In", requires_table: true, display_order: 1, is_default: true },
		],
		allow_multiple_orders_per_table: false,
		require_manager_pin_order_cancel: true,
	},
	can_take_payment: true,
	restaurant_roles: ["VunaPOS Cashier", "VunaPOS Restaurant Manager"],
};

// Cached but not read by the screens today. Add a field here only on purpose.
const NOT_MAPPED = ["name", "background_submission", "taxes_and_charges"];

describe("toBootstrapData", () => {
	it("carries the restaurant rights and settings through to the screens", () => {
		const data = toBootstrapData(cached, "cashier.grace@goldenecho.test");
		expect(data.can_take_payment).toBe(true);
		expect(data.restaurant_roles).toEqual(["VunaPOS Cashier", "VunaPOS Restaurant Manager"]);
		expect(data.restaurant).toEqual(cached.restaurant);
		expect(data.current_user).toBe("cashier.grace@goldenecho.test");
		expect(data.pos_profile).toBe("Nairobi");
	});

	it("maps every cached field unless it is deliberately left out", () => {
		const data = toBootstrapData(cached, "user@example.com") as Record<string, unknown>;
		const dropped = Object.keys(cached).filter((key) => !NOT_MAPPED.includes(key) && !(key in data));
		expect(dropped).toEqual([]);
	});

	it("leaves the rights unset for an older cached profile without them", () => {
		const older: CachedProfile = { ...cached };
		delete older.can_take_payment;
		delete older.restaurant_roles;
		delete older.restaurant;
		const data = toBootstrapData(older, null);
		expect(data.can_take_payment).toBeUndefined();
		expect(data.restaurant_roles).toBeUndefined();
		expect(data.current_user).toBeUndefined();
	});
});
