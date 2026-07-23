import frappe

from vunapos.services.payment_service import receive_customer_payment as receive_customer_payment_service
from vunapos.utils.response import failure, success


@frappe.whitelist(methods=["POST"])
def receive_customer_payment(**kwargs):
	try:
		return success(receive_customer_payment_service(**kwargs))
	except Exception as exc:
		return failure(str(exc), code=getattr(exc, "vuna_error_code", exc.__class__.__name__))
