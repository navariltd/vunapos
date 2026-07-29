import frappe
from erpnext.accounts.utils import get_currency_precision


def profile_to_dict(profile, invoice_mode):
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
			"requires_reference": bool(
				account and frappe.get_cached_value("Account", account, "account_type") == "Bank"
			),
		}

	allow_credit_sales = bool(profile.get("vunapos_allow_credit_sales"))
	default_sale_type = profile.get("vunapos_default_sale_type") or "Cash Sale"
	if not allow_credit_sales or default_sale_type != "Credit Sale":
		default_sale_type = "Cash Sale"

	return {
		"name": profile.name,
		"company": profile.company,
		"warehouse": profile.warehouse,
		"price_list": profile.selling_price_list,
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
		"item_prices_include_tax": bool(profile.get("vunapos_item_prices_include_tax")),
		"default_customer": profile.customer,
		"taxes_and_charges": profile.get("taxes_and_charges"),
		"modes_of_payment": [payment_mode(row) for row in profile.get("payments", [])],
		"print_format": profile.get("print_format"),
		"invoice_mode": invoice_mode,
	}
