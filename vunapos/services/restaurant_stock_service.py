"""Restaurant-only recipe promises. Ordinary Sales Orders never enter this path.

Preview checks are advisory. Send locks aggregate stock keys and creates native
Work Orders / reservations in the same transaction as the Sales Order and KOT.
Manufacture remains ERPNext's job; its Work Order reserves output to this order.
"""

from collections import defaultdict
from math import isfinite

import frappe
from frappe import _
from frappe.utils import cint, flt

from vunapos.services.kitchen_service import fail, route_lines


def validate_quantity_unit(qty, uom, item_code, dish=None, bom=None):
	if not isfinite(qty) or qty <= 0:
		fail("INVALID_QTY", _("Quantities for {0} must be finite and greater than zero.").format(item_code))
	if (
		uom
		and cint(frappe.get_cached_value("UOM", uom, "must_be_whole_number"))
		and abs(qty - round(qty)) > 0.000001
	):
		item_name = frappe.get_cached_value("Item", item_code, "item_name") or item_code
		message = (
			_(
				"Cannot prepare {0}: recipe {1} requires {2} {3} of {4}, but {3} only allows whole numbers. Use a valid recipe batch quantity or correct the ingredient's recipe/UOM."
			).format(dish, bom, qty, uom, item_name)
			if dish
			else _(
				"Cannot order {0}: {1} {2} is fractional, but {2} only allows whole numbers. Adjust the quantity or select an appropriate UOM."
			).format(item_name, qty, uom)
		)
		fail(
			"RESTAURANT_FRACTIONAL_UOM",
			message,
			{
				"item_code": item_code,
				"item_name": item_name,
				"quantity": qty,
				"uom": uom,
				"dish": dish,
				"bom": bom,
			},
		)


def plan_stock(profile, lines):
	from erpnext.manufacturing.doctype.bom.bom import get_bom_items_as_dict

	from vunapos.services.invoice_service import _resolve_item_uom

	demand, production, direct = defaultdict(float), [], []
	for line in lines:
		source = line.get("source") or line
		item = frappe.get_cached_doc("Item", line.item_code)
		_uom, factor = _resolve_item_uom(item.name, source.get("uom"))
		qty = flt(source.qty) * factor
		if not isfinite(qty) or qty <= 0:
			fail("INVALID_QTY", _("Preparation quantities must be finite and greater than zero."))
		validate_quantity_unit(flt(source.qty), _uom, item.name)
		validate_quantity_unit(qty, item.stock_uom, item.name)
		station = (
			frappe.get_cached_doc("Kitchen Station", line.routed_station) if line.routed_station else None
		)
		if station and not line.get("parent_line_id"):
			bom = frappe.db.get_value(
				"BOM",
				{
					"item": item.name,
					"company": profile.company,
					"is_default": 1,
					"is_active": 1,
					"docstatus": 1,
				},
				"name",
			)
			if not item.is_stock_item or not bom:
				fail(
					"QSR_BOM_REQUIRED",
					_("QSR item {0} needs an active, submitted default BOM and must be a stock item.").format(
						item.item_name
					),
				)
			if not station.raw_material_warehouse:
				fail(
					"QSR_WAREHOUSE_REQUIRED",
					_("Set a raw-material warehouse on kitchen station {0}.").format(station.station_name),
				)
			if frappe.get_cached_value("BOM", bom, "track_semi_finished_goods"):
				fail(
					"QSR_BOM_UNSUPPORTED",
					_("QSR currently requires a BOM without semi-finished-goods tracking: {0}.").format(bom),
				)
			materials = get_bom_items_as_dict(
				bom, profile.company, qty=qty, fetch_exploded=1, fetch_qty_in_stock_uom=True
			)
			# Native BOM expansion already excludes non-stock inputs. Keys can
			# include operation identifiers; always aggregate by row.item_code.
			stock_materials = [row for row in materials.values() if flt(row.qty) > 0]
			if any(
				row.get("sourced_by_supplier") or not row.get("include_item_in_manufacturing")
				for row in stock_materials
			):
				fail(
					"QSR_BOM_UNSUPPORTED",
					_(
						"QSR recipes must contain internally consumed ingredients. Check supplier-sourced or excluded ingredients in {0}."
					).format(bom),
				)
			if not stock_materials:
				fail("QSR_BOM_REQUIRED", _("BOM {0} has no stock ingredients to prepare.").format(bom))
			for row in stock_materials:
				validate_quantity_unit(flt(row.qty), row.stock_uom, row.item_code, item.item_name, bom)
				demand[(row.item_code, station.raw_material_warehouse)] += flt(row.qty)
			production.append(frappe._dict(line=line, bom=bom, qty=qty, station=station))
		elif item.is_stock_item:
			# Direct-sale items retain the existing negative-stock policy. A QSR
			# ingredient/add-on must always be physically available, however.
			if not station and item.allow_negative_stock and not item.has_batch_no and not item.has_serial_no:
				continue
			warehouse = station.raw_material_warehouse if station else profile.warehouse
			if not warehouse:
				fail(
					"QSR_WAREHOUSE_REQUIRED",
					_("Configure the stock warehouse for {0}.").format(item.item_name),
				)
			demand[(item.name, warehouse)] += qty
			direct.append(frappe._dict(line=line, warehouse=warehouse, qty=qty))
		elif frappe.db.exists("Product Bundle", {"new_item_code": item.name, "disabled": 0}):
			fail(
				"RESTAURANT_BUNDLE_UNSUPPORTED",
				_(
					"Use individual menu items or a QSR recipe for {0}; direct-sale bundle reservations are not supported yet."
				).format(item.item_name),
			)
	return frappe._dict(demand=demand, production=production, direct=direct)


