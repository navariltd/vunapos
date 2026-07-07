import json

import frappe
from erpnext.stock.get_item_details import get_item_details, get_item_tax_map
from frappe import _
from frappe.utils import flt, get_datetime, nowdate

from vunapos.dto.invoice import invoice_to_dict
from vunapos.services.batch_service import allocate_batches as allocate_item_batches
from vunapos.services.batch_service import (
	get_item_batches,
	get_item_tracking_flags,
	validate_batch_allocation,
)
from vunapos.services.item_service import get_priority_price_list
from vunapos.services.profile_service import get_invoice_mode, resolve_pos_profile
from vunapos.utils.permissions import require_create, require_read, require_write

SUPPORTED_INVOICE_DOCTYPES = ("Sales Invoice", "POS Invoice")
HELD_FIELD = "vunapos_held"
VUNAPOS_FIELD = "vunapos_invoice"
IDEMPOTENCY_FIELD = "vunapos_idempotency_key"


def _throw(code, message, meta=None):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	exc.vuna_error_meta = meta or {}
	raise exc


def _validate_invoice_doctype(invoice_doctype):
	if invoice_doctype not in SUPPORTED_INVOICE_DOCTYPES:
		frappe.throw(_("Unsupported invoice doctype: {0}").format(invoice_doctype))


def _has_field(doctype, fieldname):
	return frappe.get_meta(doctype).has_field(fieldname)


def _set_if_has_field(doc, fieldname, value):
	if _has_field(doc.doctype, fieldname):
		doc.set(fieldname, value)


def _reset_invoice_totals(doc):
	for fieldname in (
		"net_total",
		"base_net_total",
		"total",
		"base_total",
		"grand_total",
		"base_grand_total",
		"rounded_total",
		"base_rounded_total",
		"total_taxes_and_charges",
		"base_total_taxes_and_charges",
		"outstanding_amount",
		"paid_amount",
		"change_amount",
	):
		_set_if_has_field(doc, fieldname, 0)
	return doc


def _recalculate(doc):
	_ensure_controller_item_attrs(doc)
	if hasattr(doc, "set_missing_values"):
		doc.set_missing_values()
	if hasattr(doc, "append_taxes_from_item_tax_template"):
		doc.append_taxes_from_item_tax_template()
	if hasattr(doc, "calculate_taxes_and_totals"):
		doc.calculate_taxes_and_totals()
	if hasattr(doc, "set_total_in_words"):
		doc.set_total_in_words()
	return doc


def _ensure_controller_item_attrs(doc):
	for item in doc.get("items", []):
		if not hasattr(item, "against_pick_list"):
			item.against_pick_list = None
		if not hasattr(item, "pick_list_item"):
			item.pick_list_item = None


def _sync_profile_pricing_fields(doc, profile):
	price_list = get_priority_price_list(customer=doc.get("customer"), pos_profile=profile)
	_set_if_has_field(doc, "selling_price_list", price_list)
	_set_if_has_field(doc, "currency", profile.currency)
	_set_if_has_field(doc, "taxes_and_charges", profile.get("taxes_and_charges"))
	return doc


def _sync_invoice_item_pricing(doc, profile):
	for row in doc.get("items", []):
		details = _get_item_row(
			row.item_code,
			row.qty,
			doc,
			profile,
			item_tax_template=row.get("item_tax_template"),
		)
		for fieldname in (
			"uom",
			"stock_uom",
			"conversion_factor",
			"rate",
			"price_list_rate",
			"item_tax_template",
			"item_tax_rate",
		):
			if details.get(fieldname) is not None and row.meta.has_field(fieldname):
				row.set(fieldname, details.get(fieldname))
	return doc


def _save_invoice(doc):
	if doc.get("items"):
		if doc.get("pos_profile"):
			profile = resolve_pos_profile(doc.get("pos_profile"))
			_sync_profile_pricing_fields(doc, profile)
			_sync_invoice_item_pricing(doc, profile)
		_recalculate(doc)
	doc.flags.ignore_mandatory = not bool(doc.get("items"))
	doc.save()
	if doc.get("items"):
		_materialize_batch_bundles(doc)
	return doc


