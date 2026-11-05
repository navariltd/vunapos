import frappe
from frappe import _
from frappe.utils import getdate

from vunapos.services.service_type_service import apply_service_type_pricing


class VunaPOSServiceTypePricingMixin:
	"""Keep a restaurant service type's price list and taxes on its invoice."""

	def validate_pos_opening_entry(self):
		if not self.get("vunapos_restaurant_session"):
			return super().validate_pos_opening_entry()
		name = self.get("vunapos_opening_entry")
		if not name:
			frappe.throw(
				_("A verified cashier opening is required for restaurant billing."), frappe.PermissionError
			)
		opening = frappe.get_doc("POS Opening Entry", name)
		if (
			opening.docstatus != 1
			or opening.status != "Open"
			or opening.pos_profile != self.pos_profile
			or opening.user != (self.owner or frappe.session.user)
		):
			frappe.throw(
				_(
					"The restaurant bill's opening must belong to its cashier and POS Profile and still be open."
				),
				frappe.PermissionError,
			)
		if getdate(opening.period_start_date) != getdate(self.posting_date):
			frappe.throw(_("The cashier opening is outdated for this bill. Close it and open a new shift."))

	def set_pos_fields(self, for_validate=False):
		pos = super().set_pos_fields(for_validate)
		if pos and self.get("vunapos_restaurant_session"):
			self.selling_price_list = frappe.db.get_value(
				"Restaurant Session", self.vunapos_restaurant_session, "selling_price_list"
			)
			self.ignore_pricing_rule = 1
			return pos
		if pos and self.get("vunapos_service_type"):
			apply_service_type_pricing(self, pos, for_validate)
		return pos
