import frappe
from frappe import _


class VunaPOSOpeningEntryMixin:
	"""Allow only one open POS shift per cashier across all profiles."""

	def check_open_pos_exists(self):
		filters = {
			"user": self.user,
			"status": "Open",
			"docstatus": 1,
		}
		if self.name:
			filters["name"] = ["!=", self.name]

		if frappe.db.exists("POS Opening Entry", filters):
			frappe.throw(
				title=_("POS Opening Entry Exists"),
				msg=_(
					"Cashier {0} already has an open POS shift. Close or cancel it before opening another."
				).format(frappe.bold(self.user)),
			)

	def check_user_already_assigned(self):
		# The global cashier constraint is enforced by check_open_pos_exists with
		# VunaPOS's submitted/open filters and clearer error message.
		return