def _load_draft_invoice(invoice_doctype, invoice_name):
	_validate_invoice_doctype(invoice_doctype)
	require_read(invoice_doctype, invoice_name)
	doc = frappe.get_doc(invoice_doctype, invoice_name)
	if doc.docstatus != 0:
		_throw("INVOICE_ALREADY_SUBMITTED", _("Invoice {0} is not a draft").format(invoice_name))
	require_write(invoice_doctype, invoice_name)
	return doc


def _load_checkout_invoice(invoice_doctype, invoice_name):
	_validate_invoice_doctype(invoice_doctype)
	require_read(invoice_doctype, invoice_name)
	doc = frappe.get_doc(invoice_doctype, invoice_name)
	if doc.docstatus == 0:
		require_write(invoice_doctype, invoice_name)
	return doc


def _find_submitted_invoice_by_idempotency_key(idempotency_key):
	if not idempotency_key:
		return None

	for doctype in SUPPORTED_INVOICE_DOCTYPES:
		if not frappe.db.table_exists(doctype) or not _has_field(doctype, IDEMPOTENCY_FIELD):
			continue
		filters = {
			"docstatus": 1,
			IDEMPOTENCY_FIELD: idempotency_key,
		}
		if _has_field(doctype, VUNAPOS_FIELD):
			filters[VUNAPOS_FIELD] = 1
		name = frappe.db.get_value(doctype, filters, "name")
		if name:
			require_read(doctype, name)
			return frappe.get_doc(doctype, name)
	return None


def _payment_rows(payments):
	if isinstance(payments, str):
		payments = json.loads(payments or "[]")
	return payments or []


def _invoice_total_for_payment(doc):
	return flt(doc.get("rounded_total") or doc.get("grand_total") or 0)


def _currency_precision(doc):
	for fieldname in ("rounded_total", "grand_total"):
		try:
			precision = doc.precision(fieldname)
			if precision is not None:
				return precision
		except Exception:
			pass
	return 2


def _valid_payment_modes(profile):
	return {row.mode_of_payment for row in profile.get("payments", []) if row.get("mode_of_payment")}


def validate_payment_rows(doc, payments=None, profile=None):
	rows = _payment_rows(payments)
	if not rows:
		_throw("NO_PAYMENT_ROWS", _("At least one payment row is required"))

	valid_modes = _valid_payment_modes(profile) if profile else set()
	total_paid = 0
	for row in rows:
		mode_of_payment = row.get("mode_of_payment")
		amount = flt(row.get("amount"))
		if not mode_of_payment:
			_throw("INVALID_PAYMENT_MODE", _("Payment mode is required"))
		if valid_modes and mode_of_payment not in valid_modes:
			_throw(
				"INVALID_PAYMENT_MODE",
				_("Payment mode {0} is not allowed for this POS Profile").format(mode_of_payment),
			)
		if amount <= 0:
			_throw("INVALID_PAYMENT_AMOUNT", _("Payment amount must be greater than zero"))
		total_paid += amount

	precision = _currency_precision(doc)
	expected_total = flt(_invoice_total_for_payment(doc), precision)
	paid_total = flt(total_paid, precision)
	if paid_total != expected_total:
		_throw("PAYMENT_TOTAL_MISMATCH", _("Payment total must match the invoice total"))

	return rows


def _cart_item_rows(items):
	if isinstance(items, str):
		items = json.loads(items or "[]")
	return items or []


def _get_cart_item_qtys(items):
	item_qtys = {}
	for item in _cart_item_rows(items):
		item_code = item.get("item_code")
		qty = flt(item.get("qty") or 0)
		if not item_code:
			frappe.throw(_("Item code is required"))
		if qty <= 0:
			frappe.throw(_("Quantity for item {0} must be greater than zero").format(item_code))
		item_qtys[item_code] = item_qtys.get(item_code, 0) + qty
	return item_qtys


