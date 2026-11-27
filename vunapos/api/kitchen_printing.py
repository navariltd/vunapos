import frappe
from frappe.rate_limiter import rate_limit

from vunapos.services import kitchen_printing as service


@frappe.whitelist(methods=["POST"])
def claim(station: str, pos_profile: str | None = None) -> dict | None:
	return service.claim(station, pos_profile)


@frappe.whitelist(methods=["POST"])
def release_claim(name: str, token: str, pos_profile: str | None = None) -> None:
	service.release_claim(name, token, pos_profile)


@frappe.whitelist(methods=["POST"])
def dispatch(name: str, token: str, pos_profile: str | None = None) -> dict:
	return service.dispatch(name, token, pos_profile)


@frappe.whitelist(methods=["POST"])
def acknowledge(
	name: str,
	token: str,
	submitted: bool | int | str = False,
	error: str | None = None,
	pos_profile: str | None = None,
) -> dict:
	return service.acknowledge(name, token, submitted, error, pos_profile)


@frappe.whitelist(methods=["POST"])
def retry(name: str, reason: str) -> dict:
	return service.retry(name, reason)


@frappe.whitelist()
def status(station: str, pos_profile: str | None = None) -> list[dict]:
	return service.status(station, pos_profile)


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
def claim_many(stations: str | list[str], pos_profile: str | None = None) -> dict | None:
	return service.claim_many(stations, pos_profile)


@frappe.whitelist()
def status_many(stations: str | list[str], pos_profile: str | None = None) -> list[dict]:
	return service.status_many(stations, pos_profile)


@frappe.whitelist()
def configuration(pos_profile: str) -> dict:
	return service.configuration(pos_profile)


@frappe.whitelist()
def all_day(pos_profile: str, station: str | None = None) -> dict:
	return service.all_day(pos_profile, station)


@frappe.whitelist()
def signing_certificate(pos_profile: str) -> dict:
	from vunapos.services.qz_signing import certificate

	return certificate(pos_profile)


@frappe.whitelist(methods=["POST"])
@rate_limit(limit=300, seconds=60)
def sign_request(message: str, pos_profile: str) -> str:
	from vunapos.services.qz_signing import sign

	return sign(message, pos_profile)
