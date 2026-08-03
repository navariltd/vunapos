import frappe

from vunapos.services.payment_service import allocate_customer_payments as allocate_customer_payments_service
from vunapos.services.payment_service import get_payment_history as get_payment_history_service
from vunapos.services.payment_service import (
	get_reconciliation_candidates as get_reconciliation_candidates_service,
)
from vunapos.services.payment_service import receive_customer_payment as receive_customer_payment_service
from vunapos.services.payment_service import reconcile_customer_payment as reconcile_customer_payment_service
from vunapos.services.payment_service import render_payment_receipt as render_payment_receipt_service
from vunapos.utils.response import failure, success


@frappe.whitelist(methods=["POST"])
def receive_customer_payment(
	pos_profile: str | None = None,
	customer: str | None = None,
	amount: str | int | float | None = None,
	mode_of_payment: str | None = None,
	sales_invoice: str | None = None,
	allocated_amount: str | int | float | None = None,
	posting_date: str | None = None,
	reference_no: str | None = None,
	reference_date: str | None = None,
	remarks: str | None = None,
	idempotency_key: str | None = None,
	gateway_payment_link: str | None = None,
):
	try:
		return success(
			receive_customer_payment_service(
				pos_profile=pos_profile,
				customer=customer,
				amount=amount,
				mode_of_payment=mode_of_payment,
				sales_invoice=sales_invoice,
				allocated_amount=allocated_amount,
				posting_date=posting_date,
				reference_no=reference_no,
				reference_date=reference_date,
				remarks=remarks,
				idempotency_key=idempotency_key,
				gateway_payment_link=gateway_payment_link,
			)
		)
	except Exception as exc:
		return failure(str(exc), code=getattr(exc, "vuna_error_code", exc.__class__.__name__))


@frappe.whitelist()
def get_reconciliation_candidates(pos_profile=None, customer=None, limit=100):
	try:
		return success(
			get_reconciliation_candidates_service(pos_profile=pos_profile, customer=customer, limit=limit)
		)
	except Exception as exc:
		return failure(str(exc), code=getattr(exc, "vuna_error_code", exc.__class__.__name__))


@frappe.whitelist()
def get_payment_history(
	pos_profile=None,
	customer=None,
	from_date=None,
	to_date=None,
	mode_of_payment=None,
	reference=None,
	status=None,
	cashier=None,
	limit=100,
):
	try:
		return success(
			get_payment_history_service(
				pos_profile,
				customer,
				from_date,
				to_date,
				mode_of_payment,
				reference,
				status,
				cashier,
				limit,
			)
		)
	except Exception as exc:
		return failure(str(exc), code=getattr(exc, "vuna_error_code", exc.__class__.__name__))


@frappe.whitelist()
def render_payment_receipt(payment_entry=None):
	try:
		return success(render_payment_receipt_service(payment_entry))
	except Exception as exc:
		return failure(str(exc), code=getattr(exc, "vuna_error_code", exc.__class__.__name__))


@frappe.whitelist(methods=["POST"])
def allocate_customer_payments(pos_profile=None, customer=None, payment_entries=None, invoices=None):
	try:
		return success(
			allocate_customer_payments_service(
				pos_profile=pos_profile,
				customer=customer,
				payment_entries=frappe.parse_json(payment_entries)
				if isinstance(payment_entries, str)
				else payment_entries,
				invoices=frappe.parse_json(invoices) if isinstance(invoices, str) else invoices,
			)
		)
	except Exception as exc:
		return failure(str(exc), code=getattr(exc, "vuna_error_code", exc.__class__.__name__))


@frappe.whitelist(methods=["POST"])
def reconcile_customer_payment(pos_profile=None, customer=None, payment_entries=None, invoices=None):
	try:
		return success(
			reconcile_customer_payment_service(
				pos_profile=pos_profile,
				customer=customer,
				payment_entries=frappe.parse_json(payment_entries)
				if isinstance(payment_entries, str)
				else payment_entries,
				invoices=frappe.parse_json(invoices) if isinstance(invoices, str) else invoices,
			)
		)
	except Exception as exc:
		return failure(str(exc), code=getattr(exc, "vuna_error_code", exc.__class__.__name__))
