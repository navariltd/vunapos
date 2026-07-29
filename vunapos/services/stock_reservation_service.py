from __future__ import annotations

import hashlib
import json

import frappe
from erpnext.stock.doctype.stock_reservation_entry.stock_reservation_entry import (
	cancel_stock_reservation_entries,
	get_available_qty_to_reserve,
	get_stock_reservation_entries_for_voucher,
)
from erpnext.stock.utils import get_or_make_bin
from frappe import _
from frappe.utils import flt

SUPPORTED_RESERVATION_DOCTYPE = "Sales Invoice"


def _reservation_error(code: str, message: str, meta: dict | None = None) -> None:
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	exc.vuna_error_meta = meta or {}
	raise exc


def _stock_qty(row) -> float:
	return abs(flt(row.get("stock_qty") or flt(row.get("qty")) * flt(row.get("conversion_factor") or 1)))


def _stock_rows(doc) -> list:
	item_codes = {row.item_code for row in doc.get("items", []) if row.get("item_code")}
	if not item_codes:
		return []
	stock_items = set(
		frappe.get_all(
			"Item",
			filters={"name": ["in", sorted(item_codes)], "is_stock_item": 1},
			pluck="name",
		)
	)
	return [
		row
		for row in doc.get("items", [])
		if row.get("item_code") in stock_items and row.get("warehouse") and _stock_qty(row) > 0
	]


def _tracking_flags(item_codes: set[str]) -> dict[str, dict]:
	if not item_codes:
		return {}
	return {
		row.name: {"has_batch_no": bool(row.has_batch_no), "has_serial_no": bool(row.has_serial_no)}
		for row in frappe.get_all(
			"Item",
			filters={"name": ["in", sorted(item_codes)]},
			fields=["name", "has_batch_no", "has_serial_no"],
		)
	}


def _row_tracking_entries(row, flags: dict) -> list[dict]:
	if not flags.get("has_batch_no") and not flags.get("has_serial_no"):
		return []
	entries = []
	if row.get("serial_and_batch_bundle"):
		bundle = frappe.get_doc("Serial and Batch Bundle", row.serial_and_batch_bundle)
		if (
			bundle.get("item_code") != row.item_code
			or bundle.get("warehouse") != row.warehouse
			or bundle.get("voucher_detail_no") != row.name
		):
			_reservation_error(
				"TRACKED_STOCK_BUNDLE_MISMATCH",
				_("The Serial and Batch Bundle for item {0} does not belong to this invoice row").format(
					row.item_code
				),
			)
		for entry in bundle.get("entries", []):
			entries.append(
				{
					"serial_no": entry.get("serial_no") or None,
					"batch_no": entry.get("batch_no") or None,
					"qty": 1.0 if entry.get("serial_no") else abs(flt(entry.get("qty"))),
					"warehouse": row.warehouse,
				}
			)
	elif flags.get("has_batch_no") and row.get("batch_no"):
		entries.append(
			{
				"serial_no": None,
				"batch_no": row.batch_no,
				"qty": _stock_qty(row),
				"warehouse": row.warehouse,
			}
		)

	if flags.get("has_serial_no"):
		serials = [entry.get("serial_no") for entry in entries]
		if not serials or any(not serial for serial in serials) or len(serials) != len(set(serials)):
			_reservation_error(
				"SERIAL_RESERVATION_INVALID",
				_("Invoice row {0} does not contain a unique serial selection").format(row.name),
			)
		if flags.get("has_batch_no") and any(not entry.get("batch_no") for entry in entries):
			_reservation_error(
				"SERIAL_BATCH_RESERVATION_INVALID",
				_("Every serial number for item {0} must belong to a selected batch").format(row.item_code),
			)
	elif flags.get("has_batch_no"):
		if not entries or any(not entry.get("batch_no") for entry in entries):
			_reservation_error(
				"BATCH_RESERVATION_INVALID",
				_("Invoice row {0} does not contain a batch selection").format(row.name),
			)
		consolidated = {}
		for entry in entries:
			consolidated[entry["batch_no"]] = flt(consolidated.get(entry["batch_no"])) + flt(entry["qty"])
		entries = [
			{
				"serial_no": None,
				"batch_no": batch_no,
				"qty": qty,
				"warehouse": row.warehouse,
			}
			for batch_no, qty in sorted(consolidated.items())
		]

	selected_qty = sum(flt(entry["qty"]) for entry in entries)
	if abs(selected_qty - _stock_qty(row)) > 1e-9:
		_reservation_error(
			"TRACKED_STOCK_QUANTITY_MISMATCH",
			_("Tracked stock selection for item {0} must equal {1}").format(row.item_code, _stock_qty(row)),
			{"selected_qty": selected_qty, "required_qty": _stock_qty(row)},
		)
	return sorted(
		entries,
		key=lambda entry: (entry.get("serial_no") or "", entry.get("batch_no") or ""),
	)


