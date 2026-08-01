from decimal import Decimal, InvalidOperation

import frappe
from erpnext.accounts.utils import get_currency_precision
from frappe import _
from frappe.utils import cint, flt, now_datetime

from vunapos.services.profile_service import require_open_pos_session, resolve_pos_profile

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


def _require_navari_ke_payments(doctype: str):
	if not frappe.db.exists("DocType", doctype):
		_gateway_error(
			"GATEWAY_APP_MISSING",
			_("navari_ke_payments is required for {0} gateway payments").format(doctype),
		)


def _payment_gateway_name(payment_gateway_account: str | None) -> str | None:
	if not payment_gateway_account:
		return None
	return frappe.db.get_value("Payment Gateway Account", payment_gateway_account, "payment_gateway")


def _profile_gateway_account(profile, mode_of_payment: str) -> str:
	payment_gateway = payment_mode_gateway(profile, mode_of_payment)
	if not payment_gateway:
		_gateway_error(
			"GATEWAY_PAYMENT_MODE_NOT_CONFIGURED",
			_("Payment mode {0} is not configured for gateway payments").format(mode_of_payment),
		)
	return payment_gateway


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


def _status_from_source(source_doc) -> str:
	status = source_doc.get("status")
	if status in _source_success_statuses(source_doc.doctype):
		return "Paid"
	if status in {"Failed"}:
		return "Failed"
	if status in {"Cancelled"}:
		return "Cancelled"
	if status in {"Expired"}:
		return "Expired"
	return "Pending"


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

	source_gateway_account = source_doc.get("payment_gateway_account")
	if source_gateway_account and source_gateway_account != link.payment_gateway:
		_gateway_error(
			"GATEWAY_PAYMENT_SESSION_MISMATCH",
			_("Gateway payment source does not match the payment gateway account"),
		)
	source_gateway = source_doc.get("payment_gateway")
	if source_gateway:
		link_gateway = _payment_gateway_name(link.payment_gateway)
		if link_gateway and source_gateway != link_gateway:
			_gateway_error(
				"GATEWAY_PAYMENT_SESSION_MISMATCH",
				_("Gateway payment source does not match the payment mode gateway"),
			)


def gateway_payment_link_to_dict(link):
	source_doc = None
	if (
		link.get("source_doctype")
		and link.get("source_name")
		and frappe.db.exists(link.source_doctype, link.source_name)
	):
		source_doc = frappe.get_doc(link.source_doctype, link.source_name)
	return {
		"name": link.name,
		"source_doctype": link.source_doctype,
		"source_name": link.source_name,
		"payment_gateway": link.payment_gateway,
		"mode_of_payment": link.mode_of_payment,
		"status": link.status,
		"transaction_reference": link.transaction_reference,
		"pos_profile": link.pos_profile,
		"opening_entry": link.opening_entry,
		"cashier": link.cashier,
		"customer": link.customer,
		"amount": flt(link.amount),
		"currency": link.currency,
		"consumed": cint(link.consumed),
		"source_status": source_doc.get("status") if source_doc else None,
		"source_reference": _get_source_transaction_reference(source_doc) if source_doc else None,
	}


def _sync_link_from_source(link):
	if not frappe.db.exists(link.source_doctype, link.source_name):
		_gateway_error("GATEWAY_PAYMENT_NOT_FOUND", _("Gateway payment source was not found"))
	source_doc = frappe.get_doc(link.source_doctype, link.source_name)
	status = _status_from_source(source_doc)
	values = {"status": status}
	transaction_reference = _get_source_transaction_reference(source_doc)
	if transaction_reference:
		values["transaction_reference"] = transaction_reference
	if flt(source_doc.get("amount")):
		values["amount"] = flt(source_doc.get("amount"))
	if source_doc.get("currency"):
		values["currency"] = source_doc.get("currency")
	link.db_set(values, update_modified=True)
	link.reload()
	return link


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
	link = _sync_link_from_source(link)

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


