import frappe
from frappe import _


class VunaPOSOpeningEntryMixin:
	"""Scope open POS sessions to the cashier and POS Profile pair."""

	def check_open_pos_exists(self):
		filters = {
			"user": self.user,
			"pos_profile": self.pos_profile,
			"status": "Open",
			"docstatus": 1,
		}
		if self.name:
			filters["name"] = ["!=", self.name]

		if frappe.db.exists("POS Opening Entry", filters):
			frappe.throw(
				title=_("POS Opening Entry Exists"),
				msg=_(
					"Cashier {0} already has an open session for POS Profile {1}. Close or cancel it before opening another."
				).format(frappe.bold(self.user), frappe.bold(self.pos_profile)),
			)

	def check_user_already_assigned(self):
		# ERPNext normally prevents a cashier from having any other open POS
		# session. VunaPOS uses (cashier, profile) as the session identity, so the
		# composite duplicate check above is the complete constraint.
		return
