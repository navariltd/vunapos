"""Stop a dish's entire unfinished balance, preserving its actual production.

Reviewed raw-material usage is a native consumption entry, unused WIP is a
native return, and the Work Order is closed (not reversed or manufactured).
A retained commercial charge uses the profile's non-stock charge item.
"""

from collections import defaultdict
from math import isfinite

import frappe
from frappe import _
from frappe.utils import flt

from vunapos.services import kitchen_lifecycle_service as kitchen
from vunapos.services import kitchen_progress_service as progress
from vunapos.services import restaurant_cancellation_service as cancellation
from vunapos.services import restaurant_request_service as requests
from vunapos.services.kitchen_service import fail

ACTION = "Stop Preparation"
EPS = progress.EPSILON
MARKER = "vunapos_stopped_ticket"


def validate_charge_item(name):
	item = frappe.get_doc("Item", name)
	if (
		item.disabled
		or item.is_stock_item
		or item.has_variants
		or not item.is_sales_item
		or frappe.db.exists("Product Bundle", {"new_item_code": name, "disabled": 0})
	):
		fail(
			"STOP_CHARGE_ITEM_INVALID",
			_("Cancellation Charge Item must be an enabled, non-stock sales item, not a template or bundle."),
		)
	return item


def _context(ticket):
	if not set(frappe.get_roles()) & kitchen.MANAGERS:
		frappe.throw(_("A restaurant manager must review stopped preparation."), frappe.PermissionError)
	doc = kitchen._ticket(ticket, lock=True)
	session = frappe.get_doc("Restaurant Session", doc.restaurant_session, for_update=True)
	order = frappe.get_doc("Sales Order", doc.sales_order, for_update=True)
	order.check_permission("write")
	if (
		doc.docstatus != 1
		or doc.get("remake_of")
		or (order.company, order.vunapos_restaurant, order.vunapos_branch, order.vunapos_restaurant_session)
		!= (doc.company, doc.restaurant, doc.branch, session.name)
	):
		fail(
			"STOP_CONTEXT_CHANGED",
			_(
				"Choose an original preparation ticket belonging to this restaurant visit. Replacement preparation requires its own manufacturing review."
			),
		)
	return doc, session, order


def _tracking(voucher, name, code, warehouse):
	result = {"batches": {}, "serials": []}
	for number in frappe.get_all(
		"Stock Reservation Entry",
		filters={
			"voucher_type": voucher,
			"voucher_no": name,
			"item_code": code,
			"warehouse": warehouse,
			"docstatus": 1,
		},
		pluck="name",
	):
		entry = frappe.get_doc("Stock Reservation Entry", number, for_update=True)
		for row in entry.sb_entries:
			qty = max(0, flt(row.qty) - flt(row.delivered_qty))
			if qty <= EPS:
				continue
			if row.serial_no:
				result["serials"].append(row.serial_no)
			elif row.batch_no:
				result["batches"][row.batch_no] = result["batches"].get(row.batch_no, 0) + qty
	return result


def _material(kind, line, code, warehouse, qty, tracking=None, **extra):
	item = frappe.get_cached_doc("Item", code)
	return {
		"id": requests.fingerprint([kind, line, code, warehouse]),
		"kind": kind,
		"line_id": line,
		"item_code": code,
		"item_name": item.item_name,
		"warehouse": warehouse,
		"uom": item.stock_uom,
		"max_qty": flt(qty, 6),
		"tracking": tracking or {"batches": {}, "serials": []},
		**extra,
	}


