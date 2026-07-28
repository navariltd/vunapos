import frappe
from frappe.utils import now

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
	# detection can tell "network is down" apart from "session expired." Returns
	# only the server time, no user/tenant data - reviewed as safe for guest access.
	return success({"server_time": now()})


@frappe.whitelist()
def get_pos_bootstrap(pos_profile: str | None = None, since: str | None = None):
	try:
		return success(get_pos_bootstrap_service(pos_profile=pos_profile, since=since))
	except Exception as exc:
		return _failure_from_exception(exc)
