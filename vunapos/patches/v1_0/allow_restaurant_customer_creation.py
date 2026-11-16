import frappe

from vunapos.setup.utils import CASHIER_ROLE, RESTAURANT_MANAGER_ROLE, WAITER_ROLE

ROLES = (WAITER_ROLE, CASHIER_ROLE, RESTAURANT_MANAGER_ROLE)
OTHER_RIGHTS = (
	"select",
	"write",
	"create",
	"delete",
	"submit",
	"cancel",
	"amend",
	"report",
	"export",
	"import",
	"share",
	"print",
	"email",
	"if_owner",
)


def execute():
	"""Let restaurant sellers create customers.

	ensure_vunapos_roles leaves existing rules alone, so it can't add the right to
	the read-only rule it created earlier. Upgrade only rules still in that state;
	a rule changed in Role Permissions Manager is kept as it is.
	"""
	for role in ROLES:
		rule = frappe.db.get_value(
			"Custom DocPerm",
			{"parent": "Customer", "role": role, "permlevel": 0},
			["name", "read", *OTHER_RIGHTS],
			as_dict=True,
		)
		if rule and rule.read and not any(rule.get(right) for right in OTHER_RIGHTS):
			frappe.db.set_value("Custom DocPerm", rule.name, "create", 1)
	frappe.clear_cache(doctype="Customer")
