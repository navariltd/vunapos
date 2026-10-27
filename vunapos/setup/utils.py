import frappe
from erpnext.setup.utils import enable_all_roles_and_domains
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.permissions import setup_custom_perms
from frappe.utils import now_datetime

POS_MODES = ("Retail", "Restaurant")
DEFAULT_POS_MODE = "Retail"
RESTAURANT_MANAGER_ROLE = "VunaPOS Restaurant Manager"
CASHIER_ROLE = "VunaPOS Cashier"
WAITER_ROLE = "VunaPOS Waiter"
# Display order: the Profile page lists a user's roles in this order.
RESTAURANT_ROLES = (WAITER_ROLE, CASHIER_ROLE, RESTAURANT_MANAGER_ROLE)

_READ = {"read": 1}
# Catalogue pricing (ERPNext's apply_pricing_rule) needs doctype-level read on
# the invoice doctype. "Only if creator" passes that check without exposing
# invoices to users who never create any.
_OWN_INVOICE_READ = {"read": 1, "if_owner": 1}
_BILLING = {"read": 1, "write": 1, "create": 1, "submit": 1, "print": 1}
_SHIFT = {"read": 1, "write": 1, "create": 1, "submit": 1}
_MENU_READS = {
	"POS Profile": _READ,
	"Item": _READ,
	"Customer": _READ,
	# Pricing an order (preview and checkout) resolves the customer's receivable
	# account; ERPNext only needs "select" for that, not read.
	"Account": {"select": 1},
}

# Grants on Frappe/ERPNext doctypes, so each role works without Sales User or
# Accounts User. Permissions on VunaPOS doctypes live in their DocType JSON.
ROLE_PERMISSIONS = {
	WAITER_ROLE: {**_MENU_READS, "Sales Invoice": _OWN_INVOICE_READ, "POS Invoice": _OWN_INVOICE_READ},
	RESTAURANT_MANAGER_ROLE: {
		**_MENU_READS,
		"Sales Invoice": _OWN_INVOICE_READ,
		"POS Invoice": _OWN_INVOICE_READ,
	},
	CASHIER_ROLE: {
		**_MENU_READS,
		"Sales Invoice": _BILLING,
		"POS Invoice": _BILLING,
		"POS Opening Entry": _SHIFT,
		"POS Closing Entry": _SHIFT,
		# Closing a shift lists the cashier's own customer receipts.
		"Payment Entry": {"read": 1, "if_owner": 1},
	},
}


def ensure_vunapos_roles():
	for role in RESTAURANT_ROLES:
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(
				ignore_permissions=True
			)
	for role, grants in ROLE_PERMISSIONS.items():
		for doctype, flags in grants.items():
			_ensure_role_permission(doctype, role, flags)


def _ensure_role_permission(doctype, role, flags):
	"""Add a level 0 rule for the role, unless the site already has one.

	An existing rule is left alone, so changes made in Role Permissions Manager
	survive migrate.
	"""
	if not frappe.db.exists("DocType", doctype):
		return
	if frappe.db.exists("Custom DocPerm", {"parent": doctype, "role": role, "permlevel": 0}):
		return
	# The first Custom DocPerm replaces a doctype's standard rules, so copy those
	# first; existing roles keep exactly the access they had.
	setup_custom_perms(doctype)
	frappe.get_doc(
		{
			"doctype": "Custom DocPerm",
			"parent": doctype,
			"parenttype": "DocType",
			"parentfield": "permissions",
			"role": role,
			"permlevel": 0,
			# Custom DocPerm defaults read and export to 1; grant only the listed rights.
			"read": 0,
			"export": 0,
			**flags,
		}
	).insert(ignore_permissions=True)
	frappe.clear_cache(doctype=doctype)


