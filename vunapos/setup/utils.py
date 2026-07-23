import frappe
from erpnext.setup.utils import enable_all_roles_and_domains
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import now_datetime


def ensure_vunapos_custom_fields():
	create_custom_fields(
		{
			"POS Settings": [
				{
					"fieldname": "vunapos_offline_session_ttl_hours",
					"label": "VunaPOS Maximum Offline Session Age (Hours)",
					"fieldtype": "Int",
					"insert_after": "invoice_type",
					"default": "12",
					"non_negative": 1,
					"reqd": 1,
					"description": "Maximum time a device may sell offline after its POS Opening Entry started.",
				},
			],
			"Sales Invoice": [
				{
					"fieldname": "vunapos_invoice",
					"label": "VunaPOS Invoice",
					"fieldtype": "Check",
					"insert_after": "is_pos",
					"hidden": 1,
					"allow_on_submit": 1,
				},
				{
					"fieldname": "vunapos_held",
					"label": "VunaPOS Held",
					"fieldtype": "Check",
					"insert_after": "vunapos_invoice",
					"hidden": 1,
					"allow_on_submit": 1,
				},
				{
					"fieldname": "vunapos_idempotency_key",
					"label": "VunaPOS Idempotency Key",
					"fieldtype": "Data",
					"insert_after": "vunapos_held",
					"hidden": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_opening_entry",
					"label": "VunaPOS Opening Entry",
					"fieldtype": "Link",
					"options": "POS Opening Entry",
					"insert_after": "vunapos_idempotency_key",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_session_cashier",
					"label": "VunaPOS Session Cashier",
					"fieldtype": "Link",
					"options": "User",
					"insert_after": "vunapos_opening_entry",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_session_verified_at",
					"label": "VunaPOS Session Verified At",
					"fieldtype": "Datetime",
					"insert_after": "vunapos_session_cashier",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_closing_entry",
					"label": "VunaPOS Closing Entry",
					"fieldtype": "Link",
					"options": "POS Closing Entry",
					"insert_after": "vunapos_session_verified_at",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
			],
			"POS Invoice": [
				{
					"fieldname": "vunapos_invoice",
					"label": "VunaPOS Invoice",
					"fieldtype": "Check",
					"insert_after": "pos_profile",
					"hidden": 1,
					"allow_on_submit": 1,
				},
				{
					"fieldname": "vunapos_held",
					"label": "VunaPOS Held",
					"fieldtype": "Check",
					"insert_after": "vunapos_invoice",
					"hidden": 1,
					"allow_on_submit": 1,
				},
				{
					"fieldname": "vunapos_idempotency_key",
					"label": "VunaPOS Idempotency Key",
					"fieldtype": "Data",
					"insert_after": "vunapos_held",
					"hidden": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_opening_entry",
					"label": "VunaPOS Opening Entry",
					"fieldtype": "Link",
					"options": "POS Opening Entry",
					"insert_after": "vunapos_idempotency_key",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_session_cashier",
					"label": "VunaPOS Session Cashier",
					"fieldtype": "Link",
					"options": "User",
					"insert_after": "vunapos_opening_entry",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_session_verified_at",
					"label": "VunaPOS Session Verified At",
					"fieldtype": "Datetime",
					"insert_after": "vunapos_session_cashier",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_closing_entry",
					"label": "VunaPOS Closing Entry",
					"fieldtype": "Link",
					"options": "POS Closing Entry",
					"insert_after": "vunapos_session_verified_at",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
			],
			"Payment Entry": [
				{
					"fieldname": "vunapos_payment",
					"label": "VunaPOS Payment",
					"fieldtype": "Check",
					"insert_after": "mode_of_payment",
					"hidden": 1,
					"allow_on_submit": 1,
				},
				{
					"fieldname": "vunapos_idempotency_key",
					"label": "VunaPOS Idempotency Key",
					"fieldtype": "Data",
					"insert_after": "vunapos_payment",
					"hidden": 1,
					"unique": 1,
					"no_copy": 1,
					"allow_on_submit": 1,
				},
				{
					"fieldname": "vunapos_opening_entry",
					"label": "VunaPOS Opening Entry",
					"fieldtype": "Link",
					"options": "POS Opening Entry",
					"insert_after": "vunapos_idempotency_key",
					"read_only": 1,
					"no_copy": 1,
					"allow_on_submit": 1,
				},
				{
					"fieldname": "vunapos_session_cashier",
					"label": "VunaPOS Session Cashier",
					"fieldtype": "Link",
					"options": "User",
					"insert_after": "vunapos_opening_entry",
					"read_only": 1,
					"no_copy": 1,
					"allow_on_submit": 1,
				},
				{
					"fieldname": "vunapos_closing_entry",
					"label": "VunaPOS Closing Entry",
					"fieldtype": "Link",
					"options": "POS Closing Entry",
					"insert_after": "vunapos_session_cashier",
					"read_only": 1,
					"no_copy": 1,
					"allow_on_submit": 1,
				},
				{
					"fieldname": "vunapos_receipt_type",
					"label": "VunaPOS Receipt Type",
					"fieldtype": "Select",
					"options": "Outstanding Invoice Payment\nCustomer Advance",
					"insert_after": "vunapos_closing_entry",
					"read_only": 1,
					"allow_on_submit": 1,
				},
				{
					"fieldname": "vunapos_reconciled_opening_entry",
					"label": "VunaPOS Reconciled Opening Entry",
					"fieldtype": "Link",
					"options": "POS Opening Entry",
					"insert_after": "vunapos_receipt_type",
					"read_only": 1,
					"allow_on_submit": 1,
				},
				{
					"fieldname": "vunapos_reconciled_amount",
					"label": "VunaPOS Reconciled Amount",
					"fieldtype": "Currency",
					"insert_after": "vunapos_reconciled_opening_entry",
					"read_only": 1,
					"allow_on_submit": 1,
				},
			],
		},
		ignore_validate=True,
	)


def before_tests():
	frappe.clear_cache()
	# complete setup if missing
	from frappe.desk.page.setup_wizard.setup_wizard import setup_complete

	year = now_datetime().year
	if not frappe.get_list("Company"):
		setup_complete(
			{
				"currency": "KES",
				"full_name": "Test User",
				"company_name": "Vuna Technologies Limited",
				"timezone": "Africa/Nairobi",
				"company_abbr": "NL",
				"industry": "Software",
				"country": "Kenya",
				"fy_start_date": f"{year}-01-01",
				"fy_end_date": f"{year}-12-31",
				"language": "english",
				"company_tagline": "Testing",
				"email": "test@vuna.co.ke",
				"password": "test",
				"chart_of_accounts": "Standard",
			}
		)

	enable_all_roles_and_domains()
	ensure_vunapos_custom_fields()
	# Manually commit to save setup progress in case of timeout
	frappe.db.commit()  # nosemgrep
