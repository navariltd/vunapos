import frappe

from vunapos.services.pos_closing import close_pos_session, get_closing_preview
from vunapos.utils.response import failure, success


def _failure_from_exception(exc):
	return failure(
		str(exc),
		code=getattr(exc, "vuna_error_code", exc.__class__.__name__),
		meta=getattr(exc, "vuna_error_meta", None),
	)


@frappe.whitelist(methods=["GET"])
def get_preview(pos_profile=None):
	try:
		return success(get_closing_preview(pos_profile))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def close_session():
	try:
		data = frappe.request.get_json() or {}
		result = close_pos_session(
			pos_profile=data.get("pos_profile"),
			closing_balances=data.get("closing_balances"),
		)
		frappe.db.commit()
		return success(result)
	except Exception as exc:
		frappe.db.rollback()
		return _failure_from_exception(exc)
