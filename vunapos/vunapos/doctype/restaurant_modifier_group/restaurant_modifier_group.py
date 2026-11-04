from frappe.model.document import Document

from vunapos.services.modifier_service import validate_modifier_group


class RestaurantModifierGroup(Document):
	def validate(self):
		validate_modifier_group(self)
