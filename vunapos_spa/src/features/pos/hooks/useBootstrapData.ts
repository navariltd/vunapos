import { useEffect, useMemo, useState } from "react";
import { useFrappeAuth } from "frappe-react-sdk";

import type { BootstrapData } from "../types";
import { applyDelta } from "../../../lib/cacheEngine";
import { profileRepository } from "../../../lib/repositories/profileRepository";
import type { CachedProfile } from "../../../lib/types";
import { useRuntimeCacheStore } from "../../../lib/stores/runtimeCacheStore";

// The POS profile comes from the process-local read store and updates whenever
// a successful server bootstrap refreshes that store.
export function useBootstrapData() {
	const revision = useRuntimeCacheStore((state) => state.revision);
	const [profile, setProfile] = useState<CachedProfile>();
	const { currentUser } = useFrappeAuth();

	useEffect(() => {
		void profileRepository.getActive().then(setProfile);
	}, [revision]);

	const data = useMemo<BootstrapData | null>(() => {
		if (!profile) {
			return null;
		}
		return {
			current_user: currentUser || undefined,
			pos_profile: profile.name,
			company: profile.company,
			warehouse: profile.warehouse,
			price_list: profile.price_list,
			allow_price_list_switching: profile.allow_price_list_switching,
			allowed_price_lists: profile.allowed_price_lists,
			currency: profile.currency,
			currency_precision: profile.currency_precision,
			disable_rounded_total: profile.disable_rounded_total,
			smallest_currency_fraction_value: profile.smallest_currency_fraction_value,
			rounding_method: profile.rounding_method,
			allow_partial_payment: profile.allow_partial_payment,
			allow_credit_sales: profile.allow_credit_sales,
			auto_allocate_payment_balance: profile.auto_allocate_payment_balance,
			default_sale_type: profile.default_sale_type,
			allow_rate_change: profile.allow_rate_change,
			allow_discount_change: profile.allow_discount_change,
			hide_images: profile.hide_images,
			hide_unavailable_items: profile.hide_unavailable_items,
			automatically_add_filtered_item_to_cart: profile.automatically_add_filtered_item_to_cart,
			ignore_pricing_rule: profile.ignore_pricing_rule,
			item_prices_include_tax: profile.item_prices_include_tax,
			default_order_type: profile.default_order_type,
			allow_service_items: profile.allow_service_items,
			allow_delivery_charges: profile.allow_delivery_charges,
			allow_delivery_charge_change: profile.allow_delivery_charge_change,
			delivery_charge_item: profile.delivery_charge_item,
			allow_order_type_change: profile.allow_order_type_change,
			allow_customer_management: profile.allow_customer_management,
			allow_customer_creation: profile.allow_customer_creation,
			allow_customer_payments: profile.allow_customer_payments,
			allow_sales_order_payments: profile.allow_sales_order_payments,
			allow_payment_reconciliation: profile.allow_payment_reconciliation,
			allow_payment_history: profile.allow_payment_history,
			enable_salesperson_pin: profile.enable_salesperson_pin,
			require_manager_pin_item_removal: profile.require_manager_pin_item_removal,
			require_pin_before_every_sale: profile.require_pin_before_every_sale,
			pin_max_attempts: profile.pin_max_attempts,
			pin_lockout_minutes: profile.pin_lockout_minutes,
			salesperson_pin_session_minutes: profile.salesperson_pin_session_minutes,
			pin_users: profile.pin_users,
			default_customer: profile.default_customer as BootstrapData["default_customer"],
			modes_of_payment: profile.modes_of_payment,
			print_format: profile.print_format,
			invoice_mode: profile.invoice_mode,
		};
	}, [profile, currentUser]);

	return {
		data,
		error: null as string | null,
		isLoading: profile === undefined,
		reload: () => applyDelta(),
	};
}