def get_gateway_payment_status(link_name: str | None):
	if not link_name:
		_gateway_error("GATEWAY_PAYMENT_REQUIRED", _("Gateway payment link is required"))
	if not frappe.db.exists("VunaPOS Gateway Payment Link", link_name):
		_gateway_error(
			"GATEWAY_PAYMENT_NOT_FOUND", _("Gateway payment link {0} was not found").format(link_name)
		)
	link = frappe.get_doc("VunaPOS Gateway Payment Link", link_name)
	if not frappe.has_permission(link.doctype, "read", doc=link):
		frappe.throw(_("Not permitted to read VunaPOS Gateway Payment Link"), frappe.PermissionError)
	link = _sync_link_from_source(link)
	return gateway_payment_link_to_dict(link)


def _find_existing_link(profile, opening_entry, mode_of_payment, idempotency_key=None, source=None):
	filters = {
		"pos_profile": profile.name,
		"opening_entry": opening_entry.name,
		"cashier": opening_entry.user,
		"mode_of_payment": mode_of_payment,
		"consumed": 0,
	}
	if idempotency_key:
		filters["idempotency_key"] = idempotency_key
	if source:
		filters.update({"source_doctype": source.doctype, "source_name": source.name})
	if len(filters) == 5:
		return None
	link_name = frappe.db.get_value("VunaPOS Gateway Payment Link", filters, "name")
	return frappe.get_doc("VunaPOS Gateway Payment Link", link_name) if link_name else None


def _create_gateway_link(
	*,
	source_doc,
	profile,
	opening_entry,
	mode_of_payment,
	payment_gateway,
	customer=None,
	amount=None,
	currency=None,
	status=None,
	idempotency_key=None,
):
	existing = _find_existing_link(
		profile, opening_entry, mode_of_payment, idempotency_key=idempotency_key, source=source_doc
	)
	if existing:
		return _sync_link_from_source(existing)
	link = frappe.get_doc(
		{
			"doctype": "VunaPOS Gateway Payment Link",
			"source_doctype": source_doc.doctype,
			"source_name": source_doc.name,
			"payment_gateway": payment_gateway,
			"mode_of_payment": mode_of_payment,
			"status": status or _status_from_source(source_doc),
			"pos_profile": profile.name,
			"opening_entry": opening_entry.name,
			"cashier": opening_entry.user,
			"customer": customer,
			"amount": amount if amount is not None else source_doc.get("amount"),
			"currency": currency or source_doc.get("currency") or profile.currency,
			"idempotency_key": idempotency_key,
		}
	)
	link.insert(ignore_permissions=True)
	return _sync_link_from_source(link)


def initiate_stk_gateway_payment(
	pos_profile=None,
	mode_of_payment=None,
	amount=None,
	phone_number=None,
	customer=None,
	currency=None,
	idempotency_key=None,
):
	_require_navari_ke_payments("KE Payment Request")
	profile = resolve_pos_profile(pos_profile)
	opening_entry = require_open_pos_session(profile.name)
	payment_gateway_account = _profile_gateway_account(profile, mode_of_payment)
	payment_gateway = _payment_gateway_name(payment_gateway_account)
	if not payment_gateway:
		_gateway_error(
			"GATEWAY_PAYMENT_MODE_INVALID", _("Payment gateway account is not linked to a gateway")
		)
	precision = get_currency_precision() or 2
	amount = _normalize_amount(amount, precision)
	currency = currency or profile.currency

	existing = _find_existing_link(profile, opening_entry, mode_of_payment, idempotency_key=idempotency_key)
	if existing:
		return gateway_payment_link_to_dict(_sync_link_from_source(existing))

	request = frappe.get_doc(
		{
			"doctype": "KE Payment Request",
			"phone_number": phone_number,
			"amount": amount,
			"currency": currency,
			"payment_gateway": payment_gateway,
			"company": profile.company,
			"provider": "Mpesa",
			"party_type": "Customer" if customer else None,
			"party": customer,
			"party_name": frappe.db.get_value("Customer", customer, "customer_name") if customer else None,
			"payment_gateway_account": payment_gateway_account,
			"mode_of_payment": mode_of_payment,
			"account_reference": idempotency_key,
			"transaction_description": _("VunaPOS checkout payment"),
		}
	)
	request.insert(ignore_permissions=True)
	link = _create_gateway_link(
		source_doc=request,
		profile=profile,
		opening_entry=opening_entry,
		mode_of_payment=mode_of_payment,
		payment_gateway=payment_gateway_account,
		customer=customer,
		amount=amount,
		currency=currency,
		status="Pending",
		idempotency_key=idempotency_key,
	)
	request.submit()
	request.reload()
	return gateway_payment_link_to_dict(_sync_link_from_source(link))


