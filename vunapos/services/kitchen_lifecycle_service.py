"""Controlled KDS commands; payload snapshots stay immutable and effects are atomic.

No client may supply stock-entry quantities, warehouses or arbitrary Work Orders.
Failed commands roll back their savepoint, then append a failure audit for retry.
"""

import hashlib
import json
from uuid import uuid4

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime, strip_html

from vunapos.services.kitchen_service import STATION, TICKET, fail
from vunapos.services.restaurant_service import require_restaurant_access
from vunapos.setup.utils import CASHIER_ROLE, KITCHEN_ROLE, RESTAURANT_MANAGER_ROLE, WAITER_ROLE

ACTION = "Kitchen Ticket Action"
TRANSITIONS = {
	"Accept": ("Sent", "Accepted"),
	"Start": ("Accepted", "Preparing"),
	"Ready": ("Preparing", "Ready"),
	"Serve": ("Ready", "Served"),
}
MANAGERS = {"System Manager", RESTAURANT_MANAGER_ROLE}


def capabilities(status):
	roles = set(frappe.get_roles())
	result = []
	for action, (source, _target) in TRANSITIONS.items():
		allowed = MANAGERS | ({WAITER_ROLE, CASHIER_ROLE} if action == "Serve" else {KITCHEN_ROLE})
		if status == source and roles & allowed:
			result.append(action)
	return result


def can_cancel():
	return bool(set(frappe.get_roles()) & (MANAGERS | {WAITER_ROLE, CASHIER_ROLE}))


def _ticket(name, lock=False):
	doc = frappe.get_doc(TICKET, name)
	require_restaurant_access(doc.restaurant, branch=doc.branch)
	doc.check_permission("read")
	frappe.get_doc(STATION, doc.kitchen_station).check_permission("read")
	if lock:
		# All commands lock session -> order -> tickets -> Work Orders.
		frappe.db.get_value("Restaurant Session", doc.restaurant_session, "name", for_update=True)
		frappe.db.get_value("Sales Order", doc.sales_order, "name", for_update=True)
		doc = frappe.get_doc(TICKET, name, for_update=True)
	return doc


def _order(doc, serving=False):
	order = frappe.get_doc("Sales Order", doc.sales_order)
	session = frappe.get_doc("Restaurant Session", doc.restaurant_session)
	if (
		doc.docstatus != 1
		or order.docstatus != 1
		or order.status == "Closed"
		or session.status not in (("Open", "Settling", "Settled") if serving else ("Open",))
		or (flt(order.per_billed) > 0 and not serving)
	):
		fail("KITCHEN_ORDER_NOT_OPEN", _("Preparation actions require an open, unbilled restaurant order."))
	if (
		order.get("vunapos_restaurant_session") != session.name
		or order.company != doc.company
		or session.restaurant != doc.restaurant
	):
		fail("KITCHEN_CONTEXT_MISMATCH", _("The preparation ticket does not match its restaurant order."))
	return order


def _request_key(key):
	if not isinstance(key, str) or not key.strip() or len(key) > 140:
		fail("IDEMPOTENCY_REQUIRED", _("A request key of up to 140 characters is required."))
	return key.strip()


def _replay(doc, action, key, reason=None):
	existing = frappe.get_all(
		ACTION,
		filters={"request_key": key, "outcome": "Succeeded"},
		fields=["kitchen_ticket", "sales_order", "action", "actor", "reason"],
	)
	if not existing:
		return False
	for row in existing:
		if (
			row.action != action
			or row.actor != frappe.session.user
			or row.sales_order != doc.sales_order
			or (action != "Cancel Order" and row.kitchen_ticket != doc.name)
			or (row.reason or "") != (reason or "")
		):
			fail("IDEMPOTENCY_CONFLICT", _("This kitchen request key belongs to a different action."))
	return True


