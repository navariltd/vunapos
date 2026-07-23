import frappe

from vunapos.services.invoice_history_service import get_invoice_history as get_invoice_history_service
from vunapos.services.invoice_service import add_item as add_item_service
from vunapos.services.invoice_service import checkout_invoice as checkout_invoice_service
from vunapos.services.invoice_service import clear_invoice as clear_invoice_service
from vunapos.services.invoice_service import create_and_submit_invoice as create_and_submit_invoice_service
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
def create_invoice(pos_profile=None, customer=None):
	try:
		return success(create_draft_invoice(pos_profile=pos_profile, customer=customer))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def preview_invoice(pos_profile=None, customer=None, items=None, invoice_doctype=None):
	try:
		return success(
			preview_invoice_service(
				pos_profile=pos_profile,
				customer=customer,
				items=items,
				invoice_doctype=invoice_doctype,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def checkout_invoice(invoice_doctype, invoice_name, payments=None, idempotency_key=None):
	try:
		return success(
			checkout_invoice_service(
				invoice_doctype=invoice_doctype,
				invoice_name=invoice_name,
				payments=payments,
				idempotency_key=idempotency_key,
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
	pos_profile=None,
	invoice=None,
	customer=None,
	from_date=None,
	to_date=None,
	status=None,
	payment_mode=None,
	current_shift=1,
	start=0,
	page_length=50,
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
				current_shift=current_shift,
				start=start,
				page_length=page_length,
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
def submit_invoice(invoice_doctype, invoice_name, payments=None):
	try:
		return success(
			submit_invoice_service(
				invoice_doctype=invoice_doctype,
				invoice_name=invoice_name,
				payments=payments,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def create_and_submit_invoice(pos_profile=None, customer=None, items=None, payments=None):
	try:
		return success(
			create_and_submit_invoice_service(
				pos_profile=pos_profile,
				customer=customer,
				items=items,
				payments=payments,
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
def create_invoice_from_cart(pos_profile=None, customer=None, items=None):
	try:
		return success(
			create_invoice_from_cart_service(
				pos_profile=pos_profile,
				customer=customer,
				items=items,
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
def update_invoice_from_cart(invoice_doctype, invoice_name, customer=None, items=None):
	try:
		return success(
			update_invoice_from_cart_service(
				invoice_doctype=invoice_doctype,
				invoice_name=invoice_name,
				customer=customer,
				items=items,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)