def check_stock(plan, lock=False):
	from erpnext.stock.doctype.stock_reservation_entry.stock_reservation_entry import (
		get_available_qty_to_reserve,
	)
	from erpnext.stock.utils import get_or_make_bin

	shortages = []
	for (code, warehouse), required in sorted(plan.demand.items()):
		if lock:
			# Same lock order for all rounds, held through native reservation creation.
			frappe.db.get_value("Bin", get_or_make_bin(code, warehouse), "name", for_update=True)
			available = flt(get_available_qty_to_reserve(code, warehouse))
		else:
			row = frappe.db.get_value(
				"Bin",
				{"item_code": code, "warehouse": warehouse},
				["actual_qty", "reserved_stock"],
				as_dict=True,
			)
			available = flt(row.actual_qty) - flt(row.reserved_stock) if row else 0
		if required > available + 0.000001:
			item_name, uom = frappe.get_cached_value("Item", code, ["item_name", "stock_uom"])
			shortages.append(
				{
					"item_code": code,
					"item_name": item_name,
					"required_qty": required,
					"available_qty": max(0, available),
					"uom": uom,
					"warehouse": warehouse,
				}
			)
	if shortages:
		row = shortages[0]
		fail(
			"RESTAURANT_STOCK_SHORTAGE",
			_(
				"Insufficient stock for {0}: this round needs {1} {2}, but only {3} {2} is available in {4}."
			).format(
				row["item_name"], row["required_qty"], row["uom"], row["available_qty"], row["warehouse"]
			),
			{"shortages": shortages},
		)


def preview_cart(
	pos_profile, service_type, items, table=None, customer=None, price_list=None, *, prepared=None
):
	from vunapos.dto.invoice import invoice_to_dict
	from vunapos.services.invoice_service import (
		_append_cart_items,
		_build_sales_order_doc,
		_recalculate,
		_resolve_item_uom,
	)
	from vunapos.services.restaurant_order_service import (
		_apply_header_pricing,
		_new_lines,
		_restaurant_profile,
		_validate_lines,
	)

	profile = _restaurant_profile(pos_profile)
	lines = prepared
	if lines is None:
		items = frappe.parse_json(items) if isinstance(items, str) else items
		if (
			not isinstance(items, list)
			or len(items) > 500
			or any(not isinstance(item, dict) for item in items)
		):
			fail("INVALID_RESTAURANT_CART", _("Provide a list of no more than 500 cart items."))
		lines = _new_lines(items)
		_validate_lines(profile, service_type, table, lines, price_list=price_list, customer=customer)
	for line in lines:
		uom, factor = _resolve_item_uom(line.item_code, line.uom)
		validate_quantity_unit(flt(line.qty), uom, line.item_code)
		validate_quantity_unit(
			flt(line.qty) * factor,
			frappe.get_cached_value("Item", line.item_code, "stock_uom"),
			line.item_code,
		)
	doc, profile = _build_sales_order_doc(
		pos_profile=profile.name, customer=customer, price_list=price_list, service_type=service_type
	)
	doc.vunapos_restaurant = profile.vunapos_restaurant
	doc.vunapos_restaurant_table = table
	_append_cart_items(
		doc,
		profile,
		[
			{"item_code": line.item_code, "qty": line.qty, "uom": line.uom, "item_note": line.note}
			for line in lines
		],
	)
	for row, line in zip(doc.items, lines, strict=True):
		row.vunapos_line_id = line.line_id
		row.vunapos_parent_line_id = line.get("parent_line_id")
	_apply_header_pricing(doc, profile, price_list)
	_recalculate(doc, profile, price_list)
	result = invoice_to_dict(doc)
	for row, payload in zip(doc.items, result["items"], strict=True):
		payload["row_name"] = row.get("vunapos_line_id") or f"preview-free:{row.idx}:{row.item_code}"
		payload["restaurant_parent_line_id"] = row.get("vunapos_parent_line_id")
	return result


