import frappe
from frappe.utils import now

from vunapos.services.invoice_service import create_pos_hold as create_pos_hold_service
from vunapos.services.invoice_service import create_pos_invoice as create_pos_invoice_service
from vunapos.services.sync_service import get_pos_bootstrap as get_pos_bootstrap_service
from vunapos.utils.response import failure, success


def _failure_from_exception(exc):
	return failure(
		str(exc),
		code=getattr(exc, "vuna_error_code", exc.__class__.__name__),
		meta=getattr(exc, "vuna_error_meta", None),
	)


@frappe.whitelist(methods=["GET"], allow_guest=True)  # nosemgrep
def ping():
	# Unauthenticated on purpose: an expired session must not block reachability
	# detection (I3) - the sync engine needs to tell "network is down" apart from
	# "session expired," and re-auth happens around sync, never mid-sale. Returns
	# only the server time, no user/tenant data - reviewed as safe for guest access.
	return success({"server_time": now()})


@frappe.whitelist()
def get_pos_bootstrap(pos_profile: str | None = None, since: str | None = None):
	try:
		return success(get_pos_bootstrap_service(pos_profile=pos_profile, since=since))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def create_pos_invoice(
	payload: dict | str | None = None,
	idempotency_key: str | None = None,
	local_id: str | None = None,
):
	try:
		return success(
			create_pos_invoice_service(
				payload=payload,
				idempotency_key=idempotency_key,
				local_id=local_id,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def create_pos_hold(
	payload: dict | str | None = None,
	idempotency_key: str | None = None,
	local_id: str | None = None,
):
	try:
		return success(
			create_pos_hold_service(
				payload=payload,
				idempotency_key=idempotency_key,
				local_id=local_id,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)