def _lock_and_validate_stock(rows: list) -> None:
	required = {}
	for row in rows:
		key = (row.item_code, row.warehouse)
		required[key] = flt(required.get(key)) + _stock_qty(row)

	for item_code, warehouse in sorted(required):
		bin_name = get_or_make_bin(item_code, warehouse)
		frappe.get_doc("Bin", bin_name, for_update=True)
		available = flt(get_available_qty_to_reserve(item_code, warehouse))
		requested = flt(required[(item_code, warehouse)])
		if requested > available:
			_reservation_error(
				"INSUFFICIENT_STOCK_TO_RESERVE",
				_("Only {0} units of {1} are available to reserve in {2}.").format(
					available, item_code, warehouse
				),
				{
					"item_code": item_code,
					"warehouse": warehouse,
					"requested_qty": requested,
					"available_qty": available,
				},
			)


def _reservation_payload(doc, rows: list, flags: dict | None = None) -> list[dict]:
	flags = flags if flags is not None else _tracking_flags({row.item_code for row in rows})
	return sorted(
		[
			{
				"invoice": doc.name,
				"invoice_row": row.name,
				"item_code": row.item_code,
				"warehouse": row.warehouse,
				"stock_uom": row.stock_uom,
				"reserved_qty": _stock_qty(row),
				"tracking": _row_tracking_entries(row, flags.get(row.item_code, {})),
			}
			for row in rows
		],
		key=lambda row: (row["item_code"], row["warehouse"], row["invoice_row"]),
	)


def reservation_fingerprint(doc, rows: list | None = None) -> str:
	selected_rows = rows if rows is not None else _stock_rows(doc)
	payload = _reservation_payload(doc, selected_rows)
	encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
	return hashlib.sha256(encoded).hexdigest()


def create_invoice_stock_reservations(doc) -> list[str]:
	if doc.doctype != SUPPORTED_RESERVATION_DOCTYPE:
		_reservation_error(
			"STOCK_RESERVATION_DOCTYPE_UNSUPPORTED",
			_("Background stock reservation currently requires a Sales Invoice"),
		)
	if doc.docstatus != 0 or doc.is_new():
		_reservation_error(
			"STOCK_RESERVATION_DRAFT_REQUIRED",
			_("Save the draft Sales Invoice before reserving its stock"),
		)
	rows = _stock_rows(doc)
	if not rows:
		doc.vunapos_reservation_fingerprint = reservation_fingerprint(doc, [])
		doc.db_set("vunapos_reservation_fingerprint", doc.vunapos_reservation_fingerprint)
		return []
	if not frappe.db.get_single_value("Stock Settings", "enable_stock_reservation"):
		_reservation_error(
			"STOCK_RESERVATION_DISABLED",
			_("Enable Stock Reservation in Stock Settings before using background checkout"),
		)

	existing = get_stock_reservation_entries_for_voucher(doc.doctype, doc.name, fields=["name"])
	if existing:
		validate_invoice_stock_reservations(doc)
		return [row.name for row in existing]

	flags = _tracking_flags({row.item_code for row in rows})

	savepoint = "vunapos_stock_reservation"
	frappe.db.savepoint(savepoint)
	try:
		_lock_and_validate_stock(rows)
		reservations = []
		for row in rows:
			qty = _stock_qty(row)
			row_flags = flags.get(row.item_code, {})
			tracking_entries = _row_tracking_entries(row, row_flags)
			available = flt(get_available_qty_to_reserve(row.item_code, row.warehouse))
			sre = frappe.get_doc(
				{
					"doctype": "Stock Reservation Entry",
					"item_code": row.item_code,
					"warehouse": row.warehouse,
					"voucher_type": doc.doctype,
					"voucher_no": doc.name,
					"voucher_detail_no": row.name,
					"available_qty": available,
					"voucher_qty": qty,
					"reserved_qty": qty,
					"company": doc.company,
					"stock_uom": row.stock_uom,
					"project": doc.get("project"),
					"has_serial_no": int(bool(row_flags.get("has_serial_no"))),
					"has_batch_no": int(bool(row_flags.get("has_batch_no"))),
					"reservation_based_on": "Serial and Batch" if tracking_entries else "Qty",
				}
			)
			for entry in tracking_entries:
				sre.append("sb_entries", entry)
			sre.insert(ignore_permissions=True)
			sre.submit()
			reservations.append(sre.name)

		doc.vunapos_reservation_fingerprint = reservation_fingerprint(doc, rows)
		doc.db_set("vunapos_reservation_fingerprint", doc.vunapos_reservation_fingerprint)
		validate_invoice_stock_reservations(doc)
		return reservations
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		raise


