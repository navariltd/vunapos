import frappe
from frappe.model.document import Document

CONFIGURATION_EVENT = "vunapos_configuration_changed"


def publish_configuration_change(doc: Document, method: str | None = None) -> None:
	"""Tell active VunaPOS terminals to reload their permission-filtered configuration."""
	frappe.publish_realtime(
		CONFIGURATION_EVENT,
		{
			"doctype": doc.doctype,
			"action": method or "on_update",
			"refresh": "full",
		},
		after_commit=True,
	)
