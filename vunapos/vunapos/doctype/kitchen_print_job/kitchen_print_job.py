import frappe
from frappe.model.document import Document


class KitchenPrintJob(Document):
	def validate(self):
		if not frappe.flags.get("kitchen_print_job_write"):
			frappe.throw("Use the kitchen printing controls.", frappe.PermissionError)

	def on_trash(self):
		frappe.throw("Delivery history cannot be deleted.", frappe.PermissionError)


def on_doctype_update():
	frappe.db.add_index(
		"Kitchen Print Job", ["kitchen_station", "status", "creation"], "station_delivery_queue"
	)
	frappe.db.add_index("Kitchen Print Job", ["status", "lease_until"], "delivery_recovery")
