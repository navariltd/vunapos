import frappe
from frappe.model.document import Document

CONFIGURATION_EVENT = "vunapos_configuration_changed"


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