def validate_invoice_stock_reservations(doc) -> None:
	rows = _stock_rows(doc)
	flags = _tracking_flags({row.item_code for row in rows})
	expected = {
		(row.item_code, row.warehouse, row.name): {
			"qty": _stock_qty(row),
			"tracking": _row_tracking_entries(row, flags.get(row.item_code, {})),
		}
		for row in rows
	}
	reservations = get_stock_reservation_entries_for_voucher(
		doc.doctype,
		doc.name,
		fields=["name", "item_code", "warehouse", "voucher_detail_no", "reserved_qty"],
	)
	actual = {}
	for reservation in reservations:
		key = (
			reservation.item_code,
			reservation.warehouse,
			reservation.voucher_detail_no,
		)
		sre = frappe.get_doc("Stock Reservation Entry", reservation.name)
		tracking = sorted(
			[
				{
					"serial_no": entry.get("serial_no") or None,
					"batch_no": entry.get("batch_no") or None,
					"qty": flt(entry.get("qty")),
					"warehouse": entry.get("warehouse"),
				}
				for entry in sre.get("sb_entries", [])
			],
			key=lambda entry: (entry.get("serial_no") or "", entry.get("batch_no") or ""),
		)
		if key in actual:
			_reservation_error(
				"STOCK_RESERVATION_MISMATCH",
				_("More than one active stock reservation exists for invoice row {0}").format(
					reservation.voucher_detail_no
				),
			)
		actual[key] = {"qty": flt(reservation.reserved_qty), "tracking": tracking}

	if actual != expected or doc.get("vunapos_reservation_fingerprint") != reservation_fingerprint(doc, rows):
		_reservation_error(
			"STOCK_RESERVATION_MISMATCH",
			_("The Sales Invoice stock reservations no longer match its item rows"),
			{
				"expected": [
					{
						"item_code": key[0],
						"warehouse": key[1],
						"invoice_row": key[2],
						"qty": details["qty"],
						"tracking": details["tracking"],
					}
					for key, details in sorted(expected.items())
				],
				"actual": [
					{
						"item_code": key[0],
						"warehouse": key[1],
						"invoice_row": key[2],
						"qty": details["qty"],
						"tracking": details["tracking"],
					}
					for key, details in sorted(actual.items())
				],
			},
		)


def release_invoice_stock_reservations(doc) -> None:
	if doc.doctype != SUPPORTED_RESERVATION_DOCTYPE or not doc.get("vunapos_reservation_fingerprint"):
		return
	validate_invoice_stock_reservations(doc)
	cancel_stock_reservation_entries(voucher_type=doc.doctype, voucher_no=doc.name, notify=False)
