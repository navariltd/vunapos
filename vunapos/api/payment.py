import frappe

from vunapos.services.payment_service import receive_customer_payment as receive_customer_payment_service
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
