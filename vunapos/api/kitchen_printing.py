import frappe

from vunapos.services import kitchen_printing as service


@frappe.whitelist(methods=["POST"])
def claim(station):
	return service.claim(station)


@frappe.whitelist(methods=["POST"])
def dispatch(name, token):
	return service.dispatch(name, token)


@frappe.whitelist(methods=["POST"])
def acknowledge(name, token, submitted=False, error=None):
	return service.acknowledge(name, token, submitted, error)


@frappe.whitelist(methods=["POST"])
def retry(name, reason):
	return service.retry(name, reason)


@frappe.whitelist()
def status(station):
	return service.status(station)


@frappe.whitelist(methods=["POST"])
def update_preparation_notes(ticket, line_id, note, expected_note, request_key):
	from vunapos.services.kitchen_notes import update_preparation_notes as update

	return update(ticket, line_id, note, expected_note, request_key)


@frappe.whitelist(methods=["POST"])
def confirm_delivery(name, reason):
	return service.confirm_delivery(name, reason)