def _line(doc, row, state, order):
	from erpnext.stock.doctype.stock_entry.stock_entry import get_available_materials

	qty = flt(state["qty"] - state["cancelled_qty"] - state["ready_qty"], 6)
	if qty <= EPS or state["started_qty"] <= state["ready_qty"] + EPS:
		return None, None
	wo = frappe.get_doc("Work Order", row.work_order, for_update=True)
	source = next((part for part in order.items if part.name == row.sales_order_item), None)
	if (
		not source
		or wo.docstatus != 1
		or wo.status in ("Closed", "Stopped")
		or wo.operations
		or wo.production_plan
		or wo.track_semi_finished_goods
		or wo.subcontracting_inward_order
		or wo.process_loss_qty
		or wo.sales_order != order.name
		or wo.sales_order_item != source.name
		or wo.production_item != row.item_code
		or wo.company != order.company
		or abs(flt(wo.qty) - flt(source.stock_qty)) > EPS
	):
		fail(
			"STOP_PRODUCTION_REVIEW_REQUIRED",
			_(
				"Work Order {0} needs a manufacturing review in Desk before stopping it here. Operations, production plans, subcontracting and process loss are not automatically rewritten."
			).format(wo.name),
		)
	if abs(flt(wo.produced_qty) - flt(state["ready_qty"] * row.conversion_factor)) > EPS:
		fail(
			"STOP_READY_REVIEW_REQUIRED",
			_(
				"Work Order {0} has production not matching KDS. Mark its actual output Ready before stopping the remainder."
			).format(wo.name),
		)
	if frappe.db.exists("Stock Entry", {"work_order": wo.name, "docstatus": 0}):
		fail(
			"STOP_DRAFT_STOCK_ENTRY",
			_("Resolve draft stock entries for Work Order {0} before stopping preparation.").format(wo.name),
		)
	bom = frappe.get_doc("BOM", wo.bom_no)
	if bom.get("scrap_items") or bom.get("secondary_items"):
		fail(
			"STOP_PRODUCTION_REVIEW_REQUIRED",
			_("This recipe has secondary output. Review its materials in manufacturing before stopping it."),
		)
	if not wo.skip_transfer:
		transfers = frappe.get_all(
			"Stock Entry",
			filters={
				"work_order": wo.name,
				"purpose": "Material Transfer for Manufacture",
				"is_return": 0,
				"docstatus": 1,
			},
			pluck="name",
		)
		allowed_sources = {(part.item_code, part.source_warehouse) for part in wo.required_items}
		for part in frappe.get_all(
			"Stock Entry Detail",
			filters={"parent": ["in", transfers or [""]]},
			fields=["item_code", "s_warehouse", "t_warehouse"],
		):
			if (
				part.item_code,
				part.s_warehouse,
			) not in allowed_sources or part.t_warehouse != wo.wip_warehouse:
				fail(
					"STOP_WAREHOUSE_CHANGED",
					_(
						"Transferred ingredients have mixed or changed warehouses. Review them in manufacturing before stopping this dish."
					),
				)
	materials = []
	if not wo.skip_transfer or wo.from_wip_warehouse:
		for bucket in get_available_materials(wo.name).values():
			part = bucket.item_details
			if bucket.qty <= EPS:
				continue
			if part.original_item and part.original_item != part.item_code:
				fail(
					"STOP_ALTERNATIVE_MATERIAL",
					_("Review alternative ingredients in manufacturing before stopping this dish."),
				)
			if part.warehouse != wo.wip_warehouse:
				fail(
					"STOP_WAREHOUSE_CHANGED",
					_("Transferred ingredients no longer match this Work Order's WIP warehouse."),
				)
			materials.append(
				_material(
					"WIP",
					row.line_id,
					part.item_code,
					part.warehouse,
					bucket.qty,
					{"batches": dict(bucket.batch_details), "serials": bucket.serial_nos},
					return_warehouse=part.s_warehouse,
				)
			)
	else:
		groups = defaultdict(float)
		for part in wo.required_items:
			groups[(part.item_code, part.source_warehouse)] += max(
				0, flt(part.required_qty) - flt(part.consumed_qty)
			)
		for (code, warehouse), pending in groups.items():
			if pending > EPS:
				materials.append(
					_material(
						"Stores",
						row.line_id,
						code,
						warehouse,
						pending,
						_tracking("Work Order", wo.name, code, warehouse),
					)
				)
	for addon in order.items:
		if addon.get("vunapos_parent_line_id") == row.line_id and frappe.get_cached_value(
			"Item", addon.item_code, "is_stock_item"
		):
			cancel_qty = flt(addon.stock_qty * qty / flt(source.qty), 6)
			materials.append(
				_material(
					"Add-on",
					row.line_id,
					addon.item_code,
					addon.warehouse,
					cancel_qty,
					_tracking("Sales Order", order.name, addon.item_code, addon.warehouse),
					source_row=addon.name,
				)
			)
	if len({part["id"] for part in materials}) != len(materials):
		fail(
			"STOP_MATERIAL_REVIEW_REQUIRED",
			_("Duplicate material allocations need a manufacturing review before stopping this dish."),
		)
	return {
		"line_id": row.line_id,
		"item_name": row.item_name,
		"uom": row.uom,
		"qty": qty,
		"conversion_factor": flt(row.conversion_factor),
		"ready_qty": state["ready_qty"],
		"work_order": wo.name,
		"work_order_modified": str(wo.modified),
		"produced_qty": flt(wo.produced_qty),
		"stock_history": frappe.get_all(
			"Stock Entry",
			filters={"work_order": wo.name, "docstatus": 1},
			fields=["name", "modified"],
			order_by="name",
		),
		"recorded_consumption": [
			{"item_code": code, "qty": flt(qty), "uom": frappe.get_cached_value("Item", code, "stock_uom")}
			for code, qty in wo.get_consumed_qty_by_item().items()
			if qty > EPS
		],
		"materials": materials,
	}, wo


