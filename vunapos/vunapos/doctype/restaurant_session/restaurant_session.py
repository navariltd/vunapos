from frappe.model.document import Document


class RestaurantSession(Document):
	def validate(self):
		from vunapos.services.restaurant_session_service import validate_session

		validate_session(self)
