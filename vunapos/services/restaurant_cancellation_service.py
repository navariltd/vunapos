"""Quantity reductions for placed, unbilled restaurant rounds.

Lock visit -> order -> tickets -> Work Orders -> bins. KOTs remain original
snapshots; immutable cancellation deltas explain their reduced demand.
"""

from collections import defaultdict
from types import SimpleNamespace

import frappe
from frappe import _
from frappe.utils import cint, flt

from vunapos.dto.restaurant import line_id as order_line_id
from vunapos.services import kitchen_lifecycle_service as kitchen
from vunapos.services import kitchen_progress_service as progress
from vunapos.services import restaurant_request_service as receipts
from vunapos.services.kitchen_service import fail
from vunapos.services.restaurant_session_service import _load

ACTION = "Cancel Items"
EPS = progress.EPSILON


def _context(order_name):
	initial = frappe.get_doc("Sales Order", order_name)
	initial.check_permission("read")
	if not initial.get("vunapos_restaurant_session"):
		fail("RESTAURANT_ORDER_REQUIRED", _("Choose a placed restaurant order."))
	session = _load(initial.vunapos_restaurant_session, for_update=True)
	order = frappe.get_doc("Sales Order", order_name, for_update=True)
	order.check_permission("write")
	if not kitchen.can_cancel():
		frappe.throw(_("Your restaurant role cannot cancel order items."), frappe.PermissionError)
	if (order.company, order.vunapos_restaurant, order.vunapos_branch) != (
		session.company,
		session.restaurant,
		session.branch,
	):
		fail("KITCHEN_CONTEXT_MISMATCH", _("The order does not belong to this Restaurant and Branch."))
	return session, order


def _open(session, order):
	from frappe.model.workflow import get_workflow_name

	from vunapos.services.restaurant_payment_service import guard_order_change

	guard_order_change(session)

	if (
		session.status != "Open"
		or session.billing_invoice
		or order.docstatus != 1
		or order.status == "Closed"
		or flt(order.per_billed)
		or flt(order.advance_paid)
		or order.get("vunapos_billing_invoice")
	):
		fail("ORDER_NOT_EDITABLE", _("Only an open, unbilled restaurant order can have items cancelled."))
	for doctype in ("Sales Invoice Item", "POS Invoice Item", "Delivery Note Item"):
		if frappe.db.exists(
			doctype,
			{
				"sales_order" if doctype != "Delivery Note Item" else "against_sales_order": order.name,
				"docstatus": ["<", 2],
			},
		):
			fail(
				"ORDER_HAS_DOWNSTREAM_DOCUMENT",
				_(
					"This order already has an invoice or delivery document. Review it before cancelling quantities."
				),
			)
	if frappe.db.table_exists("KE Payment Request"):
		requests = frappe.get_all(
			"KE Payment Request", filters={"account_reference": order.name}, pluck="name"
		)
		if requests and frappe.db.exists(
			"VunaPOS Gateway Payment Link",
			{
				"source_doctype": "KE Payment Request",
				"source_name": ["in", requests],
				"status": ["in", ["Pending", "Draft", "Authorized", "Paid"]],
			},
		):
			fail(
				"CANCELLATION_PAYMENT_REVIEW_REQUIRED",
				_(
					"This order has a pending or received payment. Review the payment before changing quantities; cancellation does not refund money."
				),
			)
	workflow_name = get_workflow_name("Sales Order")
	if workflow_name:
		workflow = frappe.get_doc("Workflow", workflow_name)
		state = order.get(workflow.workflow_state_field)
		if not any(
			row.state == state and (not row.allow_edit or row.allow_edit in frappe.get_roles())
			for row in workflow.states
		):
			frappe.throw(
				_("The Sales Order workflow does not allow you to change this order in its current state."),
				frappe.PermissionError,
			)


def _state(order):
	tickets = [
		kitchen._ticket(name, lock=True)
		for name in frappe.get_all(
			"Kitchen Order Ticket",
			filters={"sales_order": order.name, "docstatus": 1, "remake_of": ["is", "not set"]},
			pluck="name",
			order_by="name",
		)
	]
	work_orders = {
		name: frappe.get_doc("Work Order", name, for_update=True)
		for name in frappe.get_all(
			"Work Order",
			filters={"sales_order": order.name, "docstatus": ["!=", 2]},
			pluck="name",
			order_by="name",
		)
	}
	return tickets, work_orders, progress.load(tickets, for_update=True)


