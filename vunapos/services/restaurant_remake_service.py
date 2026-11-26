"""Additional preparation, not another sale or a reversal of the original meal.

The original bill still consumes its original stock once (including food kept
for the guest or discarded). A replacement has isolated native production and
issues ONLY its additional output to expense in the Ready transaction. No stock
is returned to saleable inventory and no reclassification journal is posted.
"""

from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import flt, get_datetime, now_datetime

from vunapos.services import kitchen_lifecycle_service as kitchen
from vunapos.services import kitchen_progress_service as progress
from vunapos.services import restaurant_request_service as requests
from vunapos.services.kitchen_service import TICKET, fail, publish_ticket_created

ACTION = "Request Remake"
EPS = progress.EPSILON


def validate_visit(ticket, session, order):
	if (
		ticket.docstatus != 1
		or order.docstatus != 1
		or order.status == "Closed"
		or (ticket.restaurant, ticket.branch, ticket.company, ticket.restaurant_session)
		!= (session.restaurant, session.branch, session.company, order.vunapos_restaurant_session)
	):
		fail("REMAKE_CONTEXT_CHANGED", _("The visit or source order no longer matches this preparation."))
	if session.status == "Open" and not session.billing_invoice and not flt(order.per_billed):
		return
	if (
		session.status != "Settled"
		or session.billing_doctype not in ("Sales Invoice", "POS Invoice")
		or not session.billing_invoice
	):
		fail(
			"REMAKE_VISIT_NOT_OPEN",
			_(
				"Use an open unbilled visit or its submitted, settled bill. Finish or resolve pending billing first."
			),
		)
	invoice = frappe.get_doc(session.billing_doctype, session.billing_invoice, for_update=True)
	if invoice.docstatus != 1 or invoice.is_return or invoice.company != session.company:
		fail("REMAKE_BILL_CHANGED", _("The visit's original bill is no longer submitted."))
	if frappe.qb.get_query(
		invoice.doctype,
		filters={"return_against": invoice.name, "docstatus": ["!=", 2]},
		fields=["name"],
		for_update=True,
	).run():
		fail(
			"REMAKE_RETURN_REVIEW_REQUIRED",
			_("This bill has a return. Reconcile the returned food before requesting another replacement."),
		)


def _context(name):
	if not set(frappe.get_roles()) & kitchen.MANAGERS:
		frappe.throw(_("A restaurant manager must approve a remake."), frappe.PermissionError)
	doc = kitchen._ticket(name, lock=True)
	session = frappe.get_doc("Restaurant Session", doc.restaurant_session, for_update=True)
	order = frappe.get_doc("Sales Order", doc.sales_order, for_update=True)
	return doc, session, order


def _expense(doc):
	account = frappe.get_cached_value(
		"POS Profile", doc.pos_profile, "vunapos_waste_expense_account"
	) or frappe.get_cached_value("Company", doc.company, "stock_adjustment_account")
	row = frappe.get_cached_doc("Account", account) if account else None
	if not row or row.company != doc.company or row.root_type != "Expense" or row.disabled or row.is_group:
		fail(
			"REMAKE_EXPENSE_REQUIRED",
			_(
				"Configure an enabled expense ledger in this company: the profile's Waste Expense Account or the Company's Stock Adjustment Account."
			),
		)
	return account


def _quote(doc, session, order):
	if doc.status == "Cancelled":
		fail(
			"REMAKE_TICKET_CANCELLED",
			_("Use the original ticket to request a new replacement for cancelled preparation."),
		)
	validate_visit(doc, session, order)
	states = progress.load([doc], for_update=True)[doc.name]
	lines = [
		{
			"line_id": row.line_id,
			"item_name": row.item_name,
			"uom": row.uom,
			"max_qty": progress.remaining(states[row.line_id], ACTION),
		}
		for row in doc.items
		if not row.parent_line_id
	]
	quote = {
		"ticket": doc.name,
		"lines": lines,
		"modified": str(doc.modified),
		"session_modified": str(session.modified),
		"order_modified": str(order.modified),
		"expense_account": _expense(doc),
	}
	quote["fingerprint"] = requests.fingerprint(quote)
	return quote


def preview(ticket):
	return _quote(*_context(ticket))


