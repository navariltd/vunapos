import frappe
from frappe.model.document import Document


class RestaurantRequest(Document):
	def validate(self):
		if not self.is_new() or not self.flags.restaurant_request_write:
			frappe.throw(
				"Restaurant request receipts are managed by placement actions.", frappe.PermissionError
			)

	def on_trash(self):
		frappe.throw("Restaurant request receipts cannot be deleted.", frappe.PermissionError)
