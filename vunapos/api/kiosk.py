import frappe

from vunapos.api.restaurant import _atomic_write, _failure_from_exception
from vunapos.services import kiosk_service
from vunapos.utils.response import success


@frappe.whitelist()
def get_kiosk_setup(pos_profile: str):
	try:
		return success(kiosk_service.get_setup(pos_profile))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_atomic_write
def place_kiosk_order(
	pos_profile: str,
	service_type: str,
	items: list | str,
	idempotency_key: str,
	table: str | None = None,
	order_note: str | None = None,
):
	try:
		return success(
			kiosk_service.place_order(pos_profile, service_type, items, idempotency_key, table, order_note)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_atomic_write
def confirm_kiosk_payment(
	session: str,
	pos_profile: str,
	fingerprint: str,
	payments: list | str | None = None,
	is_credit_sale: bool | int | str = False,
	due_date: str | None = None,
	loyalty_points: int | str | None = None,
	tax_id: str | None = None,
	shipping_address_name: str | None = None,
	checkout_fields: dict | str | None = None,
):
	try:
		return success(
			kiosk_service.confirm_payment(
				session,
				pos_profile,
				fingerprint,
				payments,
				is_credit_sale=is_credit_sale,
				due_date=due_date,
				loyalty_points=loyalty_points,
				tax_id=tax_id,
				shipping_address_name=shipping_address_name,
				checkout_fields=checkout_fields,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_atomic_write
def cancel_kiosk_order(session: str, reason: str, pos_profile: str, manager_pin_token: str | None = None):
	try:
		return success(kiosk_service.cancel_order(session, reason, pos_profile, manager_pin_token))
	except Exception as exc:
		return _failure_from_exception(exc)