def _validate_stock_qtys(item_qtys, profile):
	if not item_qtys:
		frappe.throw(_("Cannot submit an empty cart"))

	for item_code, qty in item_qtys.items():
		item = frappe.get_cached_doc("Item", item_code)
		if not item.is_stock_item or item.allow_negative_stock:
			continue

		actual_qty = _get_actual_qty(item_code, profile.warehouse)
		if actual_qty < qty:
			if item.get("has_batch_no"):
				_throw(
					"INSUFFICIENT_BATCH_STOCK",
					_("Only {0} units are available across valid batches for {1}.").format(
						actual_qty, item_code
					),
					{"requested_qty": qty, "available_qty": actual_qty},
				)
			frappe.throw(
				_("Insufficient stock for {0}. Available quantity is {1}.").format(item_code, actual_qty)
			)


def _get_actual_qty(item_code, warehouse):
	if not warehouse:
		return 0
	return flt(
		frappe.db.sql(
			"""
			select sum(actual_qty)
			from `tabStock Ledger Entry`
			where item_code = %s
				and warehouse = %s
				and docstatus < 2
				and is_cancelled = 0
			""",
			(item_code, warehouse),
		)[0][0]
		or 0
	)


def validate_cart_items(items, profile):
	item_qtys = _get_cart_item_qtys(items)
	_validate_stock_qtys(item_qtys, profile)
	return item_qtys


def _get_item_row(item_code, qty, doc, profile, item_tax_template=None):
	ctx = frappe._dict(
		{
			"doctype": doc.doctype,
			"child_doctype": f"{doc.doctype} Item",
			"item_code": item_code,
			"item_tax_template": item_tax_template,
			"company": doc.company,
			"customer": doc.customer,
			"selling_price_list": doc.selling_price_list,
			"price_list": doc.selling_price_list,
			"currency": doc.currency,
			"conversion_rate": doc.get("conversion_rate") or 1,
			"plc_conversion_rate": doc.get("plc_conversion_rate") or 1,
			"warehouse": profile.warehouse,
			"qty": flt(qty),
			"is_pos": doc.get("is_pos"),
			"update_stock": doc.get("update_stock"),
		}
	)
	details = get_item_details(ctx, doc=doc)
	row = {
		"item_code": item_code,
		"qty": flt(qty),
		"uom": details.get("uom"),
		"stock_uom": details.get("stock_uom"),
		"conversion_factor": details.get("conversion_factor") or 1,
		"warehouse": profile.warehouse or details.get("warehouse"),
		"rate": flt(details.get("rate") or details.get("price_list_rate") or 0),
		"against_pick_list": None,
		"pick_list_item": None,
	}
	for fieldname in (
		"item_name",
		"description",
		"income_account",
		"expense_account",
		"cost_center",
		"item_tax_template",
		"item_tax_rate",
		"price_list_rate",
	):
		if details.get(fieldname) is not None:
			row[fieldname] = details.get(fieldname)
	if item_tax_template:
		row["item_tax_template"] = item_tax_template
		if not row.get("item_tax_rate"):
			row["item_tax_rate"] = get_item_tax_map(doc=doc, tax_template=item_tax_template, as_json=True)
	return row


def _set_row_batch_allocations(row, allocations):
	row._batch_allocations = allocations or []


def _get_row_batch_allocations(row):
	if getattr(row, "_batch_allocations", None):
		return row._batch_allocations
	if row.get("serial_and_batch_bundle"):
		return _get_bundle_allocations(row.serial_and_batch_bundle)
	if row.get("batch_no"):
		return [
			{
				"batch_no": row.batch_no,
				"qty": flt(row.qty),
				"expiry_date": frappe.db.get_value("Batch", row.batch_no, "expiry_date"),
				"available_qty": None,
			}
		]
	return []