def _quote(doc, session, order):
	cancellation._open(session, order)
	states = progress.load([doc], for_update=True)[doc.name]
	lines, orders = [], {}
	for row in sorted(doc.items, key=lambda item: item.work_order or ""):
		if row.parent_line_id:
			continue
		line, wo = _line(doc, row, states[row.line_id], order)
		if line:
			lines.append(line)
			orders[row.line_id] = wo
	profile = frappe.get_doc("POS Profile", doc.pos_profile)
	quote = {
		"ticket": doc.name,
		"modified": str(doc.modified),
		"order_modified": str(order.modified),
		"session_modified": str(session.modified),
		"charge_item": profile.get("vunapos_cancellation_charge_item"),
		"waste_account": profile.get("vunapos_waste_expense_account"),
		"lines": lines,
	}
	quote = frappe.parse_json(frappe.as_json(quote))
	quote["fingerprint"] = requests.fingerprint(quote)
	return quote, orders, states


def preview(ticket):
	return _quote(*_context(ticket))[0]


def _review(materials, used):
	used = requests.parsed(used)
	if not isinstance(used, dict) or set(used) != {part["id"] for part in materials}:
		fail(
			"STOP_MATERIAL_REVIEW_REQUIRED",
			_(
				"Review every ingredient: enter the quantity used, including zero for reusable or untouched ingredients."
			),
		)
	for part in materials:
		value = used[part["id"]]
		try:
			qty = float(value)
		except (TypeError, ValueError):
			qty = float("nan")
		if (
			isinstance(value, bool)
			or not isfinite(qty)
			or qty < 0
			or qty > part["max_qty"] + EPS
			or abs(qty - flt(qty, 6)) > 0.00000001
		):
			fail(
				"STOP_INVALID_USAGE",
				_("{0}: enter a used quantity from zero to {1} {2}.").format(
					part["item_name"], part["max_qty"], part["uom"]
				),
			)
		from vunapos.services.restaurant_stock_service import validate_quantity_unit

		if qty > EPS:
			validate_quantity_unit(qty, part["uom"], part["item_code"])
		part["used_qty"] = flt(qty, 6)


