import math

import frappe
from erpnext.controllers.sales_and_purchase_return import make_return_doc
from frappe import _
from frappe.utils import flt, now_datetime, nowdate

from vunapos.dto.invoice import invoice_to_dict
from vunapos.services.profile_service import get_invoice_mode, require_open_pos_session, resolve_pos_profile
from vunapos.utils.permissions import require_create, require_read


def _fail(code, message, meta=None):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	exc.vuna_error_meta = meta or {}
	raise exc


def _source_row_field(doctype):
	return "sales_invoice_item" if doctype == "Sales Invoice" else "pos_invoice_item"


def _validate_original(profile, doctype, invoice_name, *, lock=False):
	require_read(doctype, invoice_name)
	doc = frappe.get_doc(doctype, invoice_name, for_update=lock)
	if not doc.get("vunapos_invoice") or doc.company != profile.company or doc.pos_profile != profile.name:
		frappe.throw(_("Invoice is not available for this POS Profile"), frappe.PermissionError)
	if doc.docstatus != 1:
		_fail("RETURN_INVOICE_NOT_SUBMITTED", _("Only submitted invoices can be returned"))
	if doc.get("is_return"):
		_fail("RETURN_AGAINST_CREDIT_NOTE", _("A credit note cannot be returned from VunaPOS"))
	return doc


def _mapped_return(doctype, invoice_name):
	doc = make_return_doc(doctype, invoice_name)
	fieldname = _source_row_field(doctype)
	return doc, {row.get(fieldname): row for row in doc.items if row.get(fieldname)}


def _find_existing_return(doctype, profile, invoice_name, idempotency_key):
	return frappe.db.get_value(
		doctype,
		{
			"vunapos_idempotency_key": idempotency_key,
			"vunapos_invoice": 1,
			"pos_profile": profile.name,
			"company": profile.company,
			"is_return": 1,
			"return_against": invoice_name,
		},
		"name",
	)


def _apply_erpnext_desk_return_payments(return_doc, original):
	"""Mirror ERPNext's Desk return payment recalculation.

	Desk assigns a partial return's complete negative total to the original mode when
	the sale used one mode. For multiple modes it uses the POS Profile default unless
	the mapped payment rows already equal the return total.
	"""
	if not return_doc.get("is_pos") or not return_doc.get("payments"):
		return
	total = flt(return_doc.rounded_total or return_doc.grand_total)
	if abs(sum(flt(row.amount) for row in return_doc.payments) - total) <= 1e-9:
		return
	original_modes = {row.mode_of_payment for row in original.get("payments") if row.mode_of_payment}
	selected_mode = next(iter(original_modes)) if len(original_modes) == 1 else None
	if not selected_mode:
		selected_mode = next((row.mode_of_payment for row in return_doc.payments if row.get("default")), None)
	if not selected_mode:
		selected_mode = frappe.db.get_value(
			"POS Payment Method", {"parent": return_doc.pos_profile, "default": 1}, "mode_of_payment"
		)
	if not selected_mode:
		return
	for payment in return_doc.payments:
		payment.amount = total if payment.mode_of_payment == selected_mode else 0
		payment.base_amount = payment.amount * flt(return_doc.conversion_rate or 1)
	return_doc.paid_amount = sum(flt(row.amount) for row in return_doc.payments)
	return_doc.base_paid_amount = sum(flt(row.base_amount) for row in return_doc.payments)


def get_return_preview(pos_profile=None, invoice_name=None):
	profile = resolve_pos_profile(pos_profile)
	doctype = get_invoice_mode()
	original = _validate_original(profile, doctype, invoice_name)
	_return_doc, available = _mapped_return(doctype, original.name)
	items = []
	for row in original.items:
		mapped = available.get(row.name)
		returnable = abs(flt(mapped.qty)) if mapped else 0
		items.append(
			{
				"row_name": row.name,
				"item_code": row.item_code,
				"item_name": row.item_name,
				"uom": row.uom,
				"sold_qty": abs(flt(row.qty)),
				"returnable_qty": returnable,
				"returned_qty": max(abs(flt(row.qty)) - returnable, 0),
				"rate": flt(row.rate),
				"return_amount": abs(flt(mapped.amount)) if mapped else 0,
			}
		)
	return {"invoice": original.name, "currency": original.currency, "items": items}