def _get_bundle_allocations(bundle_name):
	allocations = []
	if not bundle_name or not frappe.db.exists("Serial and Batch Bundle", bundle_name):
		return allocations
	bundle = frappe.get_doc("Serial and Batch Bundle", bundle_name)
	for entry in bundle.get("entries", []):
		if not entry.get("batch_no"):
			continue
		allocations.append(
			{
				"batch_no": entry.batch_no,
				"qty": abs(flt(entry.qty)),
				"expiry_date": frappe.db.get_value("Batch", entry.batch_no, "expiry_date"),
				"available_qty": None,
			}
		)
	return allocations


def _reserved_batch_qtys(doc):
	reserved = {}
	for row in doc.get("items", []):
		for allocation in _get_row_batch_allocations(row):
			key = (row.item_code, row.get("warehouse"), allocation.get("batch_no"))
			reserved[key] = reserved.get(key, 0) + flt(allocation.get("qty"))
	return reserved


def _allocate_batches_for_doc(item_code, qty, warehouse, reserved):
	remaining_qty = flt(qty)
	allocations = []
	for batch in get_item_batches(item_code, warehouse=warehouse).get("batches", []):
		if remaining_qty <= 0:
			break
		key = (item_code, warehouse, batch.get("batch_no"))
		available_qty = flt(batch.get("available_qty")) - flt(reserved.get(key))
		allocated_qty = min(available_qty, remaining_qty)
		if allocated_qty <= 0:
			continue
		allocation = {
			"batch_no": batch.get("batch_no"),
			"qty": allocated_qty,
			"expiry_date": batch.get("expiry_date"),
			"available_qty": flt(batch.get("available_qty")),
		}
		allocations.append(allocation)
		reserved[key] = flt(reserved.get(key)) + allocated_qty
		remaining_qty -= allocated_qty

	allocated_qty = sum(flt(row["qty"]) for row in allocations)
	if flt(allocated_qty) < flt(qty):
		_throw(
			"INSUFFICIENT_BATCH_STOCK",
			_("Only {0} units are available across valid batches for {1}.").format(allocated_qty, item_code),
			{"requested_qty": qty, "available_qty": allocated_qty},
		)
	return allocations


def _apply_batch_allocation(row, doc, profile, qty=None):
	flags = get_item_tracking_flags(row.item_code)
	if flags["requires_serial"]:
		_throw("SERIAL_SELECTION_REQUIRED", _("Serial-numbered items require manual serial selection."))
	if not flags["requires_batch"]:
		return row

	allocation = allocate_item_batches(
		row.item_code,
		qty or row.qty,
		warehouse=profile.warehouse or row.get("warehouse"),
		strategy="FEFO",
	)
	allocations = allocation.get("allocations", [])
	_set_row_batch_allocations(row, allocations)
	if len(allocations) == 1:
		row.batch_no = allocations[0]["batch_no"]
		if row.meta.has_field("actual_batch_qty"):
			row.actual_batch_qty = allocations[0]["qty"]
	return row


def _create_serial_and_batch_bundle_for_row(doc, row, allocations):
	if not allocations or len(allocations) <= 1 or not row.meta.has_field("serial_and_batch_bundle"):
		return None
	if row.get("serial_and_batch_bundle"):
		frappe.db.set_value(
			"Serial and Batch Bundle",
			row.serial_and_batch_bundle,
			{
				"item_code": row.item_code,
				"warehouse": row.get("warehouse"),
				"company": doc.company,
				"has_batch_no": 1,
				"has_serial_no": 0,
				"voucher_type": doc.doctype,
				"voucher_no": doc.name,
				"voucher_detail_no": row.name,
				"type_of_transaction": "Outward",
			},
		)
		return row.serial_and_batch_bundle
	frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
	bundle = frappe.new_doc("Serial and Batch Bundle")
	bundle.item_code = row.item_code
	bundle.warehouse = row.get("warehouse")
	bundle.company = doc.company
	bundle.has_batch_no = 1
	bundle.has_serial_no = 0
	bundle.voucher_type = doc.doctype
	bundle.voucher_no = doc.name
	bundle.voucher_detail_no = row.name
	bundle.type_of_transaction = "Outward"
	bundle.posting_datetime = get_datetime(f"{doc.posting_date} {doc.get('posting_time') or '00:00:00'}")
	for allocation in allocations:
		bundle.append(
			"entries",
			{
				"batch_no": allocation["batch_no"],
				"qty": -abs(flt(allocation["qty"])),
				"warehouse": row.get("warehouse"),
			},
		)
	bundle.insert(ignore_permissions=True)
	frappe.db.set_value(row.doctype, row.name, "serial_and_batch_bundle", bundle.name)
	row.serial_and_batch_bundle = bundle.name
	row.batch_no = None
	frappe.db.set_value(row.doctype, row.name, "batch_no", None)
	return bundle.name


