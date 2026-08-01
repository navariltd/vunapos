import frappe
from frappe.model.document import Document


class VunaPOSGatewayPaymentLink(Document):
	def validate(self):
		if self.consumed and not self.consumed_on:
			self.consumed_on = frappe.utils.now_datetime()
		if self.consumed and not self.consumed_by:
			self.consumed_by = frappe.session.user