def _recipe(source, children, qty, base_bom=None):
	"""Keep the placed recipe; stock add-ons become extra recipe ingredients.

	Only customized replacements need a non-default native BOM snapshot. This
	avoids changing the restaurant's live recipe or Work Order editing settings.
	"""
	original = frappe.get_doc("Work Order", source.work_order, for_update=True)
	if original.docstatus != 1 or original.production_item != source.item_code:
		fail("REMAKE_PRODUCTION_CHANGED", _("Resolve the original Work Order before requesting a remake."))
	bom = frappe.get_doc("BOM", base_bom or original.bom_no)
	if bom.docstatus != 1 or not bom.is_active or bom.track_semi_finished_goods:
		fail(
			"REMAKE_RECIPE_REQUIRED",
			_("The original recipe must be active, submitted and use standard finished-goods manufacturing."),
		)
	addons = [row for row in children if frappe.get_cached_value("Item", row.item_code, "is_stock_item")]
	if not addons:
		return bom.name, original, bom.name
	copy = frappe.copy_doc(bom)
	copy.is_default = 0
	copy.quantity = qty * flt(source.conversion_factor)
	for row in copy.items:
		row.qty = flt(row.qty * copy.quantity / flt(bom.quantity), 6)
	for row in addons:
		extra = flt(row.stock_qty * qty / flt(source.qty), 6)
		existing = next((part for part in copy.items if part.item_code == row.item_code), None)
		if existing:
			existing.qty = flt(existing.qty + extra / flt(existing.conversion_factor or 1), 6)
		else:
			copy.append(
				"items",
				{
					"item_code": row.item_code,
					"uom": row.stock_uom,
					"qty": extra,
					"conversion_factor": 1,
					"include_item_in_manufacturing": 1,
				},
			)
	copy.insert(ignore_permissions=True)
	copy.flags.ignore_permissions = True
	copy.submit()
	return copy.name, original, bom.name


def _create_production(doc, selected):
	from vunapos.services.restaurant_stock_service import check_stock, validate_quantity_unit

	orders, snapshots, rows, bases = [], {}, [], {}
	previous = requests.parsed(doc.get("remake_context")) or {}
	for source in doc.items:
		if source.parent_line_id or source.line_id not in selected:
			continue
		qty = selected[source.line_id]
		children = [row for row in doc.items if row.parent_line_id == source.line_id]
		bom, original, base = _recipe(
			source, children, qty, base_bom=previous.get("base_boms", {}).get(source.line_id)
		)
		bases[source.line_id] = base
		wo = frappe.get_doc(
			{
				"doctype": "Work Order",
				"company": doc.company,
				"production_item": source.item_code,
				"bom_no": bom,
				"qty": flt(qty * source.conversion_factor, 6),
				"use_multi_level_bom": original.use_multi_level_bom,
				"source_warehouse": original.source_warehouse,
				"wip_warehouse": original.wip_warehouse,
				"fg_warehouse": original.fg_warehouse,
				"skip_transfer": original.skip_transfer,
				"from_wip_warehouse": original.from_wip_warehouse,
				"reserve_stock": 1,
				"project": original.project,
			}
		)
		wo.get_items_and_operations_from_bom()
		for material in wo.required_items:
			material.source_warehouse = original.source_warehouse
			validate_quantity_unit(
				flt(material.required_qty), material.stock_uom, material.item_code, source.item_name, bom
			)
		orders.append((wo, source, children))
	kitchen._lock_stock_bins([wo for wo, _source, _children in orders])
	demand = defaultdict(float)
	for wo, _source, _children in orders:
		for row in wo.required_items:
			demand[(row.item_code, row.source_warehouse)] += flt(row.required_qty)
	check_stock(frappe._dict(demand=demand), lock=True)
	for wo, source, children in orders:
		wo.insert(ignore_permissions=True)
		wo.flags.ignore_permissions = True
		wo.submit()
		wo.reload()
		if any(flt(row.stock_reserved_qty) + EPS < flt(row.required_qty) for row in wo.required_items):
			fail(
				"REMAKE_RESERVATION_INCOMPLETE",
				_("Not all replacement ingredients were reserved. Nothing was sent; review stock and retry."),
			)
		snapshots[wo.name] = {
			field: wo.get(field)
			for field in (
				"bom_no",
				"qty",
				"source_warehouse",
				"wip_warehouse",
				"fg_warehouse",
				"skip_transfer",
				"from_wip_warehouse",
				"use_multi_level_bom",
			)
		}
		for row in [source, *children]:
			data = {
				field: row.get(field)
				for field in (
					"sales_order_item",
					"line_id",
					"parent_line_id",
					"item_code",
					"item_name",
					"uom",
					"stock_uom",
					"conversion_factor",
					"note",
					"modifiers",
					"temporary_routing",
				)
			}
			data.update(
				qty=flt(row.qty * selected[source.line_id] / flt(source.qty), 6),
				stock_qty=flt(row.stock_qty * selected[source.line_id] / flt(source.qty), 6),
				work_order=wo.name if row == source else None,
			)
			validate_quantity_unit(data["qty"], data["uom"], row.item_code)
			rows.append(data)
	return rows, snapshots, bases