def _materialize_batch_bundles(doc):
	changed = False
	for row in doc.get("items", []):
		allocations = _get_row_batch_allocations(row)
		if len(allocations) > 1:
			_create_serial_and_batch_bundle_for_row(doc, row, allocations)
			changed = True
	if changed:
		doc.save(ignore_permissions=True)
	return doc


def validate_invoice_batch_allocations(doc):
	allocated_by_batch = {}
	for row in doc.get("items", []):
		flags = get_item_tracking_flags(row.item_code)
		if flags["requires_serial"]:
			_throw("SERIAL_SELECTION_REQUIRED", _("Serial-numbered items require manual serial selection."))
		if not flags["requires_batch"]:
			continue
		allocations = _get_row_batch_allocations(row)
		if not allocations:
			_throw(
				"BATCH_ALLOCATION_REQUIRED",
				_("Batch allocation is required for item {0}.").format(row.item_code),
			)
		validate_batch_allocation(row.item_code, row.qty, allocations, warehouse=row.get("warehouse"))
		for allocation in allocations:
			key = (row.item_code, row.get("warehouse"), allocation.get("batch_no"))
			allocated_by_batch[key] = allocated_by_batch.get(key, 0) + flt(allocation.get("qty"))

	for (item_code, warehouse, batch_no), allocated_qty in allocated_by_batch.items():
		available = {
			row["batch_no"]: row
			for row in get_item_batches(item_code, warehouse=warehouse).get("batches", [])
		}
		available_qty = flt((available.get(batch_no) or {}).get("available_qty"))
		if flt(allocated_qty) > available_qty:
			_throw(
				"INSUFFICIENT_BATCH_STOCK",
				_("Only {0} units are available in batch {1}.").format(available_qty, batch_no),
				{"requested_qty": allocated_qty, "available_qty": available_qty},
			)


def _resolve_invoice_doctype(invoice_doctype=None):
	invoice_doctype = invoice_doctype or get_invoice_mode()
	_validate_invoice_doctype(invoice_doctype)
	return invoice_doctype


def _build_invoice_doc(pos_profile=None, customer=None, invoice_doctype=None):
	invoice_doctype = _resolve_invoice_doctype(invoice_doctype)
	profile = resolve_pos_profile(pos_profile)
	customer = customer or profile.customer
	if not customer:
		frappe.throw(_("Customer is required because the POS Profile has no default customer"))

	doc = frappe.new_doc(invoice_doctype)
	doc.customer = customer
	doc.company = profile.company
	doc.posting_date = nowdate()
	_set_if_has_field(doc, "set_posting_time", 1)
	_set_if_has_field(doc, "is_pos", 1)
	_set_if_has_field(doc, "update_stock", 1)
	_set_if_has_field(doc, "pos_profile", profile.name)
	_sync_profile_pricing_fields(doc, profile)
	_set_if_has_field(doc, VUNAPOS_FIELD, 1)
	_set_if_has_field(doc, HELD_FIELD, 0)
	_set_if_has_field(doc, IDEMPOTENCY_FIELD, None)
	_reset_invoice_totals(doc)

	if invoice_doctype == "POS Invoice" and _has_field(doc.doctype, "payments"):
		for row in profile.get("payments", []):
			doc.append(
				"payments",
				{"mode_of_payment": row.mode_of_payment, "amount": 0, "default": row.get("default")},
			)

	return doc, profile


