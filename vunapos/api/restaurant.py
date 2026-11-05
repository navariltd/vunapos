from functools import wraps
from uuid import uuid4

import frappe

from vunapos.services import restaurant_order_service, restaurant_session_service
from vunapos.services.floor_plan_service import get_floor_plan as get_floor_plan_service
from vunapos.services.floor_plan_service import save_floor_plan as save_floor_plan_service
from vunapos.services.menu_service import get_menu as get_menu_service
from vunapos.services.menu_service import list_service_types
from vunapos.utils.response import failure, success


def _atomic_write(fn):
	"""Caught errors still return HTTP 200; roll back before Frappe commits that request."""

	@wraps(fn)
	def wrapped(*args, **kwargs):
		savepoint = f"restaurant_{uuid4().hex}"
		frappe.db.savepoint(savepoint)
		try:
			result = fn(*args, **kwargs)
			if not result.get("ok"):
				frappe.db.rollback(save_point=savepoint)
			return result
		except Exception:
			frappe.db.rollback(save_point=savepoint)
			raise

	return wrapped


def _failure_from_exception(exc):
	message = frappe.utils.strip_html(str(exc)).strip()
	if not message and isinstance(exc, frappe.PermissionError):
		message = "You do not have permission for this restaurant action. Ask a manager to check your role, Restaurant, Branch and Kitchen Station access."
	return failure(
		message or "The restaurant action could not be completed.",
		code=getattr(exc, "vuna_error_code", exc.__class__.__name__),
		meta=getattr(exc, "vuna_error_meta", None),
	)


@frappe.whitelist()
def get_kitchen_board(pos_profile: str, station: str | None = None, history: int = 0, start: int = 0):
	from vunapos.services.kitchen_lifecycle_service import list_board

	try:
		return success(list_board(pos_profile, station, history, start))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def kitchen_action(ticket: str, action: str, request_key: str, expected_status: str):
	from vunapos.services.kitchen_lifecycle_service import transition

	# The command owns its rollback. A failure audit must survive an HTTP-200
	# structured error, unlike the _atomic_write endpoints used for placement.
	try:
		return success(transition(ticket, action, request_key, expected_status))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def cancel_kitchen_order(
	ticket: str, request_key: str, expected_status: str, reason: str, manager_pin_token: str | None = None
):
	from vunapos.services.kitchen_lifecycle_service import cancel_order

	try:
		return success(cancel_order(ticket, request_key, expected_status, reason, manager_pin_token))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def validate_cart(
	pos_profile: str,
	service_type: str,
	items: list | str,
	table: str | None = None,
	customer: str | None = None,
	kitchen_routing: dict | str | None = None,
	price_list: str | None = None,
):
	from vunapos.services.restaurant_stock_service import validate_cart as validate

	try:
		return success(
			validate(pos_profile, service_type, items, table, customer, kitchen_routing, price_list)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def preview_cart(
	pos_profile: str,
	service_type: str,
	items: list | str,
	table: str | None = None,
	customer: str | None = None,
	price_list: str | None = None,
):
	from vunapos.services.restaurant_stock_service import preview_cart as preview

	try:
		return success(preview(pos_profile, service_type, items, table, customer, price_list))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_atomic_write
def open_session(
	pos_profile: str,
	idempotency_key: str,
	tables: list | str | None = None,
	service_type: str | None = None,
	customer: str | None = None,
	guest_count: int = 0,
):
	try:
		return success(
			restaurant_session_service.open_session(
				pos_profile, idempotency_key, tables, service_type, customer, guest_count
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def get_session(session: str):
	try:
		return success(restaurant_session_service.get_session(session))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def get_kitchen_ticket(ticket: str):
	from vunapos.services.kitchen_service import get_ticket

	try:
		return success(get_ticket(ticket))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def list_sessions(pos_profile: str):
	try:
		return success(restaurant_session_service.list_sessions(pos_profile))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_atomic_write
def update_session(
	session: str,
	tables: list | str | None = None,
	guest_count: int | None = None,
	customer: str | None = None,
	waiter: str | None = None,
):
	try:
		return success(
			restaurant_session_service.update_session(session, tables, guest_count, customer, waiter)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_atomic_write
def cancel_empty_session(session: str):
	try:
		return success(restaurant_session_service.cancel_empty_session(session))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_atomic_write
def create_session_round(
	session: str,
	items: list | str,
	idempotency_key: str,
	order_note: str | None = None,
	pos_profile: str | None = None,
	kitchen_routing: dict | str | None = None,
):
	try:
		return success(
			restaurant_session_service.create_round(
				session, items, idempotency_key, order_note, pos_profile, kitchen_routing
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def get_floor_plan(pos_profile: str):
	try:
		return success(get_floor_plan_service(pos_profile=pos_profile))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_atomic_write
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
@_atomic_write
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
@_atomic_write
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
@_atomic_write
def add_order_items(order: str, items: list | str):
	try:
		return success(restaurant_order_service.add_items(order, items))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_atomic_write
def update_order_item(order: str, line_id: str, qty: float | str | None = None, note: str | None = None):
	try:
		return success(restaurant_order_service.update_item(order, line_id, qty=qty, note=note))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_atomic_write
def remove_order_item(order: str, line_id: str, manager_pin_token: str | None = None):
	try:
		return success(
			restaurant_order_service.remove_item(order, line_id, manager_pin_token=manager_pin_token)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_atomic_write
def cancel_order(order: str, reason: str | None = None, manager_pin_token: str | None = None):
	try:
		return success(
			restaurant_order_service.cancel_order(order, reason=reason, manager_pin_token=manager_pin_token)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
@_atomic_write
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
	pos_profile: str | None = None,
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
				pos_profile=pos_profile,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def preview_order(order: str, customer: str | None = None, pos_profile: str | None = None):
	try:
		return success(
			restaurant_order_service.preview_order(order, customer=customer, pos_profile=pos_profile)
		)
	except Exception as exc:
		return _failure_from_exception(exc)
