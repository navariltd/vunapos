import frappe
from frappe.model.document import Document


def on_doctype_update():
	frappe.db.add_index("Restaurant Availability", ["restaurant", "branch", "paused"])


class RestaurantAvailability(Document):
	def check_if_latest(self):
		from vunapos.services.restaurant_availability_service import lock_branch

		# Native save locks the old document in check_if_latest. Take the shared
		# acceptance lock first: Branch -> Availability, just like placement.
		branch = self.branch if self.is_new() else frappe.db.get_value(self.doctype, self.name, "branch")
		if branch:
			lock_branch(branch)
		return super().check_if_latest()

	def validate(self):
		from vunapos.services.restaurant_availability_service import validate

		validate(self)
