import frappe

from vunapos.services.payment_service import allocate_customer_payments as allocate_customer_payments_service
from vunapos.services.payment_service import (
	get_reconciliation_candidates as get_reconciliation_candidates_service,
)
from vunapos.services.payment_service import receive_customer_payment as receive_customer_payment_service
from vunapos.services.payment_service import reconcile_customer_payment as reconcile_customer_payment_service
from vunapos.utils.response import failure, success


@frappe.whitelist(methods=["POST"])
def receive_customer_payment(
	pos_profile=None,
	customer=None,
	amount=None,
	mode_of_payment=None,
	sales_invoice=None,
	allocated_amount=None,
	posting_date=None,
	reference_no=None,
	reference_date=None,
	remarks=None,
	idempotency_key=None,
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