def request(ticket, quantities, request_key, fingerprint, reason, disposition):
	doc, session, order = _context(ticket)
	key = kitchen._request_key(request_key)
	if not isinstance(reason, str) or not reason.strip() or len(reason) > 500:
		fail("REMAKE_REASON_REQUIRED", _("Enter a remake reason of up to 500 characters."))
	if disposition not in ("Discard", "Keep for guest"):
		fail(
			"REMAKE_DISPOSITION_REQUIRED",
			_("Choose whether to discard the original food or keep it for this guest."),
		)
	payload = {
		"quantities": requests.parsed(quantities),
		"fingerprint": fingerprint,
		"reason": reason.strip(),
		"disposition": disposition,
	}
	stamp = requests.fingerprint(payload)
	if kitchen._replay(doc, ACTION, key, reason.strip(), stamp, quantified=True):
		return kitchen.ticket_detail(doc.name)
	quote = _quote(doc, session, order)
	if quote["fingerprint"] != fingerprint:
		fail(
			"REMAKE_REVIEW_CHANGED",
			_(
				"The visit or kitchen progress changed. Review the latest quantities before requesting a remake."
			),
		)
	states = progress.load([doc], for_update=True)[doc.name]
	if quantities is None:
		fail("REMAKE_QUANTITY_REQUIRED", _("Choose the dishes and quantities to remake."))
	selected = progress.selection(doc, ACTION, quantities, states)
	rows, work_orders, bases = _create_production(doc, selected)
	context = {
		"request_key": key,
		"work_orders": work_orders,
		"base_boms": bases,
		"expense_account": quote["expense_account"],
		"approved_by": frappe.session.user,
		"cost_center": frappe.get_cached_value("POS Profile", doc.pos_profile, "cost_center")
		or frappe.get_cached_value("Company", doc.company, "cost_center"),
	}
	fields = {
		field: doc.get(field)
		for field in (
			"kitchen_station",
			"station_label",
			"restaurant",
			"branch",
			"company",
			"restaurant_session",
			"sales_order",
			"pos_profile",
			"service_type",
			"table_labels",
			"waiter",
			"order_note",
		)
	}
	fields["waiter"] = session.waiter
	fields["table_labels"] = ", ".join(
		frappe.get_cached_value("Restaurant Table", row.table, "table_label") or row.table
		for row in session.tables
		if not row.released_at
	)
	replacement = frappe.get_doc(
		{
			"doctype": TICKET,
			**fields,
			"items": rows,
			"status": "Sent",
			"sent_by": frappe.session.user,
			"sent_at": now_datetime(),
			"remake_of": doc.name,
			"remake_reason": reason.strip(),
			"original_disposition": disposition,
			"remake_context": context,
			"event_key": requests.fingerprint(["remake", doc.name, key]),
		}
	)
	old = frappe.flags.get("vunapos_generating_kot")
	old_remake = frappe.flags.get("vunapos_generating_remake")
	try:
		frappe.flags.vunapos_generating_kot = True
		frappe.flags.vunapos_generating_remake = doc.name
		replacement.insert(ignore_permissions=True)
		replacement.flags.ignore_permissions = True
		replacement.submit()
	finally:
		frappe.flags.vunapos_generating_kot = old
		frappe.flags.vunapos_generating_remake = old_remake
	baseline = {
		row.line_id: {field: states[row.line_id][field] for field in progress.FIELDS.values()}
		for row in doc.items
		if not row.parent_line_id
	}
	retired = {line: min(qty, progress.remaining(states[line], "Serve")) for line, qty in selected.items()}
	previous = doc.status
	for line, qty in selected.items():
		states[line]["remade_qty"] += qty
		states[line]["retired_qty"] += retired[line]
	doc.db_set("status", progress.status_for(doc.items, states))
	kitchen._record(
		doc,
		ACTION,
		key,
		previous,
		reason=reason.strip(),
		approved_by=frappe.session.user,
		quantities={
			"deltas": selected,
			"retired": retired,
			"before": baseline,
			"disposition": disposition,
			"replacement_ticket": replacement.name,
		},
		request_fingerprint=stamp,
	)
	kitchen._publish(doc)
	kitchen._publish(replacement)
	publish_ticket_created(replacement)
	return kitchen.ticket_detail(doc.name)