def _record(
	doc,
	action,
	key,
	previous,
	outcome="Succeeded",
	entries=None,
	reason=None,
	approved_by=None,
	error=None,
	claim=True,
):
	old = frappe.flags.get("vunapos_recording_kitchen_action")
	try:
		frappe.flags.vunapos_recording_kitchen_action = True
		frappe.get_doc(
			{
				"doctype": ACTION,
				"kitchen_ticket": doc.name,
				"kitchen_station": doc.kitchen_station,
				"restaurant": doc.restaurant,
				"branch": doc.branch,
				"company": doc.company,
				"sales_order": doc.sales_order,
				"action": action,
				"outcome": outcome,
				"from_status": previous,
				"to_status": doc.status if outcome == "Succeeded" else previous,
				"actor": frappe.session.user,
				"occurred_at": now_datetime(),
				"reason": reason,
				"approved_by": approved_by,
				"request_key": key,
				"success_key": hashlib.sha256(
					json.dumps(["request", key] if claim else ["ticket", key, doc.name]).encode()
				).hexdigest()
				if outcome == "Succeeded"
				else None,
				"stock_entries": json.dumps(entries or []),
				"error_code": getattr(error, "vuna_error_code", type(error).__name__) if error else None,
				"error_message": strip_html(str(error))[:2000] if error else None,
			}
		).insert(ignore_permissions=True)
	finally:
		frappe.flags.vunapos_recording_kitchen_action = old


def _publish(doc):
	name, station = doc.name, doc.kitchen_station

	def after_commit():
		try:
			frappe.publish_realtime(
				"doc_update",
				{"doctype": STATION, "name": station, "ticket": name},
				doctype=STATION,
				docname=station,
			)
		except Exception:
			try:
				frappe.log_error(
					title="Kitchen display notification failed",
					message=frappe.get_traceback(),
					defer_insert=True,
				)
			except Exception:
				frappe.logger("vunapos").exception("Kitchen notification and deferred error logging failed")

	frappe.db.after_commit.add(after_commit)


def _work_orders(doc):
	result = []
	for row in sorted(doc.items, key=lambda item: item.work_order or ""):
		if row.parent_line_id:
			continue
		if not row.work_order:
			fail(
				"KITCHEN_PRODUCTION_LINK_REQUIRED",
				_(
					"Ticket {0} has no Work Order for {1}. Resolve its production link before marking it ready."
				).format(doc.name, row.item_name),
			)
		wo = frappe.get_doc("Work Order", row.work_order, for_update=True)
		if (
			wo.docstatus != 1
			or wo.status == "Closed"
			or wo.sales_order != doc.sales_order
			or wo.sales_order_item != row.sales_order_item
			or wo.production_item != row.item_code
			or wo.company != doc.company
			or abs(flt(wo.qty) - flt(row.stock_qty)) > 0.000001
		):
			fail(
				"KITCHEN_PRODUCTION_MISMATCH",
				_("Work Order {0} no longer matches its preparation ticket.").format(wo.name),
			)
		result.append(wo)
	return result


def _stock_entry(wo, purpose, qty):
	message_start = len(frappe.local.message_log or [])
	try:
		return _native_stock_entry(wo, purpose, qty)
	except frappe.PermissionError as exc:
		# Keep the full traceback server-side, never grant global manufacturing
		# permissions merely to make a controlled preparation command succeed.
		frappe.logger("vunapos").exception("Kitchen production denied: %s / %s", wo.name, purpose)
		detail = strip_html(str(exc)).strip()
		if not detail:
			# Frappe sometimes raises an empty PermissionError after msgprint.
			for message in reversed((frappe.local.message_log or [])[message_start:]):
				if isinstance(message, str):
					try:
						message = json.loads(message)
					except (TypeError, ValueError):
						continue
				if isinstance(message, dict) and message.get("raise_exception"):
					detail = strip_html(str(message.get("message") or "")).strip()
					break
		fail(
			"KITCHEN_PRODUCTION_PERMISSION_DENIED",
			_(
				"Cannot complete {0} for Work Order {1}: {2} The ticket has not advanced. Ask a manager to check manufacturing permissions and the server log, then retry."
			).format(purpose, wo.name, detail or _("ERPNext denied a required production operation.")),
			{"work_order": wo.name, "operation": purpose},
		)


def _native_stock_entry(wo, purpose, qty):
	# Same native factory primitives as work_order.make_stock_entry, without
	# granting a kitchen operator global Work Order / Stock Entry access.
	entry = frappe.new_doc("Stock Entry")
	entry.update(
		{
			"purpose": purpose,
			"work_order": wo.name,
			"company": wo.company,
			"from_bom": 1,
			"bom_no": wo.bom_no,
			"use_multi_level_bom": wo.use_multi_level_bom,
			"fg_completed_qty": qty,
			"project": wo.project,
		}
	)
	if purpose == "Material Transfer for Manufacture":
		entry.to_warehouse = wo.wip_warehouse
	else:
		entry.from_warehouse = (
			wo.source_warehouse if wo.skip_transfer and not wo.from_wip_warehouse else wo.wip_warehouse
		)
		entry.to_warehouse = wo.fg_warehouse
		entry.inspection_required = frappe.get_cached_value("BOM", wo.bom_no, "inspection_required")
	entry.set_stock_entry_type()
	entry.get_items()
	entry.set_secondary_items_from_job_card()
	if purpose == "Manufacture":
		entry.set_serial_no_batch_for_finished_good()
	entry.insert(ignore_permissions=True)
	entry.submit()
	return entry.name


