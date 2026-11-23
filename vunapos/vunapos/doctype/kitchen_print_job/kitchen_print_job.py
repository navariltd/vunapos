import frappe
from frappe import _
from frappe.model.document import Document


class KitchenPrintJob(Document):
	def validate(self):
		if not frappe.flags.get("kitchen_print_job_write"):
			frappe.throw(_("Use the kitchen printing controls."), frappe.PermissionError)

	def on_update(self):
		# Permission-checked station rooms; never broadcast order identifiers site-wide.
		frappe.publish_realtime(
			"vunapos_kitchen_print_job_queued",
			{"kitchen_station": self.kitchen_station, "status": self.status, "ticket_kind": self.ticket_kind},
			doctype="Kitchen Station",
			docname=self.kitchen_station,
			after_commit=True,
		)

	def on_trash(self):
		frappe.throw(_("Delivery history cannot be deleted."), frappe.PermissionError)


def on_doctype_update():
	frappe.db.add_index(
		"Kitchen Print Job", ["kitchen_station", "status", "creation"], "station_delivery_queue"
	)
	frappe.db.add_index("Kitchen Print Job", ["status", "lease_until"], "delivery_recovery")
