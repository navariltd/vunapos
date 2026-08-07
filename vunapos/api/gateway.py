import frappe

from vunapos.services.gateway_payment_service import (
	attach_c2b_gateway_payment as attach_c2b_gateway_payment_service,
)
from vunapos.services.gateway_payment_service import (
	cancel_gateway_payment_link as cancel_gateway_payment_link_service,
)
from vunapos.services.gateway_payment_service import (
	get_gateway_payment_status as get_gateway_payment_status_service,
)
from vunapos.services.gateway_payment_service import (
	initiate_stk_gateway_payment as initiate_stk_gateway_payment_service,
)
from vunapos.services.gateway_payment_service import (
	search_c2b_gateway_payments as search_c2b_gateway_payments_service,
)
from vunapos.utils.response import failure, success


def _failure_from_exception(exc):
	return failure(
		str(exc),
		code=getattr(exc, "vuna_error_code", exc.__class__.__name__),
		meta=getattr(exc, "vuna_error_meta", None),
	)


@frappe.whitelist(methods=["POST"])
def initiate_stk_gateway_payment(
	pos_profile: str | None = None,
	mode_of_payment: str | None = None,
	amount: float | str | None = None,
	phone_number: str | None = None,
	customer: str | None = None,
	currency: str | None = None,
	idempotency_key: str | None = None,
	account_reference: str | None = None,
):
	try:
		return success(
			initiate_stk_gateway_payment_service(
				pos_profile=pos_profile,
				mode_of_payment=mode_of_payment,
				amount=amount,
				phone_number=phone_number,
				customer=customer,
				currency=currency,
				idempotency_key=idempotency_key,
				account_reference=account_reference,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def get_gateway_payment_status(gateway_payment_link: str | None = None):
	try:
		return success(get_gateway_payment_status_service(gateway_payment_link))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def cancel_gateway_payment_link(gateway_payment_link: str | None = None):
	try:
		return success(cancel_gateway_payment_link_service(gateway_payment_link))
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def attach_c2b_gateway_payment(
	pos_profile: str | None = None,
	mode_of_payment: str | None = None,
	transaction_reference: str | None = None,
	amount: float | str | None = None,
	customer: str | None = None,
	currency: str | None = None,
	idempotency_key: str | None = None,
):
	try:
		return success(
			attach_c2b_gateway_payment_service(
				pos_profile=pos_profile,
				mode_of_payment=mode_of_payment,
				transaction_reference=transaction_reference,
				amount=amount,
				customer=customer,
				currency=currency,
				idempotency_key=idempotency_key,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def search_c2b_gateway_payments(
	pos_profile: str | None = None,
	mode_of_payment: str | None = None,
	query: str | None = None,
	customer: str | None = None,
	currency: str | None = None,
	limit: int | str | None = 20,
):
	try:
		return success(
			search_c2b_gateway_payments_service(
				pos_profile=pos_profile,
				mode_of_payment=mode_of_payment,
				query=query,
				customer=customer,
				currency=currency,
				limit=limit,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)