def _produce(doc, ready=False):
	entries = []
	work_orders = _work_orders(doc)
	_lock_stock_bins(work_orders)
	for wo in work_orders:
		if not wo.skip_transfer:
			remaining = flt(wo.qty) - flt(wo.material_transferred_for_manufacturing)
			if remaining > 0.000001:
				entries.append(_stock_entry(wo, "Material Transfer for Manufacture", remaining))
				wo.reload()
		if ready:
			remaining = flt(wo.qty) - flt(wo.produced_qty)
			if remaining > 0.000001:
				entries.append(_stock_entry(wo, "Manufacture", remaining))
				wo.reload()
			if flt(wo.produced_qty) + 0.000001 < flt(wo.qty):
				fail(
					"KITCHEN_MANUFACTURE_INCOMPLETE",
					_("Work Order {0} is not fully manufactured.").format(wo.name),
				)
	if ready:
		for row in doc.items:
			if row.parent_line_id:
				continue
			reserved = flt(
				frappe.db.get_value("Sales Order Item", row.sales_order_item, "stock_reserved_qty")
			)
			if reserved + 0.000001 < flt(row.stock_qty):
				fail(
					"KITCHEN_OUTPUT_NOT_RESERVED",
					_(
						"Finished stock for {0} is not fully reserved for this order. Check its ERPNext reservations before marking ready."
					).format(row.item_name),
				)
	return entries


def _lock_stock_bins(work_orders, order=None):
	from erpnext.stock.utils import get_or_make_bin

	keys = set()
	for wo in work_orders:
		keys.add((wo.production_item, wo.fg_warehouse))
		for row in wo.required_items:
			keys.add((row.item_code, row.source_warehouse))
			if wo.wip_warehouse:
				keys.add((row.item_code, wo.wip_warehouse))
	if order:
		for row in order.items:
			if frappe.get_cached_value("Item", row.item_code, "is_stock_item"):
				keys.add((row.item_code, row.warehouse))
	for code, warehouse in sorted((code, warehouse) for code, warehouse in keys if warehouse):
		frappe.db.get_value("Bin", get_or_make_bin(code, warehouse), "name", for_update=True)


def _rollback_command(savepoint):
	try:
		frappe.db.rollback(save_point=savepoint)
	except Exception:
		# InnoDB deadlocks may already have rolled back the entire transaction,
		# removing the savepoint. These dedicated commands own their transaction.
		frappe.db.rollback()


def transition(ticket, action, request_key, expected_status):
	key = _request_key(request_key)
	if action not in TRANSITIONS:
		fail("INVALID_KITCHEN_ACTION", _("Unsupported preparation action."))
	doc = _ticket(ticket, lock=True)
	# Replayed successful requests still require the same functional role.
	if action not in capabilities(TRANSITIONS[action][0]):
		frappe.throw(_("Your restaurant role cannot perform this kitchen action."), frappe.PermissionError)
	if _replay(doc, action, key):
		return ticket_detail(doc.name)
	_order(doc, serving=action == "Serve")
	source, _target = TRANSITIONS[action]
	if doc.status != expected_status or doc.status != source:
		fail(
			"KITCHEN_STALE_STATE",
			_("This ticket is now {0}. Refresh before taking another action.").format(doc.status),
			{"status": doc.status},
		)
	savepoint = "kitchen_action_" + uuid4().hex
	frappe.db.savepoint(savepoint)
	try:
		_apply_transition(doc, action, key)
	except Exception as exc:
		_rollback_command(savepoint)
		doc.reload()
		_record(doc, action, key, source, outcome="Failed", error=exc)
		raise
	_publish(doc)
	return ticket_detail(doc.name)


def _apply_transition(doc, action, key, reason=None):
	source, target = TRANSITIONS[action]
	if doc.status != source:
		fail("KITCHEN_STALE_STATE", _("Refresh this preparation ticket before proceeding."))
	entries = _produce(doc, ready=action == "Ready") if action in ("Start", "Ready") else []
	doc.db_set("status", target)
	_record(doc, action, key, source, entries=entries, reason=reason)