def validate_replacement_ticket(doc):
	context = requests.parsed(doc.remake_context) or {}
	if (
		frappe.flags.get("vunapos_generating_remake") != doc.remake_of
		or not context.get("request_key")
		or not context.get("work_orders")
		or not context.get("approved_by")
	):
		fail(
			"INVALID_REMAKE_TICKET",
			_("Replacement preparation must be created through the approved remake action."),
		)
	return requests.fingerprint(["remake", doc.remake_of, context["request_key"]])


def validate_work_order(doc, row, wo):
	context = requests.parsed(doc.remake_context) or {}
	expected = context.get("work_orders", {}).get(wo.name)
	if (
		not expected
		or wo.docstatus != 1
		or wo.status in ("Closed", "Stopped")
		or wo.sales_order
		or wo.sales_order_item
		or wo.production_item != row.item_code
		or wo.company != doc.company
		or any(wo.get(field) != value for field, value in expected.items())
	):
		fail(
			"REMAKE_PRODUCTION_CHANGED",
			_(
				"Replacement Work Order {0} changed. Review its recipe, warehouses and quantities before preparing it."
			).format(wo.name),
		)


def _tracking(doc, wo, qty):
	"""Select only this WO's actual output; never FIFO another order's batch."""
	produced, used = defaultdict(float), defaultdict(float)
	for name in frappe.get_all(
		"Stock Entry",
		filters={"work_order": wo.name, "purpose": "Manufacture", "docstatus": 1},
		pluck="name",
		order_by="creation, name",
	):
		entry = frappe.get_doc("Stock Entry", name, for_update=True)
		for row in entry.items:
			if (
				row.item_code != wo.production_item
				or row.t_warehouse != wo.fg_warehouse
				or not row.is_finished_item
			):
				continue
			if row.serial_and_batch_bundle:
				bundle = frappe.get_doc("Serial and Batch Bundle", row.serial_and_batch_bundle)
				for part in bundle.entries:
					produced[(part.serial_no, part.batch_no)] += abs(flt(part.qty))
			else:
				produced[(None, row.batch_no)] += flt(row.transfer_qty)
	for name in frappe.get_all(
		"Stock Entry",
		filters={"vunapos_remake_ticket": doc.name, "vunapos_remake_work_order": wo.name},
		pluck="name",
		order_by="name",
	):
		entry = frappe.get_doc("Stock Entry", name, for_update=True)
		if entry.docstatus != 1:
			fail(
				"REMAKE_STOCK_REVIEW_REQUIRED",
				_(
					"A replacement stock issue was cancelled or changed. Reconcile its stock before continuing."
				),
			)
		for row in entry.items:
			if row.serial_and_batch_bundle:
				for part in frappe.get_doc("Serial and Batch Bundle", row.serial_and_batch_bundle).entries:
					used[(part.serial_no, part.batch_no)] += abs(flt(part.qty))
			else:
				used[(None, row.batch_no)] += flt(row.transfer_qty)
	left = flt(qty - sum(used.values()), 6)
	result = []
	for (serial, batch), produced_qty in produced.items():
		pick = min(left, max(0, produced_qty - used[(serial, batch)]))
		if pick > EPS:
			result.append({"serial_no": serial, "batch_no": batch, "qty": pick})
			left = flt(left - pick, 6)
	if left > EPS:
		fail(
			"REMAKE_OUTPUT_REQUIRED",
			_(
				"The replacement's own finished stock is not fully produced. Complete its native production first."
			),
		)
	return result


