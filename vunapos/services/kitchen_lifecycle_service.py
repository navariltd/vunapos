"""Controlled KDS commands; payload snapshots stay immutable and effects are atomic.

No client may supply stock-entry quantities, warehouses or arbitrary Work Orders.
Failed commands roll back their savepoint, then append a failure audit for retry.
"""

import hashlib
import json
from uuid import uuid4

import frappe
from frappe import _
from frappe.utils import cint, flt, get_datetime, now_datetime, strip_html

from vunapos.services.kitchen_service import STATION, TICKET, fail
from vunapos.services.restaurant_service import require_restaurant_access
from vunapos.setup.utils import CASHIER_ROLE, KITCHEN_ROLE, RESTAURANT_MANAGER_ROLE, WAITER_ROLE

ACTION = "Kitchen Ticket Action"
TRANSITIONS = {
	"Accept": ("Sent", "Accepted"),
	"Start": ("Accepted", "Preparing"),
	"Ready": ("Preparing", "Ready"),
	"Serve": ("Ready", "Served"),
	"Undo Serve": ("Served", "Ready"),
}
# Billing completes a ticket's production without changing its status.
BILLING_ACTION = "Complete for Billing"
MANAGERS = {"System Manager", RESTAURANT_MANAGER_ROLE}


def capabilities(status, progress=None):
	roles = set(frappe.get_roles())
	result = []
	for action, (source, _target) in TRANSITIONS.items():
		allowed = (
			MANAGERS
			if action == "Undo Serve"
			else MANAGERS | ({WAITER_ROLE, CASHIER_ROLE} if action == "Serve" else {KITCHEN_ROLE})
		)
		eligible = status == source
		if progress is not None:
			eligible = status != "Cancelled" and any(
				row.get("available_quantities", {}).get(action, 0) > 0.000001 for row in progress.values()
			)
		if eligible and roles & allowed:
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
	# These locks are already owned by _ticket. Re-read current values: a
	# concurrent billing/cancellation may have completed while it was waiting.
	session = frappe.get_doc("Restaurant Session", doc.restaurant_session, for_update=True)
	order = frappe.get_doc("Sales Order", doc.sales_order, for_update=True)
	replacement = bool(doc.get("remake_of"))
	if (
		doc.docstatus != 1
		or order.docstatus != 1
		or order.status == "Closed"
		or session.status not in (("Open", "Settling", "Settled") if serving or replacement else ("Open",))
		or (flt(order.per_billed) > 0 and not serving and not replacement)
	):
		fail("KITCHEN_ORDER_NOT_OPEN", _("Preparation actions require an open, unbilled restaurant order."))
	if (
		order.get("vunapos_restaurant_session") != session.name
		or order.company != doc.company
		or session.restaurant != doc.restaurant
	):
		fail("KITCHEN_CONTEXT_MISMATCH", _("The preparation ticket does not match its restaurant order."))
	if replacement:
		from vunapos.services.restaurant_remake_service import validate_output_balance, validate_visit

		validate_visit(doc, session, order)
		validate_output_balance(doc)
	return order


def _request_key(key):
	if not isinstance(key, str) or not key.strip() or len(key) > 140:
		fail("IDEMPOTENCY_REQUIRED", _("A request key of up to 140 characters is required."))
	return key.strip()