def _append_material(entry, part, qty, target=None):
	"""Tracked inputs come only from this Work Order/order's own allocations."""
	common = {
		"item_code": part["item_code"],
		"uom": part["uom"],
		"stock_uom": part["uom"],
		"conversion_factor": 1,
		"s_warehouse": part["warehouse"],
		"t_warehouse": target,
	}
	item = frappe.get_cached_doc("Item", part["item_code"])
	tracking = part["tracking"]
	if item.has_serial_no:
		serials = tracking["serials"][: int(qty)]
		if len(serials) != int(qty) or abs(qty - int(qty)) > EPS:
			fail(
				"STOP_TRACKING_CHANGED",
				_("Not enough of this order's reserved serial numbers remain. Review its stock tracking."),
			)
		if item.has_batch_no:
			groups = defaultdict(list)
			for serial in frappe.get_all(
				"Serial No", filters={"name": ["in", serials]}, fields=["name", "batch_no"]
			):
				groups[serial.batch_no].append(serial.name)
			for batch, numbers in groups.items():
				entry.append(
					"items",
					{
						**common,
						"qty": len(numbers),
						"use_serial_batch_fields": 1,
						"batch_no": batch,
						"serial_no": "\n".join(numbers),
					},
				)
		else:
			entry.append(
				"items", {**common, "qty": qty, "use_serial_batch_fields": 1, "serial_no": "\n".join(serials)}
			)
	elif item.has_batch_no:
		remaining = qty
		for batch, available in sorted(tracking["batches"].items()):
			allocated = min(remaining, max(0, flt(available)))
			if allocated > EPS:
				entry.append(
					"items", {**common, "qty": allocated, "use_serial_batch_fields": 1, "batch_no": batch}
				)
				remaining -= allocated
		if remaining > EPS:
			fail(
				"STOP_TRACKING_CHANGED",
				_("Not enough of this order's reserved batches remain. Review its stock tracking."),
			)
	else:
		entry.append("items", {**common, "qty": qty})


def _entry(doc, purpose, materials, account=None, wo=None, qty=None):
	entry = frappe.get_doc(
		{
			"doctype": "Stock Entry",
			"company": doc.company,
			"purpose": purpose,
			MARKER: doc.name,
			"work_order": wo.name if wo else None,
			"fg_completed_qty": qty,
			"from_bom": 0,
		}
	)
	for part in materials:
		if part["used_qty"] > EPS:
			_append_material(entry, part, part["used_qty"])
	if not entry.items:
		return None
	for row in entry.items:
		row.expense_account = account
		row.cost_center = frappe.get_cached_value(
			"POS Profile", doc.pos_profile, "cost_center"
		) or frappe.get_cached_value("Company", doc.company, "cost_center")
	entry.set_stock_entry_type()
	entry.insert(ignore_permissions=True)
	entry.flags.ignore_permissions = True
	entry.submit()
	return entry.name


def _fee(order, doc, lines, changes, item):
	from vunapos.services.invoice_service import _get_item_row

	profile = frappe.get_doc("POS Profile", doc.pos_profile)
	total = sum(
		flt(row.rate) * (flt(row.qty) - changes[row.name]) for row in order.items if row.name in changes
	)
	if total <= EPS:
		return None
	values = _get_item_row(item.name, 1, order, profile)
	values.update(
		{
			"qty": 1,
			"rate": total,
			"price_list_rate": total,
			"discount_amount": 0,
			"discount_percentage": 0,
			"mapped_additional_discount_amount": 0,
			"is_free_item": 0,
			"delivery_date": order.get("delivery_date")
			or next(
				(row.delivery_date for row in order.items if row.get("delivery_date")), order.transaction_date
			),
			"vunapos_line_id": requests.fingerprint([ACTION, doc.name, lines]),
			"vunapos_item_note": _("Cancellation charge for stopped preparation on {0}.").format(doc.name),
		}
	)
	return values