def issue_replacement_output(doc, targets, work_orders, manufacture_entry=None):
	context = requests.parsed(doc.remake_context)
	by_work = {row.work_order: row for row in doc.items if not row.parent_line_id}
	entries = []
	for wo in work_orders:
		row = by_work[wo.name]
		selection = _tracking(doc, wo, flt(targets[row.line_id] * row.conversion_factor, 6))
		if not selection:
			continue
		entry = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"purpose": "Material Issue",
				"company": doc.company,
				"vunapos_remake_ticket": doc.name,
				"vunapos_remake_work_order": wo.name,
				"vunapos_remake_manufacture_entry": manufacture_entry,
				"remarks": _("Replacement for {0}; source order {1}. No additional customer charge.").format(
					doc.remake_of, doc.sales_order
				),
				"items": [
					{
						"item_code": row.item_code,
						"s_warehouse": wo.fg_warehouse,
						"qty": part["qty"],
						"uom": row.stock_uom,
						"stock_uom": row.stock_uom,
						"conversion_factor": 1,
						"expense_account": context["expense_account"],
						"cost_center": context.get("cost_center"),
						"use_serial_batch_fields": 1,
						"serial_no": part["serial_no"],
						"batch_no": part["batch_no"],
					}
					for part in selection
				],
			}
		)
		entry.flags.vunapos_remake_issue = doc.name
		entry.set_stock_entry_type()
		entry.insert(ignore_permissions=True)
		entry.flags.ignore_permissions = True
		entry.submit()
		entries.append(entry.name)
	return entries


def cancel(ticket, request_key, expected_status, expected_modified, reason):
	doc, _session, _order = _context(ticket)
	key = kitchen._request_key(request_key)
	if not isinstance(reason, str) or not reason.strip() or len(reason) > 500:
		fail("REMAKE_REASON_REQUIRED", _("Enter a cancellation reason of up to 500 characters."))
	stamp = requests.fingerprint(
		{"expected_status": expected_status, "expected_modified": expected_modified, "reason": reason.strip()}
	)
	if kitchen._replay(doc, "Cancel Remake", key, reason.strip(), stamp):
		return kitchen.ticket_detail(doc.name)
	if not doc.remake_of or doc.status == "Cancelled":
		fail("REMAKE_CANCELLATION_REQUIRED", _("Only an unfinished replacement can be cancelled here."))
	if (
		not expected_modified
		or doc.status != expected_status
		or get_datetime(doc.modified) != get_datetime(expected_modified)
	):
		fail("KITCHEN_STALE_STATE", _("The replacement changed. Refresh before cancelling it."))
	if frappe.db.exists(TICKET, {"remake_of": doc.name, "docstatus": 1, "status": ["!=", "Cancelled"]}):
		fail("REMAKE_HAS_REPLACEMENTS", _("Resolve this ticket's own replacements before cancelling it."))
	orders = kitchen._work_orders(doc)
	for wo in orders:
		if (
			flt(wo.produced_qty)
			or flt(wo.material_transferred_for_manufacturing)
			or frappe.db.exists("Stock Entry", {"work_order": wo.name, "docstatus": 1})
			or frappe.db.exists("Stock Entry", {"vunapos_remake_work_order": wo.name, "docstatus": 1})
		):
			fail(
				"REMAKE_REVERSAL_REQUIRED",
				_(
					"This replacement has stock movements. Reverse them explicitly in ERPNext before cancelling; no production is silently undone."
				),
			)
	for wo in orders:
		wo.flags.ignore_permissions = True
		wo.ignore_linked_doctypes = ["Kitchen Order Ticket Item"]
		wo.cancel()
	source = kitchen._ticket(doc.remake_of, lock=True)
	states = progress.load([source], for_update=True)[source.name]
	selected = {row.line_id: flt(row.qty) for row in doc.items if not row.parent_line_id}
	baseline = {
		row.line_id: {field: states[row.line_id][field] for field in progress.FIELDS.values()}
		for row in source.items
		if not row.parent_line_id
	}
	for line, qty in selected.items():
		if states[line]["remade_qty"] + EPS < qty:
			fail("KITCHEN_PROGRESS_INVALID", _("The source replacement history needs review."))
		states[line]["remade_qty"] = flt(states[line]["remade_qty"] - qty, 6)
	previous = source.status
	source.db_set("status", progress.status_for(source.items, states))
	kitchen._record(
		source,
		"Cancel Remake",
		key,
		previous,
		claim=False,
		reason=reason.strip(),
		approved_by=frappe.session.user,
		quantities={"deltas": selected, "before": baseline, "replacement_ticket": doc.name},
	)
	previous = doc.status
	doc.db_set("status", "Cancelled")
	kitchen._record(
		doc,
		"Cancel Remake",
		key,
		previous,
		reason=reason.strip(),
		approved_by=frappe.session.user,
		quantities={"deltas": {}},
		request_fingerprint=stamp,
	)
	kitchen._publish(source)
	kitchen._publish(doc)
	return kitchen.ticket_detail(doc.name)


