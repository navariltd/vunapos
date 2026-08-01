import frappe

from vunapos.services.checkout_queue_service import get_checkout_queue as get_checkout_queue_service
from vunapos.services.checkout_queue_service import retry_queued_invoice as retry_queued_invoice_service
from vunapos.services.invoice_history_service import get_invoice_details as get_invoice_details_service
from vunapos.services.invoice_history_service import get_invoice_history as get_invoice_history_service
from vunapos.services.invoice_return_service import create_invoice_return as create_invoice_return_service
from vunapos.services.invoice_return_service import get_return_preview as get_return_preview_service
from vunapos.services.invoice_service import add_item as add_item_service
from vunapos.services.invoice_service import checkout_invoice as checkout_invoice_service
from vunapos.services.invoice_service import clear_invoice as clear_invoice_service
from vunapos.services.invoice_service import create_and_submit_invoice as create_and_submit_invoice_service
from vunapos.services.invoice_service import (
	create_and_submit_sales_order as create_and_submit_sales_order_service,
)
from vunapos.services.invoice_service import create_draft_invoice
from vunapos.services.invoice_service import create_invoice_from_cart as create_invoice_from_cart_service
from vunapos.services.invoice_service import get_invoice as get_invoice_service
from vunapos.services.invoice_service import hold_invoice as hold_invoice_service
from vunapos.services.invoice_service import list_held_invoices as list_held_invoices_service
from vunapos.services.invoice_service import preview_invoice as preview_invoice_service
from vunapos.services.invoice_service import remove_item as remove_item_service
from vunapos.services.invoice_service import restore_invoice as restore_invoice_service
from vunapos.services.invoice_service import submit_invoice as submit_invoice_service
from vunapos.services.invoice_service import update_invoice_from_cart as update_invoice_from_cart_service
from vunapos.services.invoice_service import update_item as update_item_service
from vunapos.utils.response import failure, success


def _failure_from_exception(exc):
	return failure(
		str(exc),
		code=getattr(exc, "vuna_error_code", exc.__class__.__name__),
		meta=getattr(exc, "vuna_error_meta", None),
	)


