import frappe

from vunapos.services import kitchen_printing as service


@frappe.whitelist(methods=["POST"])
def claim(station: str) -> dict | None:
	return service.claim(station)


@frappe.whitelist(methods=["POST"])
def dispatch(name: str, token: str) -> dict:
	return service.dispatch(name, token)


@frappe.whitelist(methods=["POST"])
def acknowledge(
	name: str,
	token: str,
	submitted: bool | int | str = False,
	error: str | None = None,
) -> dict:
	return service.acknowledge(name, token, submitted, error)


@frappe.whitelist(methods=["POST"])
def retry(name: str, reason: str) -> dict:
	return service.retry(name, reason)


@frappe.whitelist()
def status(station: str) -> list[dict]:
	return service.status(station)


@frappe.whitelist(methods=["POST"])
def update_preparation_notes(
	ticket: str, line_id: str, note: str, expected_note: str, request_key: str
) -> dict:
	from vunapos.services.kitchen_notes import update_preparation_notes as update

	return update(ticket, line_id, note, expected_note, request_key)


@frappe.whitelist(methods=["POST"])
def confirm_delivery(name: str, reason: str) -> dict:
	return service.confirm_delivery(name, reason)


@frappe.whitelist(methods=["POST"])
def claim_many(stations: str | list[str]) -> dict | None:
	return service.claim_many(stations)


@frappe.whitelist()
def status_many(stations: str | list[str]) -> list[dict]:
	return service.status_many(stations)


@frappe.whitelist()
def configuration(pos_profile: str) -> dict:
	return service.configuration(pos_profile)


@frappe.whitelist()
def all_day(pos_profile: str, station: str | None = None) -> list[dict]:
	return service.all_day(pos_profile, station)
