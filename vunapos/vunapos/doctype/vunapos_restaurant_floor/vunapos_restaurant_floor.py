# Copyright (c) 2026, Navari Limited and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from vunapos.services.floor_plan_service import validate_floor_doc


class VunaPOSRestaurantFloor(Document):
	def validate(self):
		validate_floor_doc(self)
