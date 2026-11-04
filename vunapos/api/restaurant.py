import frappe

from vunapos.services.floor_plan_service import get_floor_plan as get_floor_plan_service
from vunapos.services.floor_plan_service import save_floor_plan as save_floor_plan_service
from vunapos.utils.response import failure, success


def _failure_from_exception(exc):
	return failure(
		str(exc),
		code=getattr(exc, "vuna_error_code", exc.__class__.__name__),
		meta=getattr(exc, "vuna_error_meta", None),
	)


@frappe.whitelist()
def get_floor_plan(pos_profile: str):
	try:
		return success(get_floor_plan_service(pos_profile=pos_profile))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def save_floor_plan(pos_profile: str, payload: dict | str):
	try:
		return success(save_floor_plan_service(pos_profile=pos_profile, payload=payload))
	except Exception as exc:
		return _failure_from_exception(exc)
