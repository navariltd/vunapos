from frappe.model.document import Document


class KitchenOrderTicket(Document):
	def validate(self):
		from vunapos.services.kitchen_service import validate_ticket

		validate_ticket(self)

	def before_update_after_submit(self):
		from vunapos.services.kitchen_service import reject_ticket_mutation

		reject_ticket_mutation()

	def before_cancel(self):
		from vunapos.services.kitchen_service import reject_ticket_mutation

		reject_ticket_mutation()