def complete_for_billing(ticket, profile):
	"""Private opt-in cashier path. The outer billing transaction owns rollback.

	Does not grant the cashier general KDS preparation rights or bypass station
	permissions. Each successful step retains its actor and native stock entries.
	"""
	if (
		not cint(profile.get("vunapos_complete_preparation_on_billing"))
		or CASHIER_ROLE not in frappe.get_roles()
	):
		frappe.throw(
			_("This POS Profile does not allow the cashier to complete preparation during billing."),
			frappe.PermissionError,
		)
	doc = _ticket(ticket, lock=True)
	if (
		profile.get("vunapos_restaurant") != doc.restaurant
		or profile.company != doc.company
		or profile.vunapos_branch != doc.branch
	):
		fail(
			"KITCHEN_CONTEXT_MISMATCH", _("The billing profile does not belong to this ticket's Restaurant.")
		)
	_order(doc)
	if doc.status in ("Ready", "Served"):
		return
	if doc.status not in ("Sent", "Accepted", "Preparing"):
		fail("KITCHEN_STALE_STATE", _("This ticket cannot be completed during billing."))
	for action, (source, _target) in TRANSITIONS.items():
		if action == "Serve":
			break
		if doc.status == source:
			key = "billing-" + hashlib.sha256(f"{doc.name}:{action}".encode()).hexdigest()
			_apply_transition(
				doc,
				action,
				key,
				reason=_("Completed during billing using POS Profile {0}.").format(profile.name),
			)
	_publish(doc)


def cancel_order(ticket, request_key, expected_status, reason, manager_pin_token=None):
	key = _request_key(request_key)
	if not isinstance(reason, str) or not reason.strip() or len(reason) > 500:
		fail("CANCEL_REASON_REQUIRED", _("Enter a cancellation reason of up to 500 characters."))
	reason = reason.strip()
	doc = _ticket(ticket, lock=True)
	if not can_cancel():
		frappe.throw(
			_("Only restaurant service staff or a manager may cancel an order."), frappe.PermissionError
		)
	if _replay(doc, "Cancel Order", key, reason):
		return ticket_detail(doc.name)
	order = _order(doc)
	if doc.status != expected_status:
		fail("KITCHEN_STALE_STATE", _("This ticket changed. Refresh before cancelling its order."))
	tickets = [
		_ticket(name, lock=True)
		for name in frappe.get_all(
			TICKET, filters={"sales_order": doc.sales_order}, pluck="name", order_by="name"
		)
	]
	if any(row.status in ("Served", "Cancelled") for row in tickets):
		fail(
			"KITCHEN_REVERSAL_REQUIRED",
			_(
				"Served or previously cancelled orders require a separate correction; they cannot be cancelled again."
			),
		)
	work_orders = {wo.name: wo for row in tickets for wo in _work_orders(row)}
	for wo in work_orders.values():
		if (
			flt(wo.produced_qty)
			or flt(wo.material_transferred_for_manufacturing)
			or frappe.db.exists("Stock Entry", {"work_order": wo.name, "docstatus": 1})
		):
			fail(
				"KITCHEN_REVERSAL_REQUIRED",
				_(
					"Work Order {0} has stock movements. Reverse them explicitly in ERPNext before cancelling this order."
				).format(wo.name),
			)
	profile = frappe.get_doc("POS Profile", order.vunapos_pos_profile)
	approved_by = frappe.session.user if set(frappe.get_roles()) & MANAGERS else None
	if not approved_by and cint(profile.get("vunapos_require_manager_pin_order_cancel")):
		from vunapos.services.pin_service import validate_pin_token

		approved_by = validate_pin_token(manager_pin_token, profile, "manager_order_cancel").get("subject")
	savepoint = "kitchen_cancel_" + uuid4().hex
	frappe.db.savepoint(savepoint)
	old = frappe.flags.get("vunapos_cancelling_kitchen_order")
	try:
		_lock_stock_bins(work_orders.values(), order)
		for wo in work_orders.values():
			wo.flags.ignore_permissions = True
			# Immutable snapshots keep cancelled links; operational links still validate.
			wo.ignore_linked_doctypes = ["Kitchen Order Ticket Item"]
			wo.cancel()
		order.update(
			{
				"vunapos_cancel_reason": reason,
				"vunapos_cancel_approved_by": approved_by,
				"vunapos_cancelled_by": frappe.session.user,
				"vunapos_cancelled_at": now_datetime(),
			}
		)
		order.flags.ignore_permissions = True
		frappe.flags.vunapos_cancelling_kitchen_order = order.name
		order.cancel()
		for index, row in enumerate(tickets):
			previous = row.status
			row.db_set("status", "Cancelled")
			_record(
				row, "Cancel Order", key, previous, reason=reason, approved_by=approved_by, claim=index == 0
			)
	except Exception as exc:
		_rollback_command(savepoint)
		doc.reload()
		_record(doc, "Cancel Order", key, doc.status, outcome="Failed", reason=reason, error=exc)
		raise
	finally:
		frappe.flags.vunapos_cancelling_kitchen_order = old
	if manager_pin_token and not set(frappe.get_roles()) & MANAGERS:
		from vunapos.services.pin_service import consume_pin_token

		consume_pin_token(manager_pin_token, profile, "manager_order_cancel")
	for row in tickets:
		_publish(row)
	# Cancelling a batch does not release its table or implicitly close the visit.
	return ticket_detail(doc.name)