def protect_issue(doc, method=None):
	if not doc.get("vunapos_remake_ticket") and not doc.get("vunapos_remake_work_order"):
		return
	if doc.flags.get("vunapos_remake_issue") != doc.vunapos_remake_ticket:
		if method == "before_cancel" and set(frappe.get_roles()) & kitchen.MANAGERS:
			kitchen._ticket(doc.vunapos_remake_ticket, lock=True)
			return
		fail(
			"REMAKE_CONTROLLED_STOCK",
			_(
				"Replacement stock issues are managed by kitchen preparation. Reconcile the ticket before changing or reversing its stock."
			),
		)


def validate_output_balance(doc):
	if not doc.get("remake_of") or doc.status == "Cancelled":
		return
	states = progress.load([doc], for_update=True)[doc.name]
	for row in doc.items:
		if row.parent_line_id:
			continue
		target = flt(states[row.line_id]["ready_qty"] * row.conversion_factor, 6)
		issues = frappe.qb.get_query(
			"Stock Entry",
			filters={"vunapos_remake_ticket": doc.name, "vunapos_remake_work_order": row.work_order},
			fields=["name", "docstatus"],
			for_update=True,
		).run(as_dict=True)
		if any(entry.docstatus != 1 for entry in issues):
			fail(
				"REMAKE_STOCK_REVIEW_REQUIRED",
				_(
					"Replacement stock was reversed. Finish the explicit stock reversal and cancel this replacement before billing or serving it."
				),
			)
		issued = sum(
			flt(item.transfer_qty)
			for entry in issues
			for item in frappe.get_doc("Stock Entry", entry.name).items
		)
		if issued + EPS < target:
			fail(
				"REMAKE_OUTPUT_REQUIRED",
				_(
					"The prepared replacement has no matching stock issue. Reconcile its production before billing or serving."
				),
			)


def _production_ticket(entry):
	if (
		entry.purpose
		not in ("Manufacture", "Material Transfer for Manufacture", "Material Consumption for Manufacture")
		or not entry.work_order
	):
		return None
	if not frappe.db.has_column(TICKET, "remake_of"):
		return None
	item = frappe.qb.DocType("Kitchen Order Ticket Item")
	ticket = frappe.qb.DocType(TICKET)
	names = (
		frappe.qb.from_(item)
		.join(ticket)
		.on(item.parent == ticket.name)
		.select(ticket.name)
		.where(
			(item.work_order == entry.work_order)
			& (ticket.docstatus == 1)
			& ticket.remake_of.isnotnull()
			& (ticket.remake_of != "")
		)
		.run(pluck=True)
	)
	if not names:
		return None
	return kitchen._ticket(names[0], lock=True)


def lock_native_production(entry, method=None):
	# before_insert must precede native naming-series locks as well as stock
	# updates. before_validate alone is too late: Desk could own the naming
	# series while KDS owns the visit, with each waiting for the other's lock.
	doc = _production_ticket(entry)
	if doc:
		kitchen._order(doc)
		orders = kitchen._work_orders(doc)
		kitchen._lock_stock_bins(orders)
		if entry.purpose == "Manufacture" and not entry.is_return:
			wo = next(wo for wo in orders if wo.name == entry.work_order)
			if flt(wo.produced_qty) + flt(entry.fg_completed_qty) > flt(wo.qty) + EPS:
				fail(
					"REMAKE_PRODUCTION_EXCEEDED",
					_(
						"This would produce more than the approved replacement quantity. Review its existing production instead."
					),
				)


def consume_native_output(entry, method=None):
	if entry.purpose != "Manufacture" or entry.is_return:
		return
	doc = _production_ticket(entry)
	if not doc:
		return
	wo = frappe.get_doc("Work Order", entry.work_order, for_update=True)
	row = next(row for row in doc.items if row.work_order == wo.name)
	validate_work_order(doc, row, wo)
	issue_replacement_output(
		doc,
		{row.line_id: flt(wo.produced_qty) / flt(row.conversion_factor)},
		[wo],
		manufacture_entry=entry.name,
	)
