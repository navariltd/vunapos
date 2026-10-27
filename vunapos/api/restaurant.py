import frappe

from vunapos.services import restaurant_order_service
from vunapos.services.floor_plan_service import get_floor_plan as get_floor_plan_service
from vunapos.services.floor_plan_service import save_floor_plan as save_floor_plan_service
from vunapos.services.menu_service import get_menu as get_menu_service
from vunapos.services.menu_service import list_service_types
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


@frappe.whitelist()
def get_service_types(pos_profile: str):
	try:
		return success(list_service_types(pos_profile))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def get_menu(
	pos_profile: str,
	service_type: str | None = None,
	table: str | None = None,
	query: str | None = None,
	customer: str | None = None,
	price_list: str | None = None,
):
	try:
		return success(
			get_menu_service(
				pos_profile=pos_profile,
				service_type=service_type,
				table=table,
				query=query,
				customer=customer,
				price_list=price_list,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def get_table_status(pos_profile: str):
	try:
		return success(restaurant_order_service.get_table_status(pos_profile=pos_profile))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def create_order(
	pos_profile: str,
	service_type: str | None = None,
	table: str | None = None,
	customer: str | None = None,
	pax: int | str | None = None,
	order_note: str | None = None,
	items: list | str | None = None,
	idempotency_key: str | None = None,
):
	try:
		return success(
			restaurant_order_service.create_order(
				pos_profile=pos_profile,
				service_type=service_type,
				table=table,
				customer=customer,
				pax=pax,
				order_note=order_note,
				items=items,
				idempotency_key=idempotency_key,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def get_order(order: str):
	try:
		return success(restaurant_order_service.get_order(order))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def list_orders(
	pos_profile: str,
	status: str | None = "Open",
	table: str | None = None,
	service_type: str | None = None,
	limit: int | str = 100,
):
	try:
		return success(
			restaurant_order_service.list_orders(
				pos_profile=pos_profile, status=status, table=table, service_type=service_type, limit=limit
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def update_order(
	order: str,
	service_type: str | None = None,
	table: str | None = None,
	customer: str | None = None,
	pax: int | str | None = None,
	order_note: str | None = None,
):
	try:
		return success(
			restaurant_order_service.update_order(
				order,
				service_type=service_type,
				table=table,
				customer=customer,
				pax=pax,
				order_note=order_note,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def add_order_items(order: str, items: list | str):
	try:
		return success(restaurant_order_service.add_items(order, items))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def update_order_item(order: str, line_id: str, qty: float | str | None = None, note: str | None = None):
	try:
		return success(restaurant_order_service.update_item(order, line_id, qty=qty, note=note))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def remove_order_item(order: str, line_id: str, manager_pin_token: str | None = None):
	try:
		return success(
			restaurant_order_service.remove_item(order, line_id, manager_pin_token=manager_pin_token)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def cancel_order(order: str, reason: str | None = None, manager_pin_token: str | None = None):
	try:
		return success(
			restaurant_order_service.cancel_order(order, reason=reason, manager_pin_token=manager_pin_token)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def checkout_order(
	order: str,
	payments: list | str | None = None,
	idempotency_key: str | None = None,
	customer: str | None = None,
	is_credit_sale: bool | int | str = False,
	due_date: str | None = None,
	price_list: str | None = None,
	loyalty_points: int | str | None = None,
	tax_id: str | None = None,
	shipping_address_name: str | None = None,
	salesperson: str | None = None,
	salesperson_token: str | None = None,
	checkout_fields: dict | str | None = None,
):
	try:
		return success(
			restaurant_order_service.checkout_order(
				order,
				payments=payments,
				idempotency_key=idempotency_key,
				customer=customer,
				is_credit_sale=is_credit_sale,
				due_date=due_date,
				price_list=price_list,
				loyalty_points=loyalty_points,
				tax_id=tax_id,
				shipping_address_name=shipping_address_name,
				salesperson=salesperson,
				salesperson_token=salesperson_token,
				checkout_fields=checkout_fields,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def preview_order(order: str, customer: str | None = None):
	try:
		return success(restaurant_order_service.preview_order(order, customer=customer))
	except Exception as exc:
		return _failure_from_exception(exc)
