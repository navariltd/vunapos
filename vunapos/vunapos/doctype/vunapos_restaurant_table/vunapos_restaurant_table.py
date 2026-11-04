# Copyright (c) 2026, Navari Limited and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from vunapos.services.floor_plan_service import validate_table_doc


class VunaPOSRestaurantTable(Document):
	def validate(self):
		validate_table_doc(self)