def _save_order(order, changes, fee, reason):
	from vunapos.services.restaurant_rejection_service import reapply_waivers

	old = {
		key: frappe.flags.get(key)
		for key in (
			"vunapos_cancelling_restaurant_items",
			"vunapos_cancelling_kitchen_order",
			"vunapos_restaurant_charge_adjustment",
			"vunapos_stop_fee",
		)
	}
	try:
		remaining = [row for row in order.items if changes.get(row.name, flt(row.qty)) > EPS]
		if not remaining and not fee:
			frappe.flags.vunapos_cancelling_kitchen_order = order.name
			order.update(
				{
					"vunapos_cancel_reason": reason,
					"vunapos_cancel_approved_by": frappe.session.user,
					"vunapos_cancelled_by": frappe.session.user,
					"vunapos_cancelled_at": frappe.utils.now_datetime(),
				}
			)
			order.ignore_linked_doctypes = [
				"Kitchen Order Ticket",
				"Kitchen Ticket Action",
				"Work Order",
				"Stock Entry",
			]
			order.flags.ignore_permissions = True
			order.cancel()
			return
		for row in remaining:
			if row.name in changes:
				row.qty = changes[row.name]
		order.set("items", remaining)
		frappe.flags.vunapos_restaurant_charge_adjustment = reapply_waivers(order)
		if fee:
			added = order.append("items", fee)
			frappe.flags.vunapos_stop_fee = {
				"order": order.name,
				"line_id": added.vunapos_line_id,
				"item": added.item_code,
				"rate": added.rate,
			}
		frappe.flags.vunapos_cancelling_restaurant_items = order.name
		order.ignore_pricing_rule = 1
		order.flags.ignore_validate_update_after_submit = True
		order.set_qty_as_per_stock_uom()
		order.calculate_taxes_and_totals()
		order.set_total_in_words()
		order.set_payment_schedule()
		order.save(ignore_permissions=True)
		for row in order.items:
			if row.name in changes:
				order.sync_schedule_with_item(row)
		for name, qty in changes.items():
			if qty <= EPS:
				order.delete_delivery_schedule_items(name)
		order.update_reserved_qty()
		order.update_prevdoc_status("submit", update_quotation_qty=True)
		order.update_delivery_status()
		order.update_billing_percentage()
		order.set_status(update=True)
	finally:
		for key, value in old.items():
			frappe.flags[key] = value


