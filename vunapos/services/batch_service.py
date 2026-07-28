import math

import frappe
from erpnext.stock.doctype.batch.batch import get_batch_qty
from erpnext.stock.doctype.stock_reservation_entry.stock_reservation_entry import (
	get_sre_reserved_serial_nos_details,
)
from frappe import _
from frappe.utils import flt, getdate, nowdate

from vunapos.services.profile_service import resolve_pos_profile


def _throw(code, message, meta=None):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	exc.vuna_error_meta = meta or {}
	raise exc


def _resolve_warehouse(warehouse=None, pos_profile=None):
	if pos_profile:
		profile = resolve_pos_profile(pos_profile)
		if warehouse and warehouse != profile.warehouse:
			frappe.throw(_("Warehouse {0} is not available for this POS Profile").format(warehouse))
		if not profile.warehouse:
			frappe.throw(_("Warehouse is required because the POS Profile has no warehouse"))
		return profile.warehouse
	if warehouse:
		return warehouse
	profile = resolve_pos_profile(pos_profile)
	if not profile.warehouse:
		frappe.throw(_("Warehouse is required because the POS Profile has no warehouse"))
	return profile.warehouse


def get_item_tracking_flags(item_code):
	item = frappe.get_cached_doc("Item", item_code)
	return {
		"requires_batch": bool(item.get("has_batch_no")),
		"requires_serial": bool(item.get("has_serial_no")),
	}


def _get_erpnext_batch_qty_map(item_code, warehouse):
	batch_qty = get_batch_qty(item_code=item_code, warehouse=warehouse)
	qty_map = {}

	if isinstance(batch_qty, dict):
		for batch_no, qty in batch_qty.items():
			if batch_no:
				qty_map[batch_no] = flt(qty)
		return qty_map

	for row in batch_qty or []:
		batch_no = row.get("batch_no") if hasattr(row, "get") else None
		if batch_no:
			qty_map[batch_no] = flt(qty_map.get(batch_no)) + flt(row.get("qty"))

	return qty_map


def _get_legacy_batch_qty_map(item_code, warehouse):
	rows = frappe.db.sql(
		"""
		select
			stock.batch_no,
			sum(stock.actual_qty) as available_qty
		from (
			select
				sle.batch_no,
				sle.actual_qty
			from `tabStock Ledger Entry` sle
			where sle.item_code = %s
				and sle.warehouse = %s
				and sle.docstatus < 2
				and ifnull(sle.is_cancelled, 0) = 0
				and ifnull(sle.batch_no, '') != ''
				and ifnull(sle.serial_and_batch_bundle, '') = ''

			union all

			select
				sbe.batch_no,
				sbe.qty as actual_qty
			from `tabStock Ledger Entry` sle
			inner join `tabSerial and Batch Entry` sbe
				on sbe.parent = sle.serial_and_batch_bundle
			where sle.item_code = %s
				and sle.warehouse = %s
				and sle.docstatus < 2
				and ifnull(sle.is_cancelled, 0) = 0
				and ifnull(sle.serial_and_batch_bundle, '') != ''
				and ifnull(sbe.batch_no, '') != ''
				and ifnull(sbe.is_cancelled, 0) = 0
		) stock
		group by stock.batch_no
		having available_qty > 0
		""",
		(item_code, warehouse, item_code, warehouse),
		as_dict=True,
	)
	return {row.batch_no: flt(row.available_qty) for row in rows}


def _get_batch_qty_map(item_code, warehouse):
	qty_map = _get_erpnext_batch_qty_map(item_code, warehouse)
	if qty_map:
		return qty_map
	return _get_legacy_batch_qty_map(item_code, warehouse)


