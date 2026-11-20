from functools import wraps

import frappe
from frappe.rate_limiter import rate_limit

from vunapos.api.restaurant import _atomic_write, _failure_from_exception, _staff_only
from vunapos.services import qr_order_service
from vunapos.utils.response import failure, success

GUEST_ERROR = "This order could not be sent. Please ask a waiter."


def _guest_action(fn):
	"""Guests see the message of a known order error only, never internal details."""

	@wraps(fn)
	def wrapped(*args, **kwargs):
		try:
			return success(fn(*args, **kwargs))
		except frappe.ValidationError as exc:
			code = getattr(exc, "vuna_error_code", None)
			if not code:
				frappe.log_error("QR table order failed")
				return failure(GUEST_ERROR, code="QR_ORDER_FAILED")
			return failure(frappe.utils.strip_html(str(exc)).strip() or GUEST_ERROR, code=code)
		except frappe.PermissionError as exc:
			code = getattr(exc, "vuna_error_code", None)
			if code == "QR_GUEST_ONLY":
				return failure(str(exc), code=code)
			frappe.log_error("QR table order refused")
			return failure(GUEST_ERROR, code="QR_ORDER_FAILED")
		except Exception:
			frappe.log_error("QR table order failed")
			return failure(GUEST_ERROR, code="QR_ORDER_FAILED")

	return wrapped


# Guests share a restaurant's network, so limits count per address and table code.
# nosemgrep: guest-whitelisted-method -- QR guests never sign in; token-checked, rate limited
@frappe.whitelist(allow_guest=True)
@rate_limit(key="token", limit=60, seconds=10 * 60)
@_guest_action
def get_table_order(token: str):
	return qr_order_service.get_table_order(token)


# nosemgrep: guest-whitelisted-method -- QR guests never sign in; token-checked, rate limited
@frappe.whitelist(allow_guest=True)
@rate_limit(key="token", limit=300, seconds=10 * 60)
@_guest_action
def get_table_menu(token: str, query: str | None = None):
	return qr_order_service.get_table_menu(token, query)


# nosemgrep: guest-whitelisted-method -- QR guests never sign in; token-checked, rate limited
@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(key="token", limit=6, seconds=10 * 60)
@_atomic_write
@_guest_action
def place_table_order(token: str, items: list | str, idempotency_key: str, order_note: str | None = None):
	return qr_order_service.place_order(token, items, idempotency_key, order_note)


# nosemgrep: guest-whitelisted-method -- QR guests never sign in; token-checked, rate limited
@frappe.whitelist(allow_guest=True)
@rate_limit(key="token", limit=240, seconds=10 * 60)
@_guest_action
def get_table_order_status(token: str, order: str):
	return qr_order_service.get_order_status(token, order)


@frappe.whitelist(methods=["POST"])
@_staff_only
@_atomic_write
def accept_qr_order(session: str, pos_profile: str):
	try:
		return success(qr_order_service.accept_order(session, pos_profile))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_staff_only
@_atomic_write
def reject_qr_order(session: str, reason: str, pos_profile: str):
	try:
		return success(qr_order_service.reject_order(session, reason, pos_profile))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
@_staff_only
def get_qr_tables(pos_profile: str):
	try:
		return success(qr_order_service.get_qr_tables(pos_profile))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_staff_only
@_atomic_write
def print_table_qr_cards(pos_profile: str, tables: list | str):
	try:
		return success(qr_order_service.print_cards(pos_profile, tables))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_staff_only
@_atomic_write
def regenerate_table_qr(pos_profile: str, table: str):
	try:
		return success(qr_order_service.regenerate_code(pos_profile, table))
	except Exception as exc:
		return _failure_from_exception(exc)
