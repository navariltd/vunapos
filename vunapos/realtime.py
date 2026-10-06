import frappe
from frappe.model.document import Document
from frappe.utils import cint, flt

from vunapos.services.catalogue_cache import invalidate_catalogue_cache

DOMAIN_DATA_CHANGED_EVENT = "vunapos_domain_data_changed"
# Keep the descriptive alias for callers that import the old constant name.
CONFIGURATION_EVENT = DOMAIN_DATA_CHANGED_EVENT
CHECKOUT_QUEUE_EVENT = "vunapos_checkout_queue_changed"
GATEWAY_PAYMENT_EVENT = "vunapos_gateway_payment_changed"


def _profile_users(doc: Document) -> set[str]:
	users = set()
	for row in doc.get("applicable_for_users") or []:
		user = getattr(row, "user", None)
		if user is None and isinstance(row, dict):
			user = row.get("user")
		if user:
			users.add(user)
	return users


def _profile_access_signature(doc: Document):
	user_defaults = []
	for row in doc.get("applicable_for_users") or []:
		user = getattr(row, "user", None)
		default = getattr(row, "default", None)
		if isinstance(row, dict):
			user = user or row.get("user")
			default = row.get("default")
		if user:
			user_defaults.append((user, bool(default)))
	return (
		doc.get("company"),
		doc.get("warehouse"),
		bool(doc.get("disabled")),
		tuple(sorted(user_defaults)),
	)


def capture_pos_profile_realtime_recipients(doc: Document, method: str | None = None) -> None:
	"""Capture the pre-save POS Profile scope for reliable invalidation."""
	flags = getattr(doc, "flags", None)
	if flags is None:
		flags = frappe._dict()
		doc.flags = flags
	is_new = getattr(doc, "is_new", lambda: False)()
	if is_new:
		flags.vunapos_previous_profile_users = set()
		flags.vunapos_previous_profile_access_signature = None
		return
	previous = frappe.get_doc("POS Profile", doc.name)
	flags.vunapos_previous_profile_users = _profile_users(previous)
	flags.vunapos_previous_profile_access_signature = _profile_access_signature(previous)


def _publish_domain_data_changed(resource: str, users: set[str]) -> None:
	for user in users:
		if user:
			frappe.publish_realtime(
				DOMAIN_DATA_CHANGED_EVENT,
				{"resource": resource},
				user=user,
				after_commit=True,
			)


def publish_configuration_change(doc: Document, method: str | None = None) -> None:
	"""Invalidate VunaPOS reference data after a committed configuration change."""
	invalidate_catalogue_cache(doc, method)
	if doc.doctype == "POS Profile":
		flags = getattr(doc, "flags", None)
		previous_users = set(getattr(flags, "vunapos_previous_profile_users", None) or set())
		current_users = _profile_users(doc)
		users = previous_users | current_users
		if not users:
			return
		previous_signature = getattr(flags, "vunapos_previous_profile_access_signature", None)
		resource = (
			"posProfileChanged"
			if method == "on_trash" or previous_signature != _profile_access_signature(doc)
			else "referenceDataChanged"
		)
		_publish_domain_data_changed(resource, users)
		return
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
	_publish_domain_data_changed("referenceDataChanged", set(users))


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


def publish_gateway_payment_change(doc: Document) -> None:
	"""Notify only the cashier who owns an active gateway checkout payment."""
	cashier = doc.get("cashier")
	if not cashier:
		return
	frappe.publish_realtime(
		GATEWAY_PAYMENT_EVENT,
		{
			"name": doc.name,
			"source_doctype": doc.get("source_doctype"),
			"source_name": doc.get("source_name"),
			"payment_gateway": doc.get("payment_gateway"),
			"mode_of_payment": doc.get("mode_of_payment"),
			"status": doc.get("status"),
			"transaction_reference": doc.get("transaction_reference"),
			"pos_profile": doc.get("pos_profile"),
			"opening_entry": doc.get("opening_entry"),
			"customer": doc.get("customer"),
			"amount": flt(doc.get("amount")),
			"currency": doc.get("currency"),
			"consumed": cint(doc.get("consumed")),
		},
		user=cashier,
		after_commit=True,
	)