def ticket_detail(name):
	from vunapos.services.kitchen_service import get_ticket

	return get_ticket(name)


def allow_cancelled_order_audit_links(doc, method=None):
	if frappe.flags.get("vunapos_cancelling_kitchen_order") == doc.name:
		doc.ignore_linked_doctypes = [*(doc.get("ignore_linked_doctypes") or []), TICKET, ACTION]


def action_history(doc):
	return frappe.get_list(
		ACTION,
		filters={"kitchen_ticket": doc.name},
		fields=[
			"name",
			"action",
			"outcome",
			"from_status",
			"to_status",
			"actor",
			"occurred_at",
			"reason",
			"approved_by",
			"stock_entries",
			"error_message",
		],
		order_by="creation desc",
		limit_page_length=100,
	)


def list_board(pos_profile, station=None, history=False, start=0):
	from vunapos.services.floor_plan_service import require_restaurant_profile

	restaurant = require_restaurant_profile(pos_profile)
	branch = frappe.get_cached_value("POS Profile", pos_profile, "vunapos_branch")
	require_restaurant_access(restaurant, branch=branch)
	stations = frappe.get_list(
		STATION,
		filters={"restaurant": restaurant, "branch": branch},
		fields=["name", "station_name", "enabled"],
		order_by="station_name",
		limit_page_length=500,
	)
	names = [row.name for row in stations]
	if station and station not in names:
		frappe.throw(_("This kitchen station is not available to you."), frappe.PermissionError)
	filters = {"restaurant": restaurant, "docstatus": 1, "kitchen_station": station or ["in", names or [""]]}
	if not cint(history):
		filters["status"] = ["in", ["Sent", "Accepted", "Preparing", "Ready"]]
	start = max(0, min(cint(start), 100000))
	rows = frappe.get_list(
		TICKET,
		filters=filters,
		fields=[
			"name",
			"sales_order",
			"restaurant_session",
			"kitchen_station",
			"station_label",
			"table_labels",
			"service_type",
			"sent_at",
			"sent_by",
			"waiter",
			"order_note",
			"status",
			"modified",
		],
		order_by="sent_at asc, name asc",
		limit_start=start,
		limit_page_length=101,
	)
	has_more = len(rows) > 100
	rows = rows[:100]
	items = frappe.get_all(
		"Kitchen Order Ticket Item",
		filters={"parent": ["in", [row.name for row in rows] or [""]]},
		fields=[
			"parent",
			"line_id",
			"parent_line_id",
			"item_code",
			"item_name",
			"qty",
			"uom",
			"stock_qty",
			"stock_uom",
			"note",
			"modifiers",
			"work_order",
		],
		order_by="idx asc",
	)
	for row in rows:
		row.items = [
			{**item, "modifiers": frappe.parse_json(item.modifiers or "[]")}
			for item in items
			if item.parent == row.name
		]
		row.available_actions = capabilities(row.status)
		row.can_cancel_order = can_cancel() and row.status not in ("Served", "Cancelled")
	return {"stations": stations, "tickets": rows, "has_more": has_more, "start": start}


def preparation_summary(tickets):
	statuses = [row.status for row in tickets]
	active = [status for status in statuses if status != "Cancelled"]
	if not statuses:
		return "No preparation"
	if not active:
		return "Cancelled"
	if all(status == "Served" for status in active):
		return "Served"
	if all(status in ("Ready", "Served") for status in active):
		return "Ready"
	if "Preparing" in active or any(status in ("Ready", "Served") for status in active):
		return "Preparing"
	return "Accepted" if all(status == "Accepted" for status in active) else "Sent"