@frappe.whitelist()
def create_invoice(
	pos_profile: str | None = None,
	customer: str | None = None,
	price_list: str | None = None,
):
	try:
		return success(
			create_draft_invoice(pos_profile=pos_profile, customer=customer, price_list=price_list)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def preview_invoice(
	pos_profile: str | None = None,
	customer: str | None = None,
	items: list | str | None = None,
	invoice_doctype: str | None = None,
	price_list: str | None = None,
	loyalty_points: int | str | None = None,
):
	try:
		return success(
			preview_invoice_service(
				pos_profile=pos_profile,
				customer=customer,
				items=items,
				invoice_doctype=invoice_doctype,
				price_list=price_list,
				loyalty_points=loyalty_points,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def checkout_invoice(
	invoice_doctype: str,
	invoice_name: str,
	payments: list | str | None = None,
	idempotency_key: str | None = None,
	is_credit_sale: bool | int | str = False,
	due_date: str | None = None,
	loyalty_points: int | str | None = None,
	tax_id: str | None = None,
):
	try:
		return success(
			checkout_invoice_service(
				invoice_doctype=invoice_doctype,
				invoice_name=invoice_name,
				payments=payments,
				idempotency_key=idempotency_key,
				is_credit_sale=is_credit_sale,
				due_date=due_date,
				loyalty_points=loyalty_points,
				tax_id=tax_id,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def get_invoice(invoice_doctype, invoice_name):
	try:
		return success(get_invoice_service(invoice_doctype=invoice_doctype, invoice_name=invoice_name))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def get_invoice_history(
	pos_profile: str | None = None,
	invoice: str | None = None,
	customer: str | None = None,
	from_date: str | None = None,
	to_date: str | None = None,
	status: str | None = None,
	payment_mode: str | None = None,
	sale_type: str | None = None,
	current_shift: int | str = 1,
	start: int | str = 0,
	page_length: int | str = 50,
):
	try:
		return success(
			get_invoice_history_service(
				pos_profile=pos_profile,
				invoice=invoice,
				customer=customer,
				from_date=from_date,
				to_date=to_date,
				status=status,
				payment_mode=payment_mode,
				sale_type=sale_type,
				current_shift=current_shift,
				start=start,
				page_length=page_length,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def get_checkout_queue(pos_profile: str):
	try:
		return success(get_checkout_queue_service(pos_profile))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def retry_queued_invoice(pos_profile: str, invoice_name: str):
	try:
		return success(retry_queued_invoice_service(pos_profile, invoice_name))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def get_invoice_details(pos_profile: str | None = None, invoice_name: str | None = None):
	try:
		return success(get_invoice_details_service(pos_profile=pos_profile, invoice_name=invoice_name))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def get_return_preview(pos_profile: str | None = None, invoice_name: str | None = None):
	try:
		return success(get_return_preview_service(pos_profile=pos_profile, invoice_name=invoice_name))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def create_invoice_return(
	pos_profile: str | None = None,
	invoice_name: str | None = None,
	items: list | str | None = None,
	reason: str | None = None,
	idempotency_key: str | None = None,
):
	try:
		return success(
			create_invoice_return_service(
				pos_profile=pos_profile,
				invoice_name=invoice_name,
				items=items,
				reason=reason,
				idempotency_key=idempotency_key,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def add_item(invoice_doctype, invoice_name, item_code, qty=1):
	try:
		return success(
			add_item_service(
				invoice_doctype=invoice_doctype,
				invoice_name=invoice_name,
				item_code=item_code,
				qty=qty,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def update_item(invoice_doctype, invoice_name, row_name, qty):
	try:
		return success(
			update_item_service(
				invoice_doctype=invoice_doctype,
				invoice_name=invoice_name,
				row_name=row_name,
				qty=qty,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def remove_item(invoice_doctype, invoice_name, row_name):
	try:
		return success(
			remove_item_service(
				invoice_doctype=invoice_doctype,
				invoice_name=invoice_name,
				row_name=row_name,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def submit_invoice(
	invoice_doctype: str,
	invoice_name: str,
	payments: list | str | None = None,
	is_credit_sale: bool | int | str = False,
	due_date: str | None = None,
	loyalty_points: int | str | None = None,
	tax_id: str | None = None,
):
	try:
		return success(
			submit_invoice_service(
				invoice_doctype=invoice_doctype,
				invoice_name=invoice_name,
				payments=payments,
				is_credit_sale=is_credit_sale,
				due_date=due_date,
				loyalty_points=loyalty_points,
				tax_id=tax_id,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def create_and_submit_invoice(
	pos_profile: str | None = None,
	customer: str | None = None,
	items: list | str | None = None,
	payments: list | str | None = None,
	idempotency_key: str | None = None,
	is_credit_sale: bool | int | str = False,
	due_date: str | None = None,
	price_list: str | None = None,
	loyalty_points: int | str | None = None,
	tax_id: str | None = None,
):
	try:
		return success(
			create_and_submit_invoice_service(
				pos_profile=pos_profile,
				customer=customer,
				items=items,
				payments=payments,
				idempotency_key=idempotency_key,
				is_credit_sale=is_credit_sale,
				due_date=due_date,
				price_list=price_list,
				loyalty_points=loyalty_points,
				tax_id=tax_id,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def create_and_submit_sales_order(
	pos_profile: str | None = None,
	customer: str | None = None,
	items: list | str | None = None,
	idempotency_key: str | None = None,
	price_list: str | None = None,
	delivery_date: str | None = None,
	tax_id: str | None = None,
):
	try:
		return success(
			create_and_submit_sales_order_service(
				pos_profile=pos_profile,
				customer=customer,
				items=items,
				idempotency_key=idempotency_key,
				price_list=price_list,
				delivery_date=delivery_date,
				tax_id=tax_id,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def hold_invoice(invoice_doctype, invoice_name):
	try:
		return success(
			hold_invoice_service(
				invoice_doctype=invoice_doctype,
				invoice_name=invoice_name,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def create_invoice_from_cart(
	pos_profile: str | None = None,
	customer: str | None = None,
	items: list | str | None = None,
	price_list: str | None = None,
	loyalty_points: int | str | None = None,
):
	try:
		return success(
			create_invoice_from_cart_service(
				pos_profile=pos_profile,
				customer=customer,
				items=items,
				price_list=price_list,
				loyalty_points=loyalty_points,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def list_held_invoices(pos_profile=None, limit=20):
	try:
		return success(list_held_invoices_service(pos_profile=pos_profile, limit=limit))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def restore_invoice(invoice_doctype, invoice_name):
	try:
		return success(
			restore_invoice_service(
				invoice_doctype=invoice_doctype,
				invoice_name=invoice_name,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def clear_invoice(invoice_doctype, invoice_name):
	try:
		return success(
			clear_invoice_service(
				invoice_doctype=invoice_doctype,
				invoice_name=invoice_name,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def update_invoice_from_cart(
	invoice_doctype: str,
	invoice_name: str,
	customer: str | None = None,
	items: list | str | None = None,
	price_list: str | None = None,
	loyalty_points: int | str | None = None,
):
	try:
		return success(
			update_invoice_from_cart_service(
				invoice_doctype=invoice_doctype,
				invoice_name=invoice_name,
				customer=customer,
				items=items,
				price_list=price_list,
				loyalty_points=loyalty_points,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)