def attach_c2b_gateway_payment(
	pos_profile=None,
	mode_of_payment=None,
	transaction_reference=None,
	amount=None,
	customer=None,
	currency=None,
	idempotency_key=None,
):
	_require_navari_ke_payments("KE C2B Payment Register")
	profile = resolve_pos_profile(pos_profile)
	opening_entry = require_open_pos_session(profile.name)
	payment_gateway_account = _profile_gateway_account(profile, mode_of_payment)
	payment_gateway = _payment_gateway_name(payment_gateway_account)
	precision = get_currency_precision() or 2
	amount = _normalize_amount(amount, precision)
	currency = currency or profile.currency
	transaction_reference = (transaction_reference or "").strip()
	if not transaction_reference:
		_gateway_error("GATEWAY_PAYMENT_REFERENCE_REQUIRED", _("Transaction reference is required"))

	source_name = frappe.db.get_value(
		"KE C2B Payment Register",
		{"transaction_id": transaction_reference},
		"name",
	)
	if not source_name:
		_gateway_error(
			"GATEWAY_PAYMENT_NOT_FOUND",
			_("C2B payment {0} was not found").format(transaction_reference),
		)
	source_doc = frappe.get_doc("KE C2B Payment Register", source_name)
	if (
		source_doc.get("payment_gateway")
		and payment_gateway
		and source_doc.payment_gateway != payment_gateway
	):
		_gateway_error("GATEWAY_PAYMENT_SESSION_MISMATCH", _("C2B payment belongs to another gateway"))
	if flt(source_doc.get("amount"), precision) != amount:
		_gateway_error(
			"GATEWAY_PAYMENT_AMOUNT_MISMATCH", _("C2B payment amount does not match checkout amount")
		)
	if source_doc.get("currency") and source_doc.currency != currency:
		_gateway_error(
			"GATEWAY_PAYMENT_AMOUNT_MISMATCH", _("C2B payment currency does not match checkout currency")
		)
	if source_doc.get("customer") and customer and source_doc.customer != customer:
		_gateway_error("GATEWAY_PAYMENT_SESSION_MISMATCH", _("C2B payment belongs to another customer"))
	if source_doc.get("status") not in _source_success_statuses(source_doc.doctype):
		_gateway_error(
			"GATEWAY_PAYMENT_NOT_READY",
			_("C2B payment {0} is not ready for checkout").format(source_doc.name),
			{"status": source_doc.get("status")},
		)
	consumed = frappe.db.exists(
		"VunaPOS Gateway Payment Link",
		{"source_doctype": source_doc.doctype, "source_name": source_doc.name, "consumed": 1},
	)
	if consumed:
		_gateway_error("GATEWAY_PAYMENT_ALREADY_CONSUMED", _("C2B payment has already been used"))
	link = _create_gateway_link(
		source_doc=source_doc,
		profile=profile,
		opening_entry=opening_entry,
		mode_of_payment=mode_of_payment,
		payment_gateway=payment_gateway_account,
		customer=customer or source_doc.get("customer"),
		amount=amount,
		currency=currency,
		status="Paid",
		idempotency_key=idempotency_key,
	)
	return gateway_payment_link_to_dict(link)