def get_item_batches(item_code, warehouse=None, pos_profile=None):
	warehouse = _resolve_warehouse(warehouse=warehouse, pos_profile=pos_profile)
	flags = get_item_tracking_flags(item_code)
	serials = []
	if flags["requires_serial"]:
		reserved = get_sre_reserved_serial_nos_details(item_code, warehouse)
		serials = frappe.get_all(
			"Serial No",
			filters={"item_code": item_code, "warehouse": warehouse, "status": "Active"},
			fields=["name as serial_no", "batch_no"],
			order_by="creation asc",
		)
		serials = [row for row in serials if row.serial_no not in reserved]
	if not flags["requires_batch"]:
		return {
			"item_code": item_code,
			"warehouse": warehouse,
			"requires_batch": False,
			"requires_serial": flags["requires_serial"],
			"batches": [],
			"serials": serials,
		}

	qty_map = _get_batch_qty_map(item_code, warehouse)
	rows = []
	if qty_map:
		rows = frappe.get_all(
			"Batch",
			filters={
				"name": ["in", list(qty_map)],
				"item": item_code,
				"disabled": 0,
			},
			fields=["name", "expiry_date", "creation"],
			order_by="expiry_date asc, creation asc",
		)
		rows.sort(
			key=lambda row: (
				1 if not row.expiry_date else 0,
				getdate(row.expiry_date) if row.expiry_date else getdate("9999-12-31"),
				row.creation,
			)
		)

	return {
		"item_code": item_code,
		"warehouse": warehouse,
		"requires_batch": True,
		"requires_serial": flags["requires_serial"],
		"serials": serials,
		"batches": [
			{
				"batch_no": row.name,
				"expiry_date": row.expiry_date,
				"available_qty": flt(qty_map.get(row.name)),
			}
			for row in rows
			if flt(qty_map.get(row.name)) > 0
			and (not row.expiry_date or getdate(row.expiry_date) >= getdate(nowdate()))
		],
	}


def validate_serial_allocation(item_code, qty, allocations, warehouse=None):
	warehouse = _resolve_warehouse(warehouse=warehouse)
	try:
		required = int(qty)
	except (OverflowError, TypeError, ValueError):
		required = -1
	if required <= 0 or flt(qty) != required:
		_throw("INVALID_SERIAL_QUANTITY", _("Serial-numbered item quantity must be a whole number."))
	if not isinstance(allocations, list) or len(allocations) != required:
		_throw(
			"SERIAL_QUANTITY_MISMATCH",
			_("Select exactly {0} serial numbers for item {1}.").format(required, item_code),
		)
	serial_nos = [row.get("serial_no") for row in allocations]
	if any(not serial_no for serial_no in serial_nos) or len(set(serial_nos)) != len(serial_nos):
		_throw("INVALID_SERIAL_ALLOCATION", _("Serial numbers must be present and unique."))
	available = {
		row["serial_no"]: row for row in get_item_batches(item_code, warehouse=warehouse).get("serials", [])
	}
	for allocation in allocations:
		serial_no = allocation["serial_no"]
		if serial_no not in available:
			_throw(
				"SERIAL_NOT_AVAILABLE",
				_("Serial number {0} is not available for item {1} in warehouse {2}.").format(
					serial_no, item_code, warehouse
				),
			)
		batch_no = available[serial_no].get("batch_no")
		if allocation.get("batch_no") and allocation.get("batch_no") != batch_no:
			_throw(
				"INVALID_SERIAL_ALLOCATION",
				_("Serial number {0} belongs to another batch.").format(serial_no),
			)
		allocation["batch_no"] = batch_no
	return allocations


