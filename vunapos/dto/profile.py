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

	return {
		"name": profile.name,
		"company": profile.company,
		"warehouse": profile.warehouse,
		"price_list": profile.selling_price_list,
		"currency": profile.currency,
		"currency_precision": get_currency_precision(),
		"allow_partial_payment": bool(profile.get("allow_partial_payment")),
		"default_customer": profile.customer,
		"taxes_and_charges": profile.get("taxes_and_charges"),
		"modes_of_payment": [payment_mode(row) for row in profile.get("payments", [])],
		"print_format": profile.get("print_format"),
		"invoice_mode": invoice_mode,
	}
