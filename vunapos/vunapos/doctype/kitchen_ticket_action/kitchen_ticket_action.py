import frappe
from frappe.model.document import Document


class KitchenTicketAction(Document):
	def validate(self):
		from vunapos.services.kitchen_service import reject_ticket_mutation

		if not self.is_new() or not frappe.flags.get("vunapos_recording_kitchen_action"):
			reject_ticket_mutation()
		if self.actor != frappe.session.user:
			reject_ticket_mutation()

	def on_trash(self):
		from vunapos.services.kitchen_service import reject_ticket_mutation

		reject_ticket_mutation()
