# Copyright (c) 2026, Navari Limited and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from vunapos.services.restaurant_order_service import validate_order_doc


class VunaPOSRestaurantOrder(Document):
	def validate(self):
		try:
			validate_order_doc(self)
		except frappe.ValidationError as exc:
			# VunaPOS errors are raised with a code for the API envelope, but Desk
			# only shows errors that are in the message log. Add it, then re-raise
			# the same exception so API callers still get the code.
			frappe.msgprint(str(exc), title=_("Cannot save order"), indicator="red")
			raise
