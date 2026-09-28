import { PosBootstrapData, PosDefaultCustomer } from "@/features/pos/types";

function normalizeDefaultCustomer(
  value: PosDefaultCustomer | string | null | undefined,
): PosDefaultCustomer | null | undefined {
  if (typeof value === "string") {
    return { customer: value, customer_name: value };
  }
  return value;
}

/**
 * Identifies effective POS behaviour while excluding request/verification
 * metadata. This is intentionally a projection, not a serialization of the
 * complete bootstrap response.
 */
export function effectivePosConfigurationFingerprint(
  bootstrap: PosBootstrapData,
): string {
  const profile = bootstrap.pos_profile;
  const profileData = profile as Record<string, unknown>;
  return JSON.stringify({
    profile: {
      name: profile.name,
      company: profile.company,
      warehouse: profile.warehouse,
      price_list: profile.price_list,
      allow_price_list_switching: profile.allow_price_list_switching,
      allowed_price_lists: profile.allowed_price_lists,
      currency: profile.currency,
      currency_precision: profile.currency_precision,
      disable_rounded_total: profileData.disable_rounded_total,
      smallest_currency_fraction_value:
        profileData.smallest_currency_fraction_value,
      rounding_method: profileData.rounding_method,
      allow_partial_payment: profile.allow_partial_payment,
      allow_credit_sales: profile.allow_credit_sales,
      auto_allocate_payment_balance: profile.auto_allocate_payment_balance,
      new_item_position: profileData.new_item_position,
      default_sale_type: profile.default_sale_type,
      default_order_type: profile.default_order_type,
      allow_rate_change: profile.allow_rate_change,
      allow_discount_change: profile.allow_discount_change,
      hide_images: profile.hide_images,
      hide_unavailable_items: profile.hide_unavailable_items,
      automatically_add_filtered_item_to_cart:
        profile.automatically_add_filtered_item_to_cart,
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
      pin_max_attempts: profileData.pin_max_attempts,
      pin_lockout_minutes: profileData.pin_lockout_minutes,
      salesperson_pin_session_minutes: profile.salesperson_pin_session_minutes,
      require_pin_before_every_sale: profile.require_pin_before_every_sale,
      pin_users: profile.pin_users,
      checkout_fields: profile.checkout_fields,
      workflow: profile.workflow,
      default_customer: normalizeDefaultCustomer(
        profile.default_customer ?? bootstrap.default_customer,
      ),
      ignore_pricing_rule: profileData.ignore_pricing_rule,
      item_prices_include_tax: profileData.item_prices_include_tax,
      allow_service_items: profileData.allow_service_items,
      taxes_and_charges: profileData.taxes_and_charges,
      modes_of_payment: profile.modes_of_payment,
      print_format: profileData.print_format,
      invoice_mode: profile.invoice_mode,
      background_submission: profileData.background_submission,
    },
    payment_modes: bootstrap.payment_modes,
    tax_settings: (bootstrap as Record<string, unknown>).tax_settings,
    // `verified_at` is generated from the request time and is deliberately not
    // included. Session readiness itself is business state and is included.
    pos_session: bootstrap.pos_session
      ? {
          has_opening_entry: bootstrap.pos_session.has_opening_entry,
          opening_entry: bootstrap.pos_session.opening_entry,
          opened_at: bootstrap.pos_session.opened_at,
          cashier: bootstrap.pos_session.cashier,
          pos_profile: bootstrap.pos_session.pos_profile,
          ready: bootstrap.pos_session.ready,
          status: bootstrap.pos_session.status,
          closing_entry: bootstrap.pos_session.closing_entry,
        }
      : null,
  });
}

/** Configuration subset whose change may alter an active cart preview. */
export function transactionConfigurationFingerprint(
  bootstrap: PosBootstrapData,
): string {
  const profile = bootstrap.pos_profile;
  const profileData = profile as Record<string, unknown>;
  return JSON.stringify({
    company: profile.company,
    warehouse: profile.warehouse,
    price_list: profile.price_list,
    currency: profile.currency,
    currency_precision: profile.currency_precision,
    disable_rounded_total: profileData.disable_rounded_total,
    smallest_currency_fraction_value:
      profileData.smallest_currency_fraction_value,
    rounding_method: profileData.rounding_method,
    default_order_type: profile.default_order_type,
    invoice_mode: profile.invoice_mode,
    taxes_and_charges: (profile as Record<string, unknown>).taxes_and_charges,
    ignore_pricing_rule: profileData.ignore_pricing_rule,
    item_prices_include_tax: profileData.item_prices_include_tax,
    allow_rate_change: profile.allow_rate_change,
    allow_discount_change: profile.allow_discount_change,
    allow_service_items: profileData.allow_service_items,
    allow_delivery_charges: profile.allow_delivery_charges,
    allow_delivery_charge_change: profile.allow_delivery_charge_change,
    delivery_charge_item: profile.delivery_charge_item,
    tax_settings: (bootstrap as Record<string, unknown>).tax_settings,
  });
}