def _replay(doc, action, key, reason=None, request_fingerprint=None, quantified=False):
	row = frappe.db.get_value(
		ACTION,
		{
			"success_key": hashlib.sha256(json.dumps(["request", key]).encode()).hexdigest(),
			"outcome": "Succeeded",
		},
		["kitchen_ticket", "sales_order", "action", "actor", "reason", "request_fingerprint"],
		as_dict=True,
		# The ticket lock may have waited for another request to commit. Use a
		# current read, not the snapshot taken during the initial permission check.
		for_update=True,
	)
	if not row:
		return False
	if (
		row.action != action
		or row.actor != frappe.session.user
		or row.sales_order != doc.sales_order
		or (action != "Cancel Order" and row.kitchen_ticket != doc.name)
		or (row.reason or "") != (reason or "")
		or (row.request_fingerprint and request_fingerprint != row.request_fingerprint)
		or (quantified and not row.request_fingerprint)
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
	quantities=None,
	request_fingerprint=None,
	accounting=None,
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
				"item_quantities": quantities,
				"request_fingerprint": request_fingerprint,
				**(accounting or {}),
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


def _work_orders(doc, line_ids=None):
	from vunapos.services.kitchen_progress_service import load

	progress = load([doc], for_update=True)[doc.name]
	result = []
	for row in sorted(doc.items, key=lambda item: item.work_order or ""):
		if row.parent_line_id or (line_ids is not None and row.line_id not in line_ids):
			continue
		active_qty = flt(row.qty) - progress[row.line_id].get("cancelled_qty", 0)
		if active_qty <= 0.000001:
			continue
		if not row.work_order:
			fail(
				"KITCHEN_PRODUCTION_LINK_REQUIRED",
				_(
					"Ticket {0} has no Work Order for {1}. Resolve its production link before marking it ready."
				).format(doc.name, row.item_name),
			)
		wo = frappe.get_doc("Work Order", row.work_order, for_update=True)
		if doc.get("remake_of"):
			from vunapos.services.restaurant_remake_service import validate_work_order

			validate_work_order(doc, row, wo)
			result.append(wo)
			continue
		if (
			wo.docstatus != 1
			or wo.status == "Closed"
			or wo.sales_order != doc.sales_order
			or wo.sales_order_item != row.sales_order_item
			or wo.production_item != row.item_code
			or wo.company != doc.company
			or abs(flt(wo.qty) - flt(active_qty * row.conversion_factor)) > 0.000001
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
					except TypeError, ValueError:
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
	_get_items(entry)
	entry.set_secondary_items_from_job_card()
	if purpose == "Manufacture":
		entry.set_serial_no_batch_for_finished_good()
	entry.insert(ignore_permissions=True)
	entry.submit()
	return entry.name


def _get_items(entry):
	"""Build the entry's rows without ERPNext's read check on its Work Order and BOM.

	ERPNext 16.60 requires Work Order and BOM read in `get_items`, which kitchen and cashier
	roles deliberately lack; `_work_orders` has already checked both against the ticket.
	Frappe has no per-call permission flag, and switching user would reset request state,
	so only this request's check for this entry's own Work Order and BOM is skipped.
	"""
	import erpnext

	check = erpnext.require_permission
	skipped = {("Work Order", entry.work_order), ("BOM", entry.bom_no)}

	def require_permission(doctype, name, ptype="read"):
		if frappe.flags.get("vunapos_kitchen_stock_entry") is entry and (doctype, name) in skipped:
			return
		return check(doctype, name, ptype)

	erpnext.require_permission = require_permission
	frappe.flags.vunapos_kitchen_stock_entry = entry
	try:
		entry.get_items()
	finally:
		frappe.flags.vunapos_kitchen_stock_entry = None
		erpnext.require_permission = check


def _produce(doc, targets, ready=False):
	entries = []
	work_orders = _work_orders(doc, targets)
	by_order = {row.work_order: row for row in doc.items if row.line_id in targets}
	_lock_stock_bins(work_orders)
	for wo in work_orders:
		row = by_order[wo.name]
		target = flt(targets[row.line_id] * flt(row.conversion_factor or (row.stock_qty / row.qty)), 6)
		if not wo.skip_transfer:
			remaining = target - flt(wo.material_transferred_for_manufacturing)
			if remaining > 0.000001:
				entries.append(_stock_entry(wo, "Material Transfer for Manufacture", remaining))
				wo.reload()
		if ready:
			remaining = target - flt(wo.produced_qty)
			if remaining > 0.000001:
				entries.append(_stock_entry(wo, "Manufacture", remaining))
				wo.reload()
			if flt(wo.produced_qty) + 0.000001 < target:
				fail(
					"KITCHEN_MANUFACTURE_INCOMPLETE",
					_("Work Order {0} is not fully manufactured.").format(wo.name),
				)
	if ready:
		if doc.get("remake_of"):
			from vunapos.services.restaurant_remake_service import issue_replacement_output

			return entries + issue_replacement_output(doc, targets, work_orders)
		for row in doc.items:
			if row.parent_line_id or row.line_id not in targets:
				continue
			reserved = flt(
				frappe.db.get_value("Sales Order Item", row.sales_order_item, "stock_reserved_qty")
			)
			target = flt(targets[row.line_id] * flt(row.conversion_factor or (row.stock_qty / row.qty)), 6)
			if reserved + 0.000001 < target:
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


def transition(
	ticket, action, request_key, expected_status, quantities=None, expected_modified=None, reason=None
):
	from vunapos.services import kitchen_progress_service as progress_service
	from vunapos.services.restaurant_request_service import fingerprint, parsed

	key = _request_key(request_key)
	if action not in TRANSITIONS:
		fail("INVALID_KITCHEN_ACTION", _("Unsupported preparation action."))
	if action == "Undo Serve" and (not isinstance(reason, str) or not reason.strip() or len(reason) > 500):
		fail(
			"CORRECTION_REASON_REQUIRED", _("Enter a reason of up to 500 characters for correcting service.")
		)
	reason = reason.strip() if action == "Undo Serve" else None
	doc = _ticket(ticket, lock=True)
	# Replayed successful requests still require the same functional role.
	if action not in capabilities(TRANSITIONS[action][0]):
		frappe.throw(_("Your restaurant role cannot perform this kitchen action."), frappe.PermissionError)
	request_fingerprint = fingerprint(
		{
			"action": action,
			"quantities": parsed(quantities),
			"expected_modified": expected_modified,
			"expected_status": expected_status,
			"reason": reason,
		}
	)
	if _replay(
		doc,
		action,
		key,
		reason=reason,
		request_fingerprint=request_fingerprint,
		quantified=quantities is not None,
	):
		return ticket_detail(doc.name)
	# Billing may already have posted production; the kitchen still records its
	# real preparation/service progress without manufacturing the food twice.
	_order(doc, serving=action in ("Serve", "Undo Serve") or cint(doc.production_completed_at_billing))
	if doc.status != expected_status or (
		expected_modified and get_datetime(doc.modified) != get_datetime(expected_modified)
	):
		fail(
			"KITCHEN_STALE_STATE",
			_("This ticket is now {0}. Refresh before taking another action.").format(doc.status),
			{"status": doc.status},
		)
	if quantities is not None and not expected_modified:
		fail("KITCHEN_VERSION_REQUIRED", _("Refresh this ticket before updating individual quantities."))
	progress = progress_service.load([doc], for_update=True)[doc.name]
	selected = progress_service.selection(doc, action, quantities, progress)
	if action == "Undo Serve":
		from vunapos.services.restaurant_waste_service import validate_service_correction

		validate_service_correction(doc, selected, progress)
	savepoint = "kitchen_action_" + uuid4().hex
	frappe.db.savepoint(savepoint)
	try:
		_apply_transition(
			doc,
			action,
			key,
			progress=progress,
			quantities=selected,
			request_fingerprint=request_fingerprint,
			reason=reason,
		)
	except (frappe.QueryDeadlockError, frappe.QueryTimeoutError):
		# The request boundary restarts the whole aborted transaction. Do not
		# reload or append an audit using objects from the invalid snapshot.
		raise
	except Exception as exc:
		_rollback_command(savepoint)
		doc.reload()
		_record(
			doc,
			action,
			key,
			doc.status,
			outcome="Failed",
			error=exc,
			reason=reason,
			quantities={"deltas": selected},
			request_fingerprint=request_fingerprint,
		)
		raise
	_publish(doc)
	return ticket_detail(doc.name)


def _apply_transition(
	doc, action, key, reason=None, progress=None, quantities=None, request_fingerprint=None
):
	from vunapos.services import kitchen_progress_service as progress_service

	progress = progress or progress_service.load([doc], for_update=True)[doc.name]
	quantities = quantities or progress_service.selection(doc, action, None, progress)
	before = {
		row.line_id: {field: progress[row.line_id][field] for field in progress_service.FIELDS.values()}
		for row in doc.items
		if not row.parent_line_id
	}
	source = doc.status
	field = "served_qty" if action == "Undo Serve" else progress_service.FIELDS[action]
	targets = {
		line: flt(progress[line][field] + (-qty if action == "Undo Serve" else qty), 6)
		for line, qty in quantities.items()
	}
	entries = (
		_produce(doc, targets, ready=action == "Ready")
		if action in ("Start", "Ready") and not cint(doc.production_completed_at_billing)
		else []
	)
	for line, total in targets.items():
		progress[line][field] = total
	target = progress_service.status_for(doc.items, progress)
	doc.db_set("status", target)
	_record(
		doc,
		action,
		key,
		source,
		entries=entries,
		reason=reason,
		quantities={"deltas": quantities, "before": before},
		request_fingerprint=request_fingerprint,
	)


def complete_for_billing(ticket, profile, kiosk=False):
	"""Private cashier path, opted in by the till or by confirming a kiosk payment.
	The outer billing transaction owns rollback.

	Does not grant the cashier general KDS preparation rights or bypass station
	permissions. Posts the ticket's transfers and manufacture, flags it and keeps its
	status; one audit row retains the actor and native stock entries.
	"""
	if (
		not (kiosk or cint(profile.get("vunapos_complete_preparation_on_billing")))
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
	if doc.status in ("Ready", "Served", "Completed") or cint(doc.production_completed_at_billing):
		return
	if doc.status not in ("Sent", "Accepted", "Preparing"):
		fail("KITCHEN_STALE_STATE", _("This ticket cannot be completed during billing."))
	# Stock only: the kitchen still accepts, starts and readies the ticket itself.
	from vunapos.services import kitchen_progress_service as progress_service

	progress = progress_service.load([doc], for_update=True)[doc.name]
	targets = {
		row.line_id: flt(progress[row.line_id]["qty"] - progress[row.line_id]["cancelled_qty"], 6)
		for row in doc.items
		if not row.parent_line_id
		and progress[row.line_id]["qty"] - progress[row.line_id]["cancelled_qty"]
		> progress[row.line_id]["ready_qty"] + 0.000001
	}
	entries = _produce(doc, targets, ready=True)
	doc.db_set("production_completed_at_billing", 1)
	_record(
		doc,
		BILLING_ACTION,
		"billing-" + hashlib.sha256(f"{doc.name}:{BILLING_ACTION}".encode()).hexdigest(),
		doc.status,
		entries=entries,
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
	from vunapos.services.restaurant_payment_service import guard_order_change

	guard_order_change(frappe.get_doc("Restaurant Session", doc.restaurant_session))
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
	except (frappe.QueryDeadlockError, frappe.QueryTimeoutError):
		raise
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

	# Commands already own the ticket lock. A plain read here could return the
	# pre-wait snapshot and tell the second terminal an older status succeeded.
	return get_ticket(name, for_update=True)


def allow_cancelled_order_audit_links(doc, method=None):
	if frappe.flags.get("vunapos_cancelling_kitchen_order") == doc.name:
		doc.ignore_linked_doctypes = [*(doc.get("ignore_linked_doctypes") or []), TICKET, ACTION]
		if frappe.flags.get("vunapos_stopping_preparation"):
			doc.ignore_linked_doctypes += ["Work Order", "Stock Entry"]


def action_history(doc, for_update=False):
	rows = frappe.qb.get_query(
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
			"item_quantities",
			"error_message",
		],
		order_by="creation desc",
		limit=100,
		ignore_permissions=False,
		for_update=for_update,
	).run(as_dict=True)
	for row in rows:
		row.item_quantities = frappe.parse_json(row.item_quantities)
	return rows


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
	from vunapos.services.restaurant_availability_service import active

	pauses = {
		row.kitchen_station: row for row in active(restaurant, branch) if row.target_type == "Kitchen Station"
	}
	for row in stations:
		pause = pauses.get(row.name)
		row.ordering_paused = bool(pause)
		row.availability_reason = pause.reason if pause else None
		row.unavailable_until = pause.unavailable_until if pause else None
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
			"production_completed_at_billing",
			"modified",
			"remake_of",
			"remake_reason",
			"original_disposition",
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
		row.can_cancel_order = (
			can_cancel()
			and not row.get("remake_of")
			and row.status not in ("Served", "Completed", "Cancelled")
			and not row.production_completed_at_billing
		)
	from vunapos.services.kitchen_progress_service import load

	progress = load(rows)
	from vunapos.services.kitchen_service import ticket_time, ticket_user_names

	user_names = ticket_user_names(rows)
	from vunapos.services.kitchen_notes import current_notes

	for row in rows:
		notes = current_notes(row.name)
		for item in row.get("items"):
			if item["line_id"] in notes:
				item["note"] = notes[item["line_id"]]
				item["note_updated"] = True
		row.sent_at = ticket_time(row.sent_at)
		row.waiter_name = user_names.get(row.waiter) or row.waiter
		row.sent_by_name = user_names.get(row.sent_by) or row.sent_by
		for item in row.get("items"):
			item.update(progress[row.name][item["line_id"]])
		row.available_actions = capabilities(row.status, progress[row.name])
	return {
		"server_now": ticket_time(now_datetime()),
		"stations": stations,
		"tickets": rows,
		"has_more": has_more,
		"start": start,
		"can_manage_availability": bool(set(frappe.get_roles()) & MANAGERS),
	}


def preparation_summary(tickets):
	statuses = [row.status for row in tickets]
	active = [status for status in statuses if status not in ("Cancelled", "Completed")]
	if not statuses:
		return "No preparation"
	if not active:
		return "Completed" if "Completed" in statuses else "Cancelled"
	if all(status == "Served" for status in active):
		return "Served"
	if all(status in ("Ready", "Served") for status in active):
		return "Ready"
	if "Preparing" in active or any(status in ("Ready", "Served") for status in active):
		return "Preparing"
	return "Accepted" if all(status == "Accepted" for status in active) else "Sent"