def stop(ticket, line_ids, used, request_key, fingerprint, reason, charge):
	doc, session, order = _context(ticket)
	key = kitchen._request_key(request_key)
	if not isinstance(reason, str) or not reason.strip() or len(reason) > 500:
		fail("STOP_REASON_REQUIRED", _("Enter a stop-preparation reason of up to 500 characters."))
	if charge not in ("Keep charge", "Remove charge"):
		fail("STOP_CHARGE_REQUIRED", _("Choose whether to keep or remove the charge."))
	payload = {
		"lines": requests.parsed(line_ids),
		"used": requests.parsed(used),
		"fingerprint": fingerprint,
		"reason": reason.strip(),
		"charge": charge,
	}
	stamp = requests.fingerprint(payload)
	if kitchen._replay(doc, ACTION, key, reason.strip(), stamp, quantified=True):
		return kitchen.ticket_detail(doc.name)
	quote, work_orders, states = _quote(doc, session, order)
	if quote["fingerprint"] != fingerprint:
		fail(
			"STOP_REVIEW_CHANGED",
			_("Preparation, stock or order details changed. Review the latest ingredients before stopping."),
		)
	chosen = payload["lines"]
	if (
		not isinstance(chosen, list)
		or not chosen
		or any(not isinstance(line, str) for line in chosen)
		or len(set(chosen)) != len(chosen)
		or not set(chosen) <= {line["line_id"] for line in quote["lines"]}
	):
		fail("STOP_LINES_REQUIRED", _("Choose the dishes whose entire unfinished balance should be stopped."))
	selected = [line for line in quote["lines"] if line["line_id"] in chosen]
	materials = [part for line in selected for part in line["materials"]]
	_review(materials, payload["used"])
	fee_item = (
		validate_charge_item(quote["charge_item"])
		if charge == "Keep charge" and quote["charge_item"]
		else None
	)
	if charge == "Keep charge" and not fee_item:
		fail(
			"STOP_CHARGE_ITEM_REQUIRED",
			_("Set a non-stock Cancellation Charge Item on this POS Profile before keeping the charge."),
		)
	account = quote["waste_account"]
	if any(part["used_qty"] > EPS for part in materials):
		ledger = frappe.get_doc("Account", account) if account else None
		if (
			not ledger
			or ledger.company != order.company
			or ledger.disabled
			or ledger.is_group
			or ledger.root_type != "Expense"
			or ledger.account_currency
			!= frappe.get_cached_value("Company", order.company, "default_currency")
		):
			fail(
				"STOP_WASTE_ACCOUNT_REQUIRED",
				_(
					"Set an enabled company expense ledger as Waste Expense Account before recording used ingredients."
				),
			)
	changes, deltas = {}, {}
	for line in selected:
		deltas[line["line_id"]] = line["qty"]
		source = next(row for row in order.items if row.vunapos_line_id == line["line_id"])
		changes[source.name] = flt(source.qty - line["qty"], 6)
		for row in order.items:
			if row.get("vunapos_parent_line_id") == line["line_id"]:
				changes[row.name] = flt(row.qty * changes[source.name] / flt(source.qty), 6)
	fee = _fee(order, doc, chosen, changes, fee_item) if fee_item else None
	kitchen._lock_stock_bins(work_orders.values(), order)
	entries, resolutions = [], {}
	old_flag = frappe.flags.get("vunapos_stopping_preparation")
	try:
		frappe.flags.vunapos_stopping_preparation = doc.name
		for line in selected:
			wo = work_orders[line["line_id"]]
			entry = _entry(
				doc,
				"Material Consumption for Manufacture",
				[part for part in line["materials"] if part["kind"] != "Add-on"],
				account,
				wo,
				flt(line["qty"] * line["conversion_factor"], 6),
			)
			if entry:
				entries.append(entry)
			wo.reload()
			wo.update_status("Closed")
			wo.on_close_or_cancel()
			if not wo.skip_transfer or wo.from_wip_warehouse:
				from erpnext.manufacturing.doctype.work_order.work_order import make_stock_return_entry

				returned = make_stock_return_entry(wo.name)
				if returned and returned.items:
					returned.set(MARKER, doc.name)
					returned.flags.ignore_permissions = True
					returned.insert(ignore_permissions=True)
					returned.submit()
					entries.append(returned.name)
			resolutions[wo.name] = {
				"qty": flt(wo.qty),
				"produced_qty": flt(wo.produced_qty),
				"source_row": wo.sales_order_item,
				"sales_order": wo.sales_order,
				"company": wo.company,
				"item_code": wo.production_item,
				"source_warehouse": wo.source_warehouse,
				"wip_warehouse": wo.wip_warehouse,
				"fg_warehouse": wo.fg_warehouse,
				"stock_entries": frappe.get_all(
					"Stock Entry",
					filters={"work_order": wo.name, "docstatus": 1},
					pluck="name",
					order_by="name",
				),
			}
		# Free only cancelled add-on allocations, then issue those actually used.
		cancellation._trim_reservations(
			"Sales Order",
			order.name,
			{
				row.name: flt(changes[row.name] * row.conversion_factor, 6)
				for row in order.items
				if row.name in changes
			},
		)
		addons = [part for part in materials if part["kind"] == "Add-on"]
		for part in addons:
			remaining = _tracking("Sales Order", order.name, part["item_code"], part["warehouse"])
			part["tracking"] = {
				"batches": {
					batch: max(0, qty - remaining["batches"].get(batch, 0))
					for batch, qty in part["tracking"]["batches"].items()
				},
				"serials": [
					serial for serial in part["tracking"]["serials"] if serial not in remaining["serials"]
				],
			}
		entry = _entry(doc, "Material Issue", addons, account)
		if entry:
			entries.append(entry)
		order.reload()
		before = frappe.parse_json(frappe.as_json([row.as_dict() for row in order.items]))
		_save_order(order, changes, fee, reason.strip())
		baseline = {
			row.line_id: {field: states[row.line_id][field] for field in progress.FIELDS.values()}
			for row in doc.items
			if not row.parent_line_id
		}
		previous = doc.status
		for line, qty in deltas.items():
			state = states[line]
			state["cancelled_qty"] += qty
			for field in ("accepted_qty", "started_qty"):
				state[field] = min(state[field], state["qty"] - state["cancelled_qty"])
		doc.db_set("status", progress.status_for(doc.items, states))
		kitchen._record(
			doc,
			ACTION,
			key,
			previous,
			reason=reason.strip(),
			approved_by=frappe.session.user,
			entries=entries,
			quantities={
				"deltas": deltas,
				"before": baseline,
				"original_items": before,
				"materials": materials,
				"work_orders": resolutions,
				"stock_entries": entries,
				"charge": charge,
				"charge_item": fee_item.name if fee_item else None,
				"charge_line_id": fee.get("vunapos_line_id") if fee else None,
			},
			request_fingerprint=stamp,
		)
	finally:
		frappe.flags.vunapos_stopping_preparation = old_flag
	kitchen._publish(doc)
	return kitchen.ticket_detail(doc.name)


