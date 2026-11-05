# Copyright (c) 2026, Navari Limited and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from vunapos.services.menu_service import validate_menu_doc


class RestaurantMenu(Document):
	def validate(self):
		validate_menu_doc(self)
