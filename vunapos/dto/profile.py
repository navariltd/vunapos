import frappe
from erpnext.accounts.utils import get_currency_precision
from frappe.utils import cint

from vunapos.dto.customer import customer_to_dict
from vunapos.services.checkout_queue_service import get_queue_limits
from vunapos.services.price_list_service import get_permitted_price_lists


def profile_to_dict(profile, invoice_mode):
	def enabled(fieldname):
		value = profile.get(fieldname)
		return True if value is None else bool(cint(value))

	def default_customer():
		if not profile.customer:
			return None
		customer = frappe.get_cached_doc("Customer", profile.customer)
		return customer_to_dict(customer)

	def payment_mode(row):
		account = frappe.db.get_value(
			"Mode of Payment Account",
			{"parent": row.mode_of_payment, "company": profile.company},
			"default_account",
		)
		return {
			"mode_of_payment": row.mode_of_payment,
			"default": row.get("default"),
			"type": frappe.get_cached_value("Mode of Payment", row.mode_of_payment, "type"),
			"account": account,
			"payment_gateway": row.get("payment_gateway"),
			"requires_reference": bool(
				account and frappe.get_cached_value("Account", account, "account_type") == "Bank"
			),
		}

	allow_credit_sales = bool(profile.get("vunapos_allow_credit_sales"))
	default_sale_type = profile.get("vunapos_default_sale_type") or "Cash Sale"
	if not allow_credit_sales or default_sale_type != "Credit Sale":
		default_sale_type = "Cash Sale"
	queue = get_queue_limits(profile)
	default_order_type = profile.get("vunapos_default_order_type") or "Sales Invoice"
	if default_order_type not in ("Sales Invoice", "Sales Order"):
		default_order_type = "Sales Invoice"

	return {
		"name": profile.name,
		"company": profile.company,
		"warehouse": profile.warehouse,
		"price_list": profile.selling_price_list,
		"allow_price_list_switching": bool(profile.get("vunapos_allow_price_list_switching")),
		"allowed_price_lists": get_permitted_price_lists(profile),
		"currency": profile.currency,
		"currency_precision": get_currency_precision(),
		"disable_rounded_total": bool(profile.get("disable_rounded_total")),
		"smallest_currency_fraction_value": frappe.get_cached_value(
			"Currency", profile.currency, "smallest_currency_fraction_value"
		),
		"rounding_method": frappe.get_system_settings("rounding_method") or "Banker's Rounding (legacy)",
		"allow_partial_payment": bool(profile.get("allow_partial_payment")),
		"allow_credit_sales": allow_credit_sales,
		"default_sale_type": default_sale_type,
		"allow_rate_change": bool(profile.get("allow_rate_change")),
		"allow_discount_change": bool(profile.get("allow_discount_change")),
		"hide_images": bool(profile.get("hide_images")),
		"hide_unavailable_items": bool(profile.get("hide_unavailable_items")),
		"automatically_add_filtered_item_to_cart": bool(profile.get("auto_add_item_to_cart")),
		"ignore_pricing_rule": bool(profile.get("ignore_pricing_rule")),
		"item_prices_include_tax": bool(profile.get("vunapos_item_prices_include_tax")),
		"default_order_type": default_order_type,
		"allow_service_items": bool(profile.get("vunapos_allow_service_items")),
		"allow_delivery_items": bool(profile.get("vunapos_allow_delivery_items")),
		"delivery_item": profile.get("vunapos_delivery_item"),
		"delivery_charge_item": profile.get("vunapos_delivery_charge_item"),
		"allow_order_type_change": enabled("vunapos_allow_order_type_change"),
		"allow_customer_management": enabled("vunapos_allow_customer_management"),
		"allow_customer_creation": enabled("vunapos_allow_customer_creation"),
		"allow_customer_payments": enabled("vunapos_allow_customer_payments"),
		"allow_payment_reconciliation": enabled("vunapos_allow_customer_payments")
		and enabled("vunapos_allow_payment_reconciliation"),
		"allow_payment_history": enabled("vunapos_allow_customer_payments")
		and enabled("vunapos_allow_payment_history"),
		"default_customer": default_customer(),
		"taxes_and_charges": profile.get("taxes_and_charges"),
		"modes_of_payment": [payment_mode(row) for row in profile.get("payments", [])],
		"print_format": profile.get("print_format"),
		"invoice_mode": invoice_mode,
		"background_submission": queue,
	}