def _append_cart_items(doc, profile, items):
	reserved = _reserved_batch_qtys(doc)
	for item in _cart_item_rows(items):
		flags = get_item_tracking_flags(item.get("item_code"))
		if flags["requires_serial"]:
			_throw("SERIAL_SELECTION_REQUIRED", _("Serial-numbered items require manual serial selection."))
		if flags["requires_batch"]:
			allocations = _allocate_batches_for_doc(
				item.get("item_code"),
				item.get("qty"),
				profile.warehouse,
				reserved,
			)
			row = doc.append(
				"items",
				_get_item_row(
					item.get("item_code"),
					item.get("qty"),
					doc,
					profile,
					item_tax_template=item.get("item_tax_template"),
				),
			)
			if len(allocations) == 1:
				row.batch_no = allocations[0].get("batch_no")
				if row.meta.has_field("actual_batch_qty"):
					row.actual_batch_qty = allocations[0].get("qty")
			_set_row_batch_allocations(row, allocations)
			continue
		doc.append(
			"items",
			_get_item_row(
				item.get("item_code"),
				item.get("qty"),
				doc,
				profile,
				item_tax_template=item.get("item_tax_template"),
			),
		)
	return doc


def create_draft_invoice(pos_profile=None, customer=None):
	invoice_doctype = _resolve_invoice_doctype()
	require_create(invoice_doctype)
	doc, _profile = _build_invoice_doc(
		pos_profile=pos_profile, customer=customer, invoice_doctype=invoice_doctype
	)
	doc.insert(ignore_mandatory=True)
	return invoice_to_dict(doc)


def preview_invoice(pos_profile=None, customer=None, items=None, invoice_doctype=None):
	invoice_doctype = _resolve_invoice_doctype(invoice_doctype)
	require_create(invoice_doctype)
	doc, profile = _build_invoice_doc(
		pos_profile=pos_profile,
		customer=customer,
		invoice_doctype=invoice_doctype,
	)
	cart_items = _cart_item_rows(items)
	validate_cart_items(cart_items, profile)
	_append_cart_items(doc, profile, cart_items)
	_recalculate(doc)
	return invoice_to_dict(doc)


def get_invoice(invoice_doctype, invoice_name):
	_validate_invoice_doctype(invoice_doctype)
	require_read(invoice_doctype, invoice_name)
	return invoice_to_dict(frappe.get_doc(invoice_doctype, invoice_name))


def hold_invoice(invoice_doctype, invoice_name):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	_set_if_has_field(doc, VUNAPOS_FIELD, 1)
	_set_if_has_field(doc, HELD_FIELD, 1)
	doc.save(ignore_permissions=True)
	return invoice_to_dict(doc)


def restore_invoice(invoice_doctype, invoice_name):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	_set_if_has_field(doc, HELD_FIELD, 0)
	doc.save(ignore_permissions=True)
	return invoice_to_dict(doc)


def clear_invoice(invoice_doctype, invoice_name):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	doc.set("items", [])
	if _has_field(doc.doctype, "taxes"):
		doc.set("taxes", [])
	if _has_field(doc.doctype, "payments"):
		doc.set("payments", [])
	_reset_invoice_totals(doc)
	_set_if_has_field(doc, HELD_FIELD, 0)
	doc.flags.ignore_mandatory = True
	doc.save(ignore_permissions=True)
	return invoice_to_dict(doc)