def _quote(order, tickets, work_orders, histories):
	from vunapos.services.restaurant_stop_service import charge_lines

	protected_fees = charge_lines(order.name) if not set(frappe.get_roles()) & kitchen.MANAGERS else set()
	by_source = {
		row.sales_order_item: (doc, row) for doc in tickets for row in doc.items if not row.parent_line_id
	}
	by_work = defaultdict(list)
	for wo in work_orders.values():
		by_work[wo.sales_order_item].append(wo)
	rows = {row.name: row for row in order.items}

	def maximum(row):
		if row.get("vunapos_line_id") in protected_fees:
			return 0.0
		if any(packed.parent_detail_docname == row.name for packed in order.get("packed_items", [])):
			return 0.0
		if flt(row.delivered_qty) or flt(row.billed_amt) or flt(row.ordered_qty):
			return 0.0
		floor = 0.0
		for wo in by_work[row.name]:
			if (
				wo.docstatus != 1
				or wo.status in ("Closed", "Stopped")
				or wo.operations
				or wo.production_plan
				or wo.track_semi_finished_goods
				or wo.subcontracting_inward_order
				or flt(wo.process_loss_qty)
				or (
					flt(wo.material_transferred_for_manufacturing)
					and any(
						frappe.get_cached_value("Item", material.item_code, field)
						for material in wo.required_items
						for field in ("has_batch_no", "has_serial_no")
					)
				)
			):
				return 0.0
			floor += max(
				flt(wo.produced_qty) + flt(wo.process_loss_qty),
				flt(wo.material_transferred_for_manufacturing),
			) / flt(row.conversion_factor or 1)
		available = max(0, flt(row.qty) - floor)
		if row.name in by_source:
			doc, snapshot = by_source[row.name]
			available = min(available, progress.remaining(histories[doc.name][snapshot.line_id], ACTION))
		return flt(available, 6)

	lines = []
	for row in order.items:
		if row.get("vunapos_parent_line_id"):
			continue
		qty = maximum(row)
		for addon in order.items:
			if addon.get("vunapos_parent_line_id") == order_line_id(row):
				qty = min(qty, maximum(addon) * flt(row.qty) / flt(addon.qty))
		lines.append(
			{
				"line_id": order_line_id(row),
				"item_name": row.item_name,
				"qty": flt(row.qty),
				"uom": row.uom,
				"max_cancel_qty": flt(qty, 6),
			}
		)
	require_pin = cint(
		frappe.get_cached_value(
			"POS Profile", order.vunapos_pos_profile, "vunapos_require_manager_pin_order_cancel"
		)
	)
	stamp = receipts.fingerprint(
		{
			"order": str(order.modified),
			"cancel_policy": require_pin,
			"items": [(row.name, row.qty) for row in rows.values()],
			"tickets": [(doc.name, str(doc.modified)) for doc in tickets],
			"production": [
				(wo.name, str(wo.modified), wo.produced_qty, wo.material_transferred_for_manufacturing)
				for wo in work_orders.values()
			],
		}
	)
	return {
		"order": order.name,
		"fingerprint": stamp,
		"lines": lines,
		"requires_manager_pin": bool(require_pin and not set(frappe.get_roles()) & kitchen.MANAGERS),
		"pos_profile": order.vunapos_pos_profile,
	}


def preview(order_name):
	session, order = _context(order_name)
	_open(session, order)
	tickets, work_orders, histories = _state(order)
	return _quote(order, tickets, work_orders, histories)


def _trim_reservations(voucher_type, voucher_no, targets, source_warehouses=None):
	"""Reduce only unused reservation quantities; retain consumed/batch history."""
	groups = defaultdict(list)
	for name in frappe.get_all(
		"Stock Reservation Entry",
		filters={"voucher_type": voucher_type, "voucher_no": voucher_no, "docstatus": 1},
		pluck="name",
		order_by="name",
	):
		doc = frappe.get_doc("Stock Reservation Entry", name, for_update=True)
		if source_warehouses and doc.warehouse != source_warehouses.get(doc.voucher_detail_no):
			continue
		if doc.voucher_detail_no in targets:
			groups[doc.voucher_detail_no].append(doc)
	for detail, entries in groups.items():
		target = flt(targets[detail], 6)
		used = sum(
			flt(doc.consumed_qty) + flt(doc.transferred_qty) + flt(doc.delivered_qty) for doc in entries
		)
		if target + EPS < used:
			fail(
				"CANCELLATION_STOCK_USED",
				_(
					"Some of this quantity has already been consumed, transferred or delivered. Review its stock movements first."
				),
			)
		left = max(0, target - used)
		for doc in entries:
			used_here = flt(doc.consumed_qty) + flt(doc.transferred_qty) + flt(doc.delivered_qty)
			keep = min(max(0, flt(doc.reserved_qty) - used_here), left)
			left -= keep
			new_qty = flt(used_here + keep, 6)
			if abs(new_qty - flt(doc.reserved_qty)) <= EPS:
				continue
			doc.flags.ignore_permissions = True
			if new_qty <= EPS:
				doc.cancel()
				continue
			if doc.reservation_based_on == "Serial and Batch":
				remove = flt(doc.reserved_qty) - new_qty
				for entry in reversed(doc.sb_entries):
					delta = min(remove, max(0, flt(entry.qty) - flt(entry.delivered_qty)))
					entry.qty = flt(entry.qty - delta, 6)
					remove -= delta
				if remove > EPS:
					fail(
						"CANCELLATION_STOCK_USED",
						_("The selected batches or serial numbers have already been used."),
					)
				doc.set("sb_entries", [row for row in doc.sb_entries if flt(row.qty) > EPS])
			doc.reserved_qty, doc.voucher_qty = new_qty, target
			if (
				voucher_type == "Work Order"
				and flt(doc.transferred_qty)
				and not (doc.has_batch_no or doc.has_serial_no)
			):
				# Transferred stock is also counted by its WIP reservation.
				# ERPNext's generic edit validation compares this historical
				# source total with remaining demand and rejects an unused release.
				# The locked release above preserves all usage; native recounts
				# update the voucher and bin without creating a stock movement.
				doc.validate_uom_is_integer()
				doc.db_set({"reserved_qty": new_qty, "voucher_qty": target})
				doc.update_reserved_qty_in_voucher()
				doc.update_status()
				doc.update_reserved_stock_in_bin()
				continue
			doc.flags.ignore_validate_update_after_submit = True
			doc.save(ignore_permissions=True)


