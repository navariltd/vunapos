import frappe
from frappe import _


class VunaPOSCreditSaleMixin:
	def validate_full_payment(self) -> None:
		if not self.get("vunapos_credit_sale"):
			return super().validate_full_payment()

		if not self.get("vunapos_invoice"):
			frappe.throw(_("Only VunaPOS invoices can use the VunaPOS credit-sale flag"))
		if not frappe.db.get_value("POS Profile", self.get("pos_profile"), "vunapos_allow_credit_sales"):
			frappe.throw(_("Credit sales are not allowed for this POS Profile"))

		# VunaPOS has already validated the explicit credit-sale request, customer,
		# payments and outstanding balance. Preserve every other native validation.