def update_invoice_from_cart(invoice_doctype, invoice_name, customer=None, items=None):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	profile = resolve_pos_profile(doc.get("pos_profile"))
	cart_items = _cart_item_rows(items)
	validate_cart_items(cart_items, profile)

	if customer:
		doc.customer = customer
	_sync_profile_pricing_fields(doc, profile)
	doc.set("items", [])
	if _has_field(doc.doctype, "taxes"):
		doc.set("taxes", [])

	_append_cart_items(doc, profile, cart_items)

	_set_if_has_field(doc, VUNAPOS_FIELD, 1)
	_set_if_has_field(doc, HELD_FIELD, 0)
	_save_invoice(doc)
	return invoice_to_dict(doc)


def _held_invoice_row(doctype, row):
	total = row.get("rounded_total") or row.get("grand_total") or 0
	return {
		"doctype": doctype,
		"name": row.get("name"),
		"customer": row.get("customer"),
		"customer_name": row.get("customer_name"),
		"posting_date": row.get("posting_date"),
		"modified": row.get("modified"),
		"grand_total": row.get("grand_total"),
		"rounded_total": row.get("rounded_total"),
		"total": total,
		"currency": row.get("currency"),
	}


def list_held_invoices(pos_profile=None, limit=20):
	limit = min(int(limit or 20), 100)
	rows = []
	for doctype in SUPPORTED_INVOICE_DOCTYPES:
		if not frappe.db.table_exists(doctype):
			continue
		require_read(doctype)
		filters = {
			"docstatus": 0,
		}
		if _has_field(doctype, VUNAPOS_FIELD):
			filters[VUNAPOS_FIELD] = 1
		if _has_field(doctype, HELD_FIELD):
			filters[HELD_FIELD] = 1
		if pos_profile and _has_field(doctype, "pos_profile"):
			filters["pos_profile"] = pos_profile

		for row in frappe.get_all(
			doctype,
			filters=filters,
			fields=[
				"name",
				"customer",
				"customer_name",
				"posting_date",
				"modified",
				"grand_total",
				"rounded_total",
				"currency",
			],
			order_by="modified desc",
			limit_page_length=limit,
		):
			rows.append(_held_invoice_row(doctype, row))

	rows.sort(key=lambda row: row.get("modified") or "", reverse=True)
	return rows[:limit]


def add_item(invoice_doctype, invoice_name, item_code, qty=1):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	profile = resolve_pos_profile(doc.get("pos_profile"))
	_sync_profile_pricing_fields(doc, profile)
	validate_cart_items([{"item_code": item_code, "qty": qty}], profile)
	_append_cart_items(doc, profile, [{"item_code": item_code, "qty": qty}])
	_save_invoice(doc)
	return invoice_to_dict(doc)


def update_item(invoice_doctype, invoice_name, row_name, qty):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	row = next((item for item in doc.get("items", []) if item.name == row_name), None)
	if not row:
		frappe.throw(_("Invoice item row {0} was not found").format(row_name))
	profile = resolve_pos_profile(doc.get("pos_profile"))
	_sync_profile_pricing_fields(doc, profile)
	validate_cart_items([{"item_code": row.item_code, "qty": qty}], profile)
	flags = get_item_tracking_flags(row.item_code)
	if flags["requires_serial"]:
		_throw("SERIAL_SELECTION_REQUIRED", _("Serial-numbered items require manual serial selection."))
	if flags["requires_batch"]:
		item_code = row.item_code
		item_tax_template = row.get("item_tax_template")
		doc.remove(row)
		_append_cart_items(
			doc,
			profile,
			[{"item_code": item_code, "qty": qty, "item_tax_template": item_tax_template}],
		)
		_save_invoice(doc)
		return invoice_to_dict(doc)
	row.qty = flt(qty)
	row.batch_no = None
	if row.meta.has_field("serial_and_batch_bundle"):
		row.serial_and_batch_bundle = None
	_apply_batch_allocation(row, doc, profile, qty)
	_save_invoice(doc)
	return invoice_to_dict(doc)


