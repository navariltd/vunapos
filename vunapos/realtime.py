import frappe
from frappe.model.document import Document
from frappe.utils import cint

CONFIGURATION_EVENT = "vunapos_configuration_changed"
CHECKOUT_QUEUE_EVENT = "vunapos_checkout_queue_changed"


def publish_configuration_change(doc: Document, method: str | None = None) -> None:
	"""Tell active VunaPOS terminals to reload their permission-filtered configuration."""
	enabled_profiles = frappe.get_all("POS Profile", filters={"disabled": 0}, pluck="name")
	if not enabled_profiles:
		return
	users = set(
		frappe.get_all(
			"POS Profile User",
			filters={"parenttype": "POS Profile", "parent": ["in", enabled_profiles]},
			pluck="user",
		)
	)
	payload = {
		"doctype": doc.doctype,
		"action": method or "on_update",
		"refresh": "full",
	}
	for user in users:
		if user:
			frappe.publish_realtime(
				CONFIGURATION_EVENT,
				payload,
				user=user,
				after_commit=True,
			)


def publish_checkout_queue_change(doc: Document) -> None:
	"""Notify only the cashier who owns this queued sale after its transaction commits."""
	cashier = doc.get("vunapos_session_cashier")
	if not cashier:
		return
	frappe.publish_realtime(
		CHECKOUT_QUEUE_EVENT,
		{
			"invoice_doctype": doc.doctype,
			"invoice_name": doc.name,
			"pos_profile": doc.get("pos_profile"),
			"opening_entry": doc.get("vunapos_opening_entry"),
			"status": doc.get("vunapos_queue_status"),
			"attempts": cint(doc.get("vunapos_queue_attempts")),
			"error": doc.get("vunapos_queue_error") or "",
		},
		user=cashier,
		after_commit=True,
	)