def resolutions(order_names):
	result = {}
	for event in frappe.qb.get_query(
		kitchen.ACTION,
		filters={"sales_order": ["in", order_names], "action": ACTION, "outcome": "Succeeded"},
		fields=["item_quantities"],
		for_update=True,
	).run(as_dict=True):
		payload = requests.parsed(event.item_quantities)
		for entry in payload.get("stock_entries", []):
			if frappe.db.get_value("Stock Entry", entry, "docstatus", for_update=True) != 1:
				fail(
					"STOP_STOCK_CHANGED",
					_("A stopped preparation's stock record changed. Reconcile it before billing."),
				)
		for name, expected in payload["work_orders"].items():
			for entry in expected.get("stock_entries", []):
				if frappe.db.get_value("Stock Entry", entry, "docstatus", for_update=True) != 1:
					fail(
						"STOP_STOCK_CHANGED",
						_("Stock history of stopped preparation changed. Reconcile it before billing."),
					)
			wo = frappe.get_doc("Work Order", name, for_update=True)
			if (
				wo.docstatus != 1
				or wo.status != "Closed"
				or abs(flt(wo.qty) - expected["qty"]) > EPS
				or abs(flt(wo.produced_qty) - expected["produced_qty"]) > EPS
				or wo.sales_order != expected["sales_order"]
				or wo.sales_order_item != expected["source_row"]
				or wo.company != expected["company"]
				or wo.production_item != expected["item_code"]
				or any(
					wo.get(field) != expected[field]
					for field in ("source_warehouse", "wip_warehouse", "fg_warehouse")
				)
			):
				fail(
					"STOP_PRODUCTION_CHANGED",
					_("A stopped Work Order changed. Review its production before billing."),
				)
			result[name] = expected
	return result


def charge_lines(order_name):
	return {
		payload["charge_line_id"]
		for row in frappe.get_all(
			kitchen.ACTION,
			filters={"sales_order": order_name, "action": ACTION, "outcome": "Succeeded"},
			fields=["item_quantities"],
		)
		if (payload := requests.parsed(row.item_quantities)).get("charge_line_id")
	}


def protect_entry(entry, method=None):
	if not frappe.db.has_column("Stock Entry", MARKER):
		return
	marked = entry.get(MARKER)
	if not entry.is_new():
		marked = marked or frappe.db.get_value("Stock Entry", entry.name, MARKER)
	if entry.work_order and not frappe.flags.get("vunapos_stopping_preparation"):
		order = frappe.db.get_value("Work Order", entry.work_order, "sales_order")
		if order:
			for event in frappe.get_all(
				kitchen.ACTION,
				filters={"sales_order": order, "action": ACTION, "outcome": "Succeeded"},
				fields=["item_quantities"],
			):
				if entry.work_order in requests.parsed(event.item_quantities).get("work_orders", {}):
					marked = marked or entry.work_order
	if marked and frappe.flags.get("vunapos_stopping_preparation") != marked:
		fail(
			"STOP_STOCK_RECONCILIATION_REQUIRED",
			_(
				"This stock entry belongs to a completed preparation stop. Reconcile the entire stop action before changing or reversing its stock."
			),
		)


def lock_production(entry, method=None):
	if not entry.work_order or not frappe.db.has_column("Kitchen Order Ticket Item", "work_order"):
		return
	for row in frappe.get_all(
		"Kitchen Order Ticket Item", filters={"work_order": entry.work_order}, fields=["parent"]
	):
		context = frappe.db.get_value(
			"Kitchen Order Ticket", row.parent, ["restaurant_session", "sales_order"], as_dict=True
		)
		if context:
			frappe.db.get_value("Restaurant Session", context.restaurant_session, "name", for_update=True)
			frappe.db.get_value("Sales Order", context.sales_order, "name", for_update=True)
			frappe.db.get_value("Kitchen Order Ticket", row.parent, "name", for_update=True)