def remove_item(invoice_doctype, invoice_name, row_name):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	row = next((item for item in doc.get("items", []) if item.name == row_name), None)
	if not row:
		frappe.throw(_("Invoice item row {0} was not found").format(row_name))
	doc.remove(row)
	_save_invoice(doc)
	return invoice_to_dict(doc)


def set_payment_rows(doc, payments=None):
	if not _has_field(doc.doctype, "payments"):
		return doc

	doc.set("payments", [])
	for payment in _payment_rows(payments):
		doc.append(
			"payments",
			{
				"mode_of_payment": payment.get("mode_of_payment"),
				"amount": flt(payment.get("amount")),
				"default": payment.get("default"),
			},
		)
	return doc


def submit_invoice(invoice_doctype, invoice_name, payments=None):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	profile = resolve_pos_profile(doc.get("pos_profile"))
	validate_cart_items(
		[{"item_code": item.item_code, "qty": item.qty} for item in doc.get("items", [])],
		profile,
	)
	_recalculate(doc)
	validate_invoice_batch_allocations(doc)
	set_payment_rows(doc, payments)
	if hasattr(doc, "set_paid_amount"):
		doc.set_paid_amount()
	doc.flags.ignore_mandatory = False
	doc.save()
	doc.submit()
	return invoice_to_dict(doc)


def checkout_invoice(invoice_doctype, invoice_name, payments=None, idempotency_key=None):
	existing = _find_submitted_invoice_by_idempotency_key(idempotency_key)
	if existing:
		return invoice_to_dict(existing)

	doc = _load_checkout_invoice(invoice_doctype, invoice_name)
	if doc.docstatus == 1:
		return invoice_to_dict(doc)
	if doc.docstatus != 0:
		_throw("INVOICE_ALREADY_SUBMITTED", _("This invoice has already been submitted"))
	if _has_field(doc.doctype, VUNAPOS_FIELD) and not doc.get(VUNAPOS_FIELD):
		_throw("INVALID_VUNAPOS_INVOICE", _("Invoice was not created by VunaPOS"))
	if not doc.get("items"):
		_throw("EMPTY_INVOICE", _("Add at least one item before checkout"))

	profile = resolve_pos_profile(doc.get("pos_profile"))
	validate_cart_items(
		[{"item_code": item.item_code, "qty": item.qty} for item in doc.get("items", [])],
		profile,
	)
	_recalculate(doc)
	validate_invoice_batch_allocations(doc)
	payment_rows = validate_payment_rows(doc, payments, profile)
	set_payment_rows(doc, payment_rows)
	_set_if_has_field(doc, VUNAPOS_FIELD, 1)
	_set_if_has_field(doc, HELD_FIELD, 0)
	if idempotency_key:
		_set_if_has_field(doc, IDEMPOTENCY_FIELD, idempotency_key)
	if hasattr(doc, "set_paid_amount"):
		doc.set_paid_amount()
	doc.flags.ignore_mandatory = False
	doc.save()
	doc.submit()
	return invoice_to_dict(doc)


def create_invoice_from_cart(pos_profile=None, customer=None, items=None):
	savepoint = "vunapos_hold_invoice"
	frappe.db.savepoint(savepoint)
	try:
		profile = resolve_pos_profile(pos_profile)
		cart_items = _cart_item_rows(items)
		validate_cart_items(cart_items, profile)

		draft = create_draft_invoice(pos_profile=profile.name, customer=customer)
		doc = frappe.get_doc(draft["doctype"], draft["name"])

		_append_cart_items(doc, profile, cart_items)

		_save_invoice(doc)
		return invoice_to_dict(doc)
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		raise


def create_and_submit_invoice(pos_profile=None, customer=None, items=None, payments=None):
	savepoint = "vunapos_checkout"
	frappe.db.savepoint(savepoint)
	try:
		draft = create_invoice_from_cart(pos_profile=pos_profile, customer=customer, items=items)
		doc = frappe.get_doc(draft["doctype"], draft["name"])
		return checkout_invoice(doc.doctype, doc.name, payments=payments)
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		raise