def validate_cart(
	pos_profile, service_type, items, table=None, customer=None, kitchen_routing=None, price_list=None
):
	from vunapos.services.restaurant_order_service import _new_lines, _restaurant_profile, _validate_lines

	profile = _restaurant_profile(pos_profile)
	items = frappe.parse_json(items) if isinstance(items, str) else items
	if not isinstance(items, list) or len(items) > 500 or any(not isinstance(item, dict) for item in items):
		fail("INVALID_RESTAURANT_CART", _("Provide a list of no more than 500 cart items."))
	lines = _new_lines(items)
	_validate_lines(profile, service_type, table, lines, price_list=price_list, customer=customer)
	route_lines(profile.vunapos_restaurant, lines, kitchen_routing)
	plan = plan_stock(profile, lines)
	check_stock(plan)
	return {
		"valid": True,
		"qsr_items": [entry.line.item_code for entry in plan.production],
		"invoice": preview_cart(
			pos_profile, service_type, items, table, customer, price_list, prepared=lines
		),
	}


def reserve_round(order, profile, lines):
	"""Called only for a submitted, authenticated restaurant session round."""
	plan = plan_stock(profile, lines)
	if not plan.demand:
		return
	if not cint(frappe.db.get_single_value("Stock Settings", "enable_stock_reservation")):
		fail(
			"RESTAURANT_RESERVATION_REQUIRED",
			_("Enable Stock Reservation in Stock Settings before sending stock items to the restaurant."),
		)
	# An already committed source row must never produce a second Work Order.
	existing = frappe.get_all(
		"Work Order", filters={"sales_order": order.name, "docstatus": ["!=", 2]}, pluck="sales_order_item"
	)
	if existing:
		fail("QSR_PRODUCTION_EXISTS", _("This round already has production orders; do not regenerate it."))
	check_stock(plan, lock=True)
	work_orders = {}
	for entry in plan.production:
		row = entry.line.source
		work_order = frappe.get_doc(
			{
				"doctype": "Work Order",
				"company": profile.company,
				"production_item": row.item_code,
				"bom_no": entry.bom,
				"qty": entry.qty,
				"use_multi_level_bom": 1,
				"source_warehouse": entry.station.raw_material_warehouse,
				"wip_warehouse": entry.station.wip_warehouse,
				"fg_warehouse": profile.warehouse,
				"skip_transfer": int(not entry.station.wip_warehouse),
				"from_wip_warehouse": 0,
				"reserve_stock": 1,
				"sales_order": order.name,
				"sales_order_item": row.name,
			}
		)
		work_order.get_items_and_operations_from_bom()
		for material in work_order.required_items:
			material.source_warehouse = entry.station.raw_material_warehouse
		work_order.insert(ignore_permissions=True)
		work_order.submit()
		work_order.reload()
		work_orders[row.name] = work_order.name
		for material in work_order.required_items:
			if flt(material.stock_reserved_qty) + 0.000001 < flt(material.required_qty):
				fail(
					"QSR_RESERVATION_INCOMPLETE",
					_(
						"Unable to reserve all ingredients for {0}. Nothing was sent; retry after checking stock settings."
					).format(row.item_name),
				)
	if plan.direct:
		for entry in plan.direct:
			entry.line.source.reserve_stock = 1
			entry.line.source.db_set("reserve_stock", 1, update_modified=False)
		order._create_stock_reservation_entries(
			items_details=[
				{
					"sales_order_item": entry.line.source.name,
					"warehouse": entry.warehouse,
					"qty_to_reserve": entry.qty,
					"conversion_factor": 1,
				}
				for entry in plan.direct
			],
			notify=False,
		)
		for entry in plan.direct:
			reserved = flt(
				frappe.db.get_value("Sales Order Item", entry.line.source.name, "stock_reserved_qty")
			)
			if reserved + 0.000001 < entry.qty:
				fail(
					"QSR_RESERVATION_INCOMPLETE",
					_("Unable to reserve all stock for {0}. Nothing was sent.").format(entry.line.item_code),
				)
	return work_orders