def ensure_vunapos_custom_fields():
	for fieldname in ("vunapos_allow_delivery_items", "vunapos_delivery_item", "vunapos_apply_workflow"):
		custom_field = f"POS Profile-{fieldname}"
		if frappe.db.exists("Custom Field", custom_field):
			frappe.delete_doc("Custom Field", custom_field, ignore_permissions=True)
	ensure_vunapos_roles()
	custom_fields = {
		"POS Profile": [
			{
				"fieldname": "vunapos_pos_mode_section",
				"label": "POS Mode",
				"fieldtype": "Section Break",
				"insert_after": "vunapos_tab",
			},
			{
				"fieldname": "vunapos_pos_mode",
				"label": "POS Mode",
				"fieldtype": "Select",
				"options": "\n".join(POS_MODES),
				"default": DEFAULT_POS_MODE,
				"reqd": 1,
				"insert_after": "vunapos_pos_mode_section",
				"description": "Choose the VunaPOS interface for this profile. Restaurant enables floor plans and table service.",
			},
			{
				"fieldname": "vunapos_restaurant_section",
				"label": "Restaurant",
				"fieldtype": "Section Break",
				"insert_after": "vunapos_pos_mode",
				"depends_on": "eval:doc.vunapos_pos_mode=='Restaurant'",
			},
			{
				"fieldname": "vunapos_service_types",
				"label": "Service Types",
				"fieldtype": "Table",
				"options": "VunaPOS Profile Service Type",
				"insert_after": "vunapos_restaurant_section",
				"description": "Service types offered by this outlet. Leave empty to offer every enabled service type. Tick Default on one row.",
			},
			{
				"fieldname": "vunapos_restaurant_column_break",
				"fieldtype": "Column Break",
				"insert_after": "vunapos_service_types",
			},
			{
				"fieldname": "vunapos_allow_multiple_orders_per_table",
				"label": "Allow Multiple Open Orders per Table",
				"fieldtype": "Check",
				"insert_after": "vunapos_restaurant_column_break",
				"default": "0",
				"description": "By default a table holds one open order until it is billed or cancelled.",
			},
			{
				"fieldname": "vunapos_require_manager_pin_order_cancel",
				"label": "Require Manager PIN to Cancel Orders",
				"fieldtype": "Check",
				"insert_after": "vunapos_allow_multiple_orders_per_table",
				"default": "0",
				"description": "Only a VunaPOS Restaurant Manager, or a cashier with a manager PIN, can cancel an order.",
			},
			{
				"fieldname": "vunapos_menu_section",
				"label": "Menu",
				"fieldtype": "Section Break",
				"insert_after": "vunapos_require_manager_pin_order_cancel",
				"depends_on": "eval:doc.vunapos_pos_mode=='Restaurant'",
			},
			{
				"fieldname": "vunapos_restaurant_menu",
				"label": "Menu",
				"fieldtype": "Table",
				"options": "VunaPOS Menu Item Group",
				"insert_after": "vunapos_menu_section",
				"description": (
					"Item groups on the menu, shown as categories in this order. Set a Floor or Service Type "
					"to limit a row to it. If this table is empty, the Item Groups table on this profile is "
					"used, and if that is empty too, every sales item is on the menu."
				),
			},
			{
				# Defined in custom/pos_profile.json; re-anchored here so POS Mode
				# stays first in the VunaPOS tab after a customisation sync.
				"fieldname": "vunapos_sales_section",
				"label": "Sales Settings",
				"fieldtype": "Section Break",
				"insert_after": "vunapos_restaurant_menu",
			},
			{
				"fieldname": "vunapos_home_screen_section",
				"label": "Mobile Settings",
				"fieldtype": "Section Break",
				"insert_after": "vunapos_operations_section",
			},
			{
				"fieldname": "vunapos_enable_home_customer_selection",
				"label": "Enable Customer Selection on Home Screen",
				"fieldtype": "Check",
				"insert_after": "vunapos_home_screen_section",
				"description": "Show a searchable customer selector above the item catalogue in VunaPOS Mobile.",
				"default": "0",
			},
			{
				"fieldname": "vunapos_allow_returns",
				"label": "Allow Returns",
				"fieldtype": "Check",
				"insert_after": "vunapos_allow_payment_history",
				"description": "Allow cashiers using this POS Profile to create returns and credit notes.",
				"default": "1",
			},
		],
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
	}
	for invoice_doctype in ("Sales Invoice", "POS Invoice"):
		custom_fields[invoice_doctype].extend(_restaurant_invoice_fields())
	create_custom_fields(custom_fields, ignore_validate=True)
	ensure_sales_invoice_stock_reservation_option()
	ensure_default_service_types()


def _restaurant_invoice_fields():
	"""Restaurant context stamped on the invoice that bills a Restaurant Order."""
	return [
		{
			"fieldname": "vunapos_restaurant_section",
			"label": "Restaurant",
			"fieldtype": "Section Break",
			"insert_after": "vunapos_reservation_fingerprint",
			"collapsible": 1,
		},
		{
			"fieldname": "vunapos_restaurant_order",
			"label": "VunaPOS Restaurant Order",
			"fieldtype": "Link",
			"options": "VunaPOS Restaurant Order",
			"insert_after": "vunapos_restaurant_section",
			"read_only": 1,
			"allow_on_submit": 1,
			"no_copy": 1,
			"search_index": 1,
		},
		{
			"fieldname": "vunapos_service_type",
			"label": "VunaPOS Service Type",
			"fieldtype": "Link",
			"options": "VunaPOS Service Type",
			"insert_after": "vunapos_restaurant_order",
			"read_only": 1,
			"allow_on_submit": 1,
			"no_copy": 1,
		},
		{
			"fieldname": "vunapos_restaurant_table",
			"label": "VunaPOS Restaurant Table",
			"fieldtype": "Link",
			"options": "VunaPOS Restaurant Table",
			"insert_after": "vunapos_service_type",
			"read_only": 1,
			"allow_on_submit": 1,
			"no_copy": 1,
		},
	]


DEFAULT_SERVICE_TYPES = (
	{"service_type_name": "Dine In", "requires_table": 1, "display_order": 1},
	{"service_type_name": "Takeaway", "requires_table": 0, "display_order": 2},
	{"service_type_name": "Delivery", "requires_table": 0, "display_order": 3},
)


def ensure_default_service_types():
	if not frappe.db.table_exists("VunaPOS Service Type") or frappe.db.count("VunaPOS Service Type"):
		return
	for values in DEFAULT_SERVICE_TYPES:
		frappe.get_doc({"doctype": "VunaPOS Service Type", "enabled": 1, **values}).insert(
			ignore_permissions=True
		)


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
