import frappe
from erpnext.setup.utils import enable_all_roles_and_domains
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import now_datetime


def ensure_vunapos_custom_fields():
	for fieldname in ("vunapos_allow_delivery_items", "vunapos_delivery_item", "vunapos_apply_workflow"):
		custom_field = f"POS Profile-{fieldname}"
		if frappe.db.exists("Custom Field", custom_field):
			frappe.delete_doc("Custom Field", custom_field, ignore_permissions=True)
	custom_fields = (
		{
			"POS Settings": [
				{
					"fieldname": "vunapos_checkout_section",
					"label": "Checkout Fields",
					"fieldtype": "Section Break",
					"insert_after": "invoice_type",
				},
				{
					"fieldname": "vunapos_checkout_fields",
					"label": "VunaPOS Checkout Fields",
					"fieldtype": "Table",
					"options": "VunaPOS Checkout Field",
					"insert_after": "vunapos_checkout_section",
					"description": (
						"Register additional fields that VunaPOS may display and persist during checkout. "
						"The field must already exist on the selected transaction DocType."
					),
				},
				{
					"fieldname": "vunapos_security_section",
					"label": "Security",
					"fieldtype": "Section Break",
					"insert_after": "vunapos_gateway_payment_timeout_minutes",
				},
				{
					"fieldname": "vunapos_salesperson_pin_session_minutes",
					"label": "Salesperson PIN Session Duration (Minutes)",
					"fieldtype": "Int",
					"insert_after": "vunapos_security_section",
					"description": (
						"How long a verified salesperson session remains valid. Active sessions are refreshed "
						"before expiry; inactive sessions are locked when this duration elapses. Maximum: 1440 minutes."
					),
					"default": "15",
				},
				{
					"fieldname": "vunapos_gateway_section",
					"label": "Payment Gateway",
					"fieldtype": "Section Break",
					"insert_after": "vunapos_checkout_fields",
				},
				{
					"fieldname": "vunapos_gateway_payment_timeout_minutes",
					"label": "VunaPOS Gateway Payment Timeout (Minutes)",
					"fieldtype": "Int",
					"insert_after": "vunapos_gateway_section",
					"description": (
						"Unconsumed pending VunaPOS gateway payment links older than this value are "
						"expired automatically. Use 0 or blank for the default timeout."
					),
					"default": "15",
				},
			],
			"Customer": [
				{
					"fieldname": "is_walkin",
					"label": "Is Walk-in Customer",
					"fieldtype": "Check",
					"insert_after": "tax_id",
					"description": "Allow VunaPOS cashiers to enter a transaction-specific Tax ID at checkout.",
					"default": "0",
				},
			],
			"POS Payment Method": [
				{
					"fieldname": "payment_gateway",
					"label": "Payment Gateway",
					"fieldtype": "Link",
					"options": "Payment Gateway Account",
					"insert_after": "mode_of_payment",
					"description": (
						"When set, VunaPOS treats this mode as gateway-controlled and blocks "
						"manual cashier-entered amounts during checkout."
					),
				},
			],
			"Sales Invoice Item": [
				{
					"fieldname": "vunapos_item_note",
					"label": "VunaPOS Item Note",
					"fieldtype": "Small Text",
					"insert_after": "description",
					"read_only": 1,
				},
				{
					"fieldname": "vunapos_pricing_override",
					"label": "VunaPOS Pricing Override",
					"fieldtype": "Data",
					"insert_after": "vunapos_item_note",
					"read_only": 1,
				},
				{
					"fieldname": "vunapos_pricing_override_by",
					"label": "VunaPOS Pricing Override By",
					"fieldtype": "Link",
					"options": "User",
					"insert_after": "vunapos_pricing_override",
					"read_only": 1,
				},
			],
			"POS Invoice Item": [
				{
					"fieldname": "vunapos_item_note",
					"label": "VunaPOS Item Note",
					"fieldtype": "Small Text",
					"insert_after": "description",
					"read_only": 1,
				},
				{
					"fieldname": "vunapos_pricing_override",
					"label": "VunaPOS Pricing Override",
					"fieldtype": "Data",
					"insert_after": "vunapos_item_note",
					"read_only": 1,
				},
				{
					"fieldname": "vunapos_pricing_override_by",
					"label": "VunaPOS Pricing Override By",
					"fieldtype": "Link",
					"options": "User",
					"insert_after": "vunapos_pricing_override",
					"read_only": 1,
				},
			],
			"Sales Invoice": [
				{
					"fieldname": "vunapos_tab",
					"label": "VunaPOS",
					"fieldtype": "Tab Break",
					"insert_after": "more_info_tab",
				},
				{
					"fieldname": "vunapos_transaction_section",
					"label": "VunaPOS Transaction",
					"fieldtype": "Section Break",
					"insert_after": "vunapos_tab",
				},
				{
					"fieldname": "vunapos_invoice",
					"label": "VunaPOS Invoice",
					"fieldtype": "Check",
					"insert_after": "vunapos_transaction_section",
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
					"fieldname": "vunapos_credit_sale",
					"label": "VunaPOS Credit Sale",
					"fieldtype": "Check",
					"insert_after": "vunapos_held",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_idempotency_key",
					"label": "VunaPOS Idempotency Key",
					"fieldtype": "Data",
					"insert_after": "vunapos_credit_sale",
					"hidden": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
					"unique": 1,
					"search_index": 1,
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
				{
					"fieldname": "vunapos_queue_section",
					"label": "Background Submission",
					"fieldtype": "Section Break",
					"insert_after": "vunapos_closing_entry",
				},
				{
					"fieldname": "vunapos_queue_status",
					"label": "VunaPOS Queue Status",
					"fieldtype": "Select",
					"options": "\nQueued\nProcessing\nSubmitted\nFailed\nRequires Review\nCancelled",
					"insert_after": "vunapos_queue_section",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
					"search_index": 1,
				},
				{
					"fieldname": "vunapos_queue_attempts",
					"label": "VunaPOS Queue Attempts",
					"fieldtype": "Int",
					"insert_after": "vunapos_queue_status",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
					"default": "0",
				},
				{
					"fieldname": "vunapos_queue_error",
					"label": "VunaPOS Queue Error",
					"fieldtype": "Small Text",
					"insert_after": "vunapos_queue_attempts",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_queue_created_at",
					"label": "VunaPOS Queued At",
					"fieldtype": "Datetime",
					"insert_after": "vunapos_queue_error",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_queue_started_at",
					"label": "VunaPOS Processing Started At",
					"fieldtype": "Datetime",
					"insert_after": "vunapos_queue_created_at",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_queue_completed_at",
					"label": "VunaPOS Queue Completed At",
					"fieldtype": "Datetime",
					"insert_after": "vunapos_queue_started_at",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_queue_job_id",
					"label": "VunaPOS Queue Job ID",
					"fieldtype": "Data",
					"insert_after": "vunapos_queue_completed_at",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_reservation_fingerprint",
					"label": "VunaPOS Reservation Fingerprint",
					"fieldtype": "Data",
					"insert_after": "vunapos_queue_job_id",
					"hidden": 1,
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
			],
			"Sales Order": [
				{
					"fieldname": "vunapos_tab",
					"label": "VunaPOS",
					"fieldtype": "Tab Break",
					"insert_after": "more_info",
				},
				{
					"fieldname": "vunapos_transaction_section",
					"label": "VunaPOS Transaction",
					"fieldtype": "Section Break",
					"insert_after": "vunapos_tab",
				},
				{
					"fieldname": "vunapos_invoice",
					"label": "VunaPOS Order",
					"fieldtype": "Check",
					"insert_after": "vunapos_transaction_section",
					"hidden": 1,
					"allow_on_submit": 1,
				},
				{
					"fieldname": "vunapos_idempotency_key",
					"label": "VunaPOS Idempotency Key",
					"fieldtype": "Data",
					"insert_after": "vunapos_invoice",
					"hidden": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
					"unique": 1,
					"search_index": 1,
				},
				{
					"fieldname": "vunapos_pos_profile",
					"label": "VunaPOS Profile",
					"fieldtype": "Link",
					"options": "POS Profile",
					"insert_after": "vunapos_idempotency_key",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_opening_entry",
					"label": "VunaPOS Opening Entry",
					"fieldtype": "Link",
					"options": "POS Opening Entry",
					"insert_after": "vunapos_pos_profile",
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
			],
			"POS Invoice": [
				{
					"fieldname": "vunapos_tab",
					"label": "VunaPOS",
					"fieldtype": "Tab Break",
					"insert_after": "more_info_tab",
				},
				{
					"fieldname": "vunapos_transaction_section",
					"label": "VunaPOS Transaction",
					"fieldtype": "Section Break",
					"insert_after": "vunapos_tab",
				},
				{
					"fieldname": "vunapos_invoice",
					"label": "VunaPOS Invoice",
					"fieldtype": "Check",
					"insert_after": "vunapos_transaction_section",
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
					"fieldname": "vunapos_credit_sale",
					"label": "VunaPOS Credit Sale",
					"fieldtype": "Check",
					"insert_after": "vunapos_held",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_idempotency_key",
					"label": "VunaPOS Idempotency Key",
					"fieldtype": "Data",
					"insert_after": "vunapos_credit_sale",
					"hidden": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
					"unique": 1,
					"search_index": 1,
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
				{
					"fieldname": "vunapos_queue_section",
					"label": "Background Submission",
					"fieldtype": "Section Break",
					"insert_after": "vunapos_closing_entry",
				},
				{
					"fieldname": "vunapos_queue_status",
					"label": "VunaPOS Queue Status",
					"fieldtype": "Select",
					"options": "\nQueued\nProcessing\nSubmitted\nFailed\nRequires Review\nCancelled",
					"insert_after": "vunapos_queue_section",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
					"search_index": 1,
				},
				{
					"fieldname": "vunapos_queue_attempts",
					"label": "VunaPOS Queue Attempts",
					"fieldtype": "Int",
					"insert_after": "vunapos_queue_status",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
					"default": "0",
				},
				{
					"fieldname": "vunapos_queue_error",
					"label": "VunaPOS Queue Error",
					"fieldtype": "Small Text",
					"insert_after": "vunapos_queue_attempts",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_queue_created_at",
					"label": "VunaPOS Queued At",
					"fieldtype": "Datetime",
					"insert_after": "vunapos_queue_error",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_queue_started_at",
					"label": "VunaPOS Processing Started At",
					"fieldtype": "Datetime",
					"insert_after": "vunapos_queue_created_at",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_queue_completed_at",
					"label": "VunaPOS Queue Completed At",
					"fieldtype": "Datetime",
					"insert_after": "vunapos_queue_started_at",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_queue_job_id",
					"label": "VunaPOS Queue Job ID",
					"fieldtype": "Data",
					"insert_after": "vunapos_queue_completed_at",
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
				{
					"fieldname": "vunapos_reservation_fingerprint",
					"label": "VunaPOS Reservation Fingerprint",
					"fieldtype": "Data",
					"insert_after": "vunapos_queue_job_id",
					"hidden": 1,
					"read_only": 1,
					"allow_on_submit": 1,
					"no_copy": 1,
				},
			],
			"Payment Entry": [
				{
					"fieldname": "vunapos_payment_section",
					"label": "VunaPOS",
					"fieldtype": "Section Break",
					"insert_after": "section_break_12",
					"collapsible": 1,
				},
				{
					"fieldname": "vunapos_payment",
					"label": "VunaPOS Payment",
					"fieldtype": "Check",
					"insert_after": "vunapos_payment_section",
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
					"options": "Outstanding Invoice Payment\nCustomer Advance\nSales Order Advance",
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
	)
	create_custom_fields(custom_fields, ignore_validate=True)
	ensure_sales_invoice_stock_reservation_option()


def ensure_sales_invoice_stock_reservation_option():
	legacy_setter = frappe.db.get_value(
		"Property Setter",
		{
			"name": "Stock Reservation Entry-main-options",
			"doc_type": "Stock Reservation Entry",
			"field_name": ["is", "not set"],
			"property": "options",
			"module": "VunaPOS",
		},
		"name",
	)
	if legacy_setter:
		frappe.delete_doc("Property Setter", legacy_setter, ignore_permissions=True)
		frappe.clear_cache(doctype="Stock Reservation Entry")

	field = frappe.get_meta("Stock Reservation Entry").get_field("voucher_type")
	options = [option.strip() for option in (field.options or "").splitlines() if option.strip()]
	if "Sales Invoice" in options:
		return

	options.append("Sales Invoice")
	frappe.make_property_setter(
		{
			"doctype": "Stock Reservation Entry",
			"doctype_or_field": "DocField",
			"fieldname": "voucher_type",
			"property": "options",
			"property_type": "Text",
			"value": "\n" + "\n".join(options),
		},
		ignore_validate=True,
		is_system_generated=False,
		module="VunaPOS",
	)
	frappe.clear_cache(doctype="Stock Reservation Entry")


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