def create_invoice_return(
	pos_profile=None,
	invoice_name=None,
	items=None,
	reason=None,
	idempotency_key=None,
):
	profile = resolve_pos_profile(pos_profile)
	doctype = get_invoice_mode()
	opening = require_open_pos_session(profile.name)
	require_create(doctype)
	if not frappe.has_permission(doctype, "submit"):
		frappe.throw(_("Not permitted to submit {0}").format(doctype), frappe.PermissionError)

	idempotency_key = (idempotency_key or "").strip()
	if not idempotency_key:
		_fail("RETURN_IDEMPOTENCY_KEY_REQUIRED", _("A return idempotency key is required"))
	existing = _find_existing_return(doctype, profile, invoice_name, idempotency_key)
	if existing:
		return {"invoice": invoice_to_dict(frappe.get_doc(doctype, existing)), "duplicate": True}

	reason = (reason or "").strip()
	if not reason:
		_fail("RETURN_REASON_REQUIRED", _("Enter a reason for this return"))
	rows = frappe.parse_json(items) if isinstance(items, str) else items
	if not isinstance(rows, list) or not rows:
		_fail("NO_RETURN_ITEMS", _("Select at least one item to return"))

	requested = {}
	for row in rows:
		row_name = str((row or {}).get("row_name") or "").strip()
		qty = (row or {}).get("qty")
		if not row_name or isinstance(qty, bool):
			_fail("INVALID_RETURN_QUANTITY", _("Every returned item needs a valid quantity"))
		try:
			qty = float(qty)
		except (TypeError, ValueError):
			_fail("INVALID_RETURN_QUANTITY", _("Every returned item needs a valid quantity"))
		if not math.isfinite(qty) or qty <= 0:
			_fail("INVALID_RETURN_QUANTITY", _("Return quantities must be greater than zero"))
		if row_name in requested:
			_fail("DUPLICATE_RETURN_ITEM", _("The same invoice row cannot be returned twice"))
		requested[row_name] = qty

	original = _validate_original(profile, doctype, invoice_name, lock=True)
	existing = _find_existing_return(doctype, profile, invoice_name, idempotency_key)
	if existing:
		return {"invoice": invoice_to_dict(frappe.get_doc(doctype, existing)), "duplicate": True}
	return_doc, available = _mapped_return(doctype, original.name)
	unknown = set(requested) - set(available)
	if unknown:
		_fail("RETURN_ITEM_UNAVAILABLE", _("One or more selected items are no longer returnable"))
	for source_row, qty in requested.items():
		remaining = abs(flt(available[source_row].qty))
		if qty > remaining + 1e-9:
			_fail(
				"RETURN_QUANTITY_EXCEEDED",
				_("Return quantity exceeds the quantity currently available"),
				{"row_name": source_row, "requested_qty": qty, "returnable_qty": remaining},
			)

	fieldname = _source_row_field(doctype)
	return_doc.set("items", [row for row in return_doc.items if row.get(fieldname) in requested])
	for row in return_doc.items:
		row.qty = -requested[row.get(fieldname)]
	return_doc.posting_date = nowdate()
	return_doc.posting_time = now_datetime().time()
	return_doc.set_posting_time = 1
	return_doc.vunapos_invoice = 1
	return_doc.vunapos_held = 0
	return_doc.vunapos_idempotency_key = idempotency_key
	return_doc.vunapos_opening_entry = opening.name
	return_doc.vunapos_session_cashier = frappe.session.user
	return_doc.vunapos_session_verified_at = now_datetime()
	return_doc.vunapos_closing_entry = None
	return_doc.remarks = _("VunaPOS return: {0}").format(reason)
	return_doc.run_method("calculate_taxes_and_totals")
	_apply_erpnext_desk_return_payments(return_doc, original)
	return_doc.insert()
	return_doc.add_comment("Comment", _("VunaPOS return reason: {0}").format(reason))
	return_doc.submit()
	return {"invoice": invoice_to_dict(return_doc), "duplicate": False}
