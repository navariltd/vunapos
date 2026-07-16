import frappe
from frappe import _
from frappe.utils import now_datetime


def create_pos_opening_entry(
	pos_profile: str,
	opening_balance: list[dict],
	user: str,
):
	"""
	Create and submit a POS Opening Entry
	"""

	if not pos_profile:
		frappe.throw(_("POS Profile is required"))

	if not opening_balance:
		frappe.throw(_("Opening balances are required"))

	profile = frappe.get_cached_doc("POS Profile", pos_profile)

	if profile.disabled:
		frappe.throw(_("POS Profile {0} is disabled").format(profile.name))

	existing = frappe.db.exists(
		"POS Opening Entry",
		{
			"user": user,
			"pos_profile": pos_profile,
			"status": "Open",
			"docstatus": 1,
		},
	)

	if existing:
		frappe.throw(_("An open POS session already exists for profile {0}").format(pos_profile))

	opening_entry = frappe.new_doc("POS Opening Entry")

	opening_entry.user = user
	opening_entry.company = profile.company
	opening_entry.pos_profile = profile.name
	opening_entry.period_start_date = now_datetime()

	for row in opening_balance:
		opening_entry.append(
			"balance_details",
			{
				"mode_of_payment": row.get("mode_of_payment"),
				"opening_amount": row.get("opening_amount", 0),
			},
		)

	opening_entry.insert()
	opening_entry.submit()

	return opening_entry
