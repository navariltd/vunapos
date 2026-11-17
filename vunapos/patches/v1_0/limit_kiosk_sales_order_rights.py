import frappe

from vunapos.setup.utils import KIOSK_ROLE

# The first kiosk rule let a kiosk login write and submit its own Sales Orders.
FIRST_RULE = {"read": 1, "write": 1, "create": 1, "submit": 1, "print": 1, "if_owner": 1}
OTHER_RIGHTS = ("select", "delete", "cancel", "amend", "report", "export", "import", "share", "email")


def execute():
	"""A kiosk only creates and reads its orders; the server submits them after its checks.

	ensure_vunapos_roles leaves existing rules alone, so remove write and submit here,
	but only from a rule still as it was first created.
	"""
	rule = frappe.db.get_value(
		"Custom DocPerm",
		{"parent": "Sales Order", "role": KIOSK_ROLE, "permlevel": 0},
		["name", *FIRST_RULE, *OTHER_RIGHTS],
		as_dict=True,
	)
	if (
		rule
		and all(rule.get(right) == value for right, value in FIRST_RULE.items())
		and not any(rule.get(right) for right in OTHER_RIGHTS)
	):
		frappe.db.set_value("Custom DocPerm", rule.name, {"write": 0, "submit": 0})
		frappe.clear_cache(doctype="Sales Order")