def _reduce_production(wo, stock_qty):
	if stock_qty <= EPS:
		wo.flags.ignore_permissions = True
		wo.ignore_linked_doctypes = ["Kitchen Order Ticket Item"]
		wo.cancel()
		return
	if stock_qty + EPS < max(
		flt(wo.produced_qty) + flt(wo.process_loss_qty), flt(wo.material_transferred_for_manufacturing)
	):
		fail(
			"CANCELLATION_STOCK_USED",
			_(
				"Already produced or transferred quantities cannot be cancelled. Reverse stock explicitly before trying again."
			),
		)
	wo.qty = stock_qty
	wo.set_required_items(reset_only_qty=True)
	wo.flags.ignore_validate_update_after_submit = True
	wo.save(ignore_permissions=True)
	_trim_reservations(
		"Work Order",
		wo.name,
		{row.name: flt(row.required_qty) for row in wo.required_items},
		{row.name: row.source_warehouse for row in wo.required_items},
	)
	wo.reload()
	wo.update_work_order_qty_in_sales_orders()
	wo.update_planned_qty()
	wo.update_ordered_qty()
	wo.update_reserved_qty_for_production()


def cancel(order_name, quantities, request_key, fingerprint, reason, manager_pin_token=None):
	from vunapos.dto.restaurant import order_to_dict
	from vunapos.services.pin_service import consume_pin_token, validate_pin_token

	session, order = _context(order_name)
	key = receipts.request_key(request_key)
	if not isinstance(reason, str) or not reason.strip() or len(reason) > 500:
		fail("CANCEL_REASON_REQUIRED", _("Enter a cancellation reason of up to 500 characters."))
	reason = reason.strip()
	values = receipts.parsed(quantities)
	payload = {"order": order.name, "quantities": values, "fingerprint": fingerprint, "reason": reason}
	if receipts.replay(ACTION, key, order.vunapos_pos_profile, payload):
		return order_to_dict(order)
	_open(session, order)
	tickets, work_orders, histories = _state(order)
	quote = _quote(order, tickets, work_orders, histories)
	if not fingerprint or quote["fingerprint"] != fingerprint:
		fail(
			"CANCELLATION_CHANGED",
			_("The order or kitchen progress changed. Review the quantities again before cancelling."),
		)
	if not isinstance(values, dict) or not values:
		fail("INVALID_KITCHEN_QUANTITIES", _("Choose at least one item and quantity to cancel."))
	by_line = {order_line_id(row): row for row in order.items if not row.get("vunapos_parent_line_id")}
	limits = {row["line_id"]: row["max_cancel_qty"] for row in quote["lines"]}
	selected = {}
	for line_id, value in values.items():
		if line_id not in by_line:
			fail(
				"INVALID_KITCHEN_LINE",
				_("Choose a main dish on this order. Add-ons follow their parent dish."),
			)
		# Reuse the same finite/precision/UOM checks as preparation commands.
		row = by_line[line_id]
		fake = frappe._dict(line_id=line_id, item_name=row.item_name, uom=row.uom)
		selected.update(
			progress.selection(
				SimpleNamespace(items=[fake]),
				ACTION,
				{line_id: value},
				{line_id: {"qty": limits[line_id], "cancelled_qty": 0, "ready_qty": 0}},
			)
		)
	approved = frappe.session.user if set(frappe.get_roles()) & kitchen.MANAGERS else None
	profile = frappe.get_doc("POS Profile", order.vunapos_pos_profile)
	if quote["requires_manager_pin"]:
		approved = validate_pin_token(manager_pin_token, profile, "manager_order_cancel").get("subject")
	changes = {}
	for line_id, qty in selected.items():
		parent = by_line[line_id]
		changes[parent.name] = flt(parent.qty - qty, 6)
		for row in order.items:
			if row.get("vunapos_parent_line_id") == line_id:
				new_qty = flt(row.qty * changes[parent.name] / flt(parent.qty), 6)
				if (
					frappe.get_cached_value("UOM", row.uom, "must_be_whole_number")
					and abs(new_qty - round(new_qty)) > EPS
				):
					fail(
						"INVALID_KITCHEN_QUANTITIES",
						_(
							"This cancellation would leave a fractional add-on quantity. Choose a whole combination."
						),
					)
				changes[row.name] = new_qty
	before = frappe.parse_json(frappe.as_json([row.as_dict() for row in order.items]))
	kitchen._lock_stock_bins(work_orders.values(), order)
	for wo in work_orders.values():
		if wo.sales_order_item in changes:
			source = next(row for row in order.items if row.name == wo.sales_order_item)
			_reduce_production(wo, flt(changes[source.name] * source.conversion_factor, 6))
	_trim_reservations(
		"Sales Order",
		order.name,
		{
			row.name: flt(changes[row.name] * row.conversion_factor, 6)
			for row in order.items
			if row.name in changes
		},
	)
	order.reload()
	remaining = [row for row in order.items if row.name not in changes or changes[row.name] > EPS]
	old_flag = frappe.flags.get("vunapos_cancelling_restaurant_items")
	old_cancel = frappe.flags.get("vunapos_cancelling_kitchen_order")
	old_adjustment = frappe.flags.get("vunapos_restaurant_charge_adjustment")
	try:
		if not remaining:
			frappe.flags.vunapos_cancelling_kitchen_order = order.name
			order.update(
				{
					"vunapos_cancel_reason": reason,
					"vunapos_cancel_approved_by": approved,
					"vunapos_cancelled_by": frappe.session.user,
					"vunapos_cancelled_at": frappe.utils.now_datetime(),
				}
			)
			order.flags.ignore_permissions = True
			order.cancel()
		else:
			for row in remaining:
				if row.name in changes:
					row.qty = changes[row.name]
			order.set("items", remaining)
			from vunapos.services.restaurant_rejection_service import reapply_waivers

			frappe.flags.vunapos_restaurant_charge_adjustment = reapply_waivers(order)
			order.flags.ignore_validate_update_after_submit = True
			order.ignore_pricing_rule = 1
			frappe.flags.vunapos_cancelling_restaurant_items = order.name
			order.set_qty_as_per_stock_uom()
			from erpnext.stock.doctype.packed_item.packed_item import make_packing_list

			make_packing_list(order)
			order.calculate_taxes_and_totals()
			order.set_total_in_words()
			order.set_payment_schedule()
			order.save()
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
		frappe.flags.vunapos_cancelling_restaurant_items = old_flag
		frappe.flags.vunapos_cancelling_kitchen_order = old_cancel
		frappe.flags.vunapos_restaurant_charge_adjustment = old_adjustment
	for ticket in tickets:
		deltas = {
			line: qty for line, qty in selected.items() if any(row.line_id == line for row in ticket.items)
		}
		if not deltas:
			continue
		baseline = {
			row.line_id: {
				field: histories[ticket.name][row.line_id][field] for field in progress.FIELDS.values()
			}
			for row in ticket.items
			if not row.parent_line_id
		}
		events = [{"action": ACTION, "item_quantities": {"deltas": deltas, "before": baseline}}]
		# Apply the delta against today's counters to derive the aggregate status.
		for line, qty in deltas.items():
			row = histories[ticket.name][line]
			row["cancelled_qty"] = flt(row.get("cancelled_qty", 0) + qty, 6)
			for field in ("accepted_qty", "started_qty"):
				row[field] = min(row[field], row["qty"] - row["cancelled_qty"])
		previous = ticket.status
		ticket.db_set("status", progress.status_for(ticket.items, histories[ticket.name]))
		kitchen._record(
			ticket,
			ACTION,
			"cancel-items-" + receipts.receipt_name(ACTION, key),
			previous,
			reason=reason,
			approved_by=approved,
			quantities=events[0]["item_quantities"],
			claim=False,
		)
		kitchen._publish(ticket)
	receipts.record(
		ACTION,
		key,
		order.vunapos_pos_profile,
		payload,
		"Sales Order",
		order.name,
		details={"reason": reason, "approved_by": approved, "quantities": selected, "before": before},
	)
	if quote["requires_manager_pin"]:
		consume_pin_token(manager_pin_token, profile, "manager_order_cancel")
	order.reload()
	return order_to_dict(order)
