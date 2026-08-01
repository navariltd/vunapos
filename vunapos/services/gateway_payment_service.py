from decimal import Decimal, InvalidOperation

import frappe
from frappe import _
from frappe.utils import flt, now_datetime

SUCCESSFUL_LINK_STATUSES = {"Authorized", "Paid"}
SUPPORTED_SOURCE_DOCTYPES = {"KE Payment Request", "KE C2B Payment Register"}


def _gateway_error(code, message, meta=None):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	exc.vuna_error_meta = meta or {}
	raise exc


def gateway_modes_for_profile(profile) -> dict[str, str]:
	return {
		row.mode_of_payment: row.get("payment_gateway")
		for row in profile.get("payments", [])
		if row.get("mode_of_payment") and row.get("payment_gateway")
	}


def payment_mode_gateway(profile, mode_of_payment: str | None) -> str | None:
	if not mode_of_payment:
		return None
	return gateway_modes_for_profile(profile).get(mode_of_payment)


def _source_success_statuses(source_doctype: str) -> set[str]:
	if source_doctype == "KE Payment Request":
		return {"Completed"}
	if source_doctype == "KE C2B Payment Register":
		return {"Received", "Validated", "Confirmed"}
	return set()


def _normalize_amount(value, precision: int) -> float:
	try:
		amount = Decimal(str(value))
	except (InvalidOperation, TypeError, ValueError):
		_gateway_error("GATEWAY_PAYMENT_AMOUNT_MISMATCH", _("Gateway payment amount is invalid"))
	if not amount.is_finite() or amount <= 0:
		_gateway_error(
			"GATEWAY_PAYMENT_AMOUNT_MISMATCH", _("Gateway payment amount must be greater than zero")
		)
	return flt(float(amount), precision)


def _get_source_transaction_reference(source_doc) -> str | None:
	return (
		source_doc.get("transaction_id")
		or source_doc.get("checkout_request_id")
		or source_doc.get("external_request_id")
		or source_doc.get("merchant_request_id")
	)


def _validate_source(link, source_doc, precision: int):
	if link.source_doctype not in SUPPORTED_SOURCE_DOCTYPES:
		_gateway_error(
			"GATEWAY_PAYMENT_SOURCE_INVALID",
			_("Gateway source {0} is not supported").format(link.source_doctype),
		)

	success_statuses = _source_success_statuses(link.source_doctype)
	if source_doc.get("status") not in success_statuses:
		_gateway_error(
			"GATEWAY_PAYMENT_NOT_READY",
			_("Gateway payment {0} is not ready for checkout").format(link.name),
			{"status": source_doc.get("status")},
		)

	if flt(source_doc.get("amount"), precision) != flt(link.amount, precision):
		_gateway_error("GATEWAY_PAYMENT_AMOUNT_MISMATCH", _("Gateway payment amount changed"))

	if source_doc.get("currency") and source_doc.get("currency") != link.currency:
		_gateway_error("GATEWAY_PAYMENT_AMOUNT_MISMATCH", _("Gateway payment currency changed"))

	if source_doc.get("payment_gateway") and source_doc.get("payment_gateway") != link.payment_gateway:
		_gateway_error(
			"GATEWAY_PAYMENT_SESSION_MISMATCH",
			_("Gateway payment source does not match the payment mode gateway"),
		)


def validate_gateway_payment_link(
	link_name: str | None,
	*,
	profile,
	opening_entry,
	mode_of_payment: str,
	payment_gateway: str,
	customer: str | None,
	amount=None,
	currency: str | None = None,
	precision: int = 2,
):
	if not link_name:
		_gateway_error(
			"GATEWAY_PAYMENT_REQUIRED",
			_("Payment mode {0} requires a verified gateway payment").format(mode_of_payment),
		)
	if not frappe.db.exists("VunaPOS Gateway Payment Link", link_name):
		_gateway_error(
			"GATEWAY_PAYMENT_NOT_FOUND", _("Gateway payment link {0} was not found").format(link_name)
		)

	link = frappe.get_doc("VunaPOS Gateway Payment Link", link_name)
	if not frappe.has_permission(link.doctype, "read", doc=link):
		frappe.throw(_("Not permitted to read VunaPOS Gateway Payment Link"), frappe.PermissionError)

	if link.consumed:
		_gateway_error(
			"GATEWAY_PAYMENT_ALREADY_CONSUMED",
			_("Gateway payment {0} has already been consumed").format(link.name),
		)
	if link.status not in SUCCESSFUL_LINK_STATUSES:
		_gateway_error(
			"GATEWAY_PAYMENT_NOT_READY",
			_("Gateway payment {0} is not ready for checkout").format(link.name),
			{"status": link.status},
		)
	if (
		link.pos_profile != profile.name
		or link.opening_entry != opening_entry.name
		or link.cashier != opening_entry.user
	):
		_gateway_error(
			"GATEWAY_PAYMENT_SESSION_MISMATCH", _("Gateway payment belongs to another POS session")
		)
	if link.mode_of_payment != mode_of_payment or link.payment_gateway != payment_gateway:
		_gateway_error(
			"GATEWAY_PAYMENT_SESSION_MISMATCH", _("Gateway payment does not match the selected payment mode")
		)
	if customer and link.customer and link.customer != customer:
		_gateway_error("GATEWAY_PAYMENT_SESSION_MISMATCH", _("Gateway payment belongs to another customer"))
	if currency and link.currency != currency:
		_gateway_error(
			"GATEWAY_PAYMENT_AMOUNT_MISMATCH", _("Gateway payment currency does not match checkout currency")
		)

	link_amount = _normalize_amount(link.amount, precision)
	if amount is not None and flt(amount, precision) != link_amount:
		_gateway_error(
			"GATEWAY_PAYMENT_AMOUNT_MISMATCH", _("Gateway payment amount does not match checkout amount")
		)

	if not frappe.db.exists(link.source_doctype, link.source_name):
		_gateway_error("GATEWAY_PAYMENT_NOT_FOUND", _("Gateway payment source was not found"))
	source_doc = frappe.get_doc(link.source_doctype, link.source_name)
	_validate_source(link, source_doc, precision)

	transaction_reference = _get_source_transaction_reference(source_doc)
	if transaction_reference and link.transaction_reference != transaction_reference:
		link.db_set("transaction_reference", transaction_reference, update_modified=False)
		link.transaction_reference = transaction_reference

	return link


def consume_gateway_payment_links(links, target_doc):
	for link in links or []:
		link = frappe.get_doc("VunaPOS Gateway Payment Link", link.name)
		if link.consumed:
			_gateway_error(
				"GATEWAY_PAYMENT_ALREADY_CONSUMED",
				_("Gateway payment {0} has already been consumed").format(link.name),
			)
		link.db_set(
			{
				"consumed": 1,
				"consumed_by_doctype": target_doc.doctype,
				"consumed_by_name": target_doc.name,
				"consumed_on": now_datetime(),
				"consumed_by": frappe.session.user,
			},
			update_modified=True,
		)