def allocate_batches(item_code, qty, warehouse=None, pos_profile=None, strategy="FEFO"):
	qty = flt(qty)
	if qty <= 0:
		frappe.throw(_("Quantity must be greater than zero"))
	warehouse = _resolve_warehouse(warehouse=warehouse, pos_profile=pos_profile)
	flags = get_item_tracking_flags(item_code)

	if flags["requires_serial"]:
		_throw(
			"SERIAL_SELECTION_REQUIRED",
			_("Serial-numbered items require manual serial selection."),
		)

	if not flags["requires_batch"]:
		return {
			"item_code": item_code,
			"warehouse": warehouse,
			"requested_qty": qty,
			"allocated_qty": 0,
			"strategy": strategy,
			"requires_batch": False,
			"requires_serial": False,
			"allocations": [],
		}

	if strategy.upper() != "FEFO":
		frappe.throw(_("Unsupported batch allocation strategy: {0}").format(strategy))

	batch_payload = get_item_batches(item_code, warehouse=warehouse)
	remaining_qty = qty
	allocations = []
	for batch in batch_payload["batches"]:
		if remaining_qty <= 0:
			break
		allocated_qty = min(flt(batch["available_qty"]), remaining_qty)
		if allocated_qty <= 0:
			continue
		allocations.append(
			{
				"batch_no": batch["batch_no"],
				"qty": allocated_qty,
				"expiry_date": batch.get("expiry_date"),
				"available_qty": flt(batch.get("available_qty")),
			}
		)
		remaining_qty -= allocated_qty

	allocated_qty = sum(flt(row["qty"]) for row in allocations)
	if flt(allocated_qty) < flt(qty):
		_throw(
			"INSUFFICIENT_BATCH_STOCK",
			_("Only {0} units are available across valid batches for {1}.").format(allocated_qty, item_code),
			meta={
				"requested_qty": qty,
				"available_qty": allocated_qty,
				"available_batches": batch_payload["batches"],
			},
		)

	return {
		"item_code": item_code,
		"warehouse": warehouse,
		"requested_qty": qty,
		"allocated_qty": allocated_qty,
		"strategy": strategy.upper(),
		"requires_batch": True,
		"requires_serial": False,
		"allocations": allocations,
	}


def validate_batch_allocation(item_code, qty, allocations, warehouse=None):
	if not allocations:
		_throw("BATCH_ALLOCATION_REQUIRED", _("Batch allocation is required for item {0}.").format(item_code))
	available = {row["batch_no"]: row for row in get_item_batches(item_code, warehouse=warehouse)["batches"]}
	total_qty = 0
	seen_batches = set()
	for allocation in allocations:
		batch_no = allocation.get("batch_no")
		allocation_qty = flt(allocation.get("qty"))
		if not batch_no or not math.isfinite(allocation_qty) or allocation_qty <= 0:
			_throw("INVALID_BATCH_ALLOCATION", _("Invalid batch allocation for item {0}.").format(item_code))
		if batch_no in seen_batches:
			_throw(
				"DUPLICATE_BATCH_ALLOCATION",
				_("Batch {0} is allocated more than once for item {1}.").format(batch_no, item_code),
			)
		seen_batches.add(batch_no)
		if batch_no not in available:
			batch = frappe.db.get_value("Batch", batch_no, ["item", "disabled", "expiry_date"], as_dict=True)
			if (
				batch
				and batch.item == item_code
				and not batch.disabled
				and (not batch.expiry_date or getdate(batch.expiry_date) >= getdate(nowdate()))
			):
				_throw(
					"INSUFFICIENT_BATCH_STOCK",
					_("Batch {0} has no available stock for item {1}.").format(batch_no, item_code),
					meta={"requested_qty": allocation_qty, "available_qty": 0},
				)
			_throw(
				"INVALID_BATCH_ALLOCATION",
				_("Batch {0} is not available for item {1}.").format(batch_no, item_code),
			)
		if allocation_qty > flt(available[batch_no]["available_qty"]):
			_throw(
				"INSUFFICIENT_BATCH_STOCK",
				_("Only {0} units are available in batch {1}.").format(
					available[batch_no]["available_qty"], batch_no
				),
				meta={"requested_qty": allocation_qty, "available_qty": available[batch_no]["available_qty"]},
			)
		total_qty += allocation_qty

	if flt(total_qty) != flt(qty):
		_throw("BATCH_TOTAL_MISMATCH", _("Batch allocation quantity must match item quantity."))
	return True
