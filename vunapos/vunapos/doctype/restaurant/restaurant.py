# Copyright (c) 2026, Navari Limited and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from vunapos.services.restaurant_service import on_restaurant_update, validate_restaurant_doc


class Restaurant(Document):
	def validate(self):
		validate_restaurant_doc(self)

	def on_update(self):
		on_restaurant_update(self)
