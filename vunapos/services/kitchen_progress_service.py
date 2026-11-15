"""Preparation quantities derived from immutable action deltas, in selling UOM.

Cumulative: 0 <= served <= ready <= started <= accepted <= ordered.
Buckets: not accepted + waiting + preparing + ready to serve + served = ordered.
Add-ons inherit their parent's completion ratio and cannot be advanced separately.
"""

import math

import frappe
from frappe import _
from frappe.utils import flt

from vunapos.services.kitchen_service import fail

FIELDS = {"Accept": "accepted_qty", "Start": "started_qty", "Ready": "ready_qty", "Serve": "served_qty"}
PREVIOUS = {"Accept": None, "Start": "accepted_qty", "Ready": "started_qty", "Serve": "ready_qty"}
EPSILON = 0.000001


def remaining(row, action):
	if action == "Undo Serve":
		return row["served_qty"]
	ceiling = row[PREVIOUS[action]] if PREVIOUS[action] else flt(row["qty"])
	return max(0, flt(ceiling - row[FIELDS[action]], 6))


def derive(items, status, events):
	items = [row.as_dict() if callable(getattr(row, "as_dict", None)) else row for row in items]
	parents = {row["line_id"]: row for row in items if not row.get("parent_line_id")}
	result = {
		key: {"qty": flt(row["qty"]), **{field: 0.0 for field in FIELDS.values()}}
		for key, row in parents.items()
	}
	quantified = False
	for event in events:
		action = event["action"]
		if action not in FIELDS and action != "Undo Serve":
			continue
		payload = frappe.parse_json(event.get("item_quantities"))
		values = None
		if payload is not None:
			if not quantified:
				for key, baseline in payload.get("before", {}).items():
					if key in result:
						for field in FIELDS.values():
							result[key][field] = flt(baseline[field])
			values = payload["deltas"]
			quantified = True
		for key, row in result.items():
			qty = remaining(row, action) if values is None else flt(values.get(key))
			if qty < -EPSILON or qty > remaining(row, action) + EPSILON:
				fail(
					"KITCHEN_PROGRESS_INVALID",
					_("Preparation history is inconsistent. Ask a manager to review this ticket."),
				)
			field = "served_qty" if action == "Undo Serve" else FIELDS[action]
			row[field] = flt(row[field] + (-qty if action == "Undo Serve" else qty), 6)
	# Preserve pre-upgrade whole-ticket progress, including imported tickets.
	if not quantified:
		stages = {"Sent": 0, "Accepted": 1, "Preparing": 2, "Ready": 3, "Served": 4}
		for row in result.values():
			for index, field in enumerate(FIELDS.values(), 1):
				if stages.get(status, 0) >= index:
					row[field] = row["qty"]
	for row in result.values():
		row.update(
			{
				"not_accepted_qty": remaining(row, "Accept"),
				"waiting_qty": remaining(row, "Start"),
				"preparing_qty": remaining(row, "Ready"),
				"ready_to_serve_qty": remaining(row, "Serve"),
				"available_quantities": {
					action: remaining(row, action) for action in (*FIELDS, "Undo Serve")
				},
			}
		)
	for item in items:
		parent = item.get("parent_line_id")
		if parent and parent in result:
			ratio = flt(item["qty"]) / result[parent]["qty"]
			result[item["line_id"]] = {
				field: flt(value * ratio, 6)
				for field, value in result[parent].items()
				if field != "available_quantities"
			}
			result[item["line_id"]]["available_quantities"] = {}
	return result


def load(tickets, for_update=False):
	"""One batch history read for a KDS page; never one query per dish or action."""
	names = [doc.name for doc in tickets]
	if not names:
		return {}
	query = frappe.qb.get_query(
		"Kitchen Ticket Action",
		filters={"kitchen_ticket": ["in", names], "outcome": "Succeeded"},
		fields=["kitchen_ticket", "action", "item_quantities"],
		order_by="creation asc, name asc",
		ignore_permissions=True,
		for_update=for_update,
	)
	events = query.run(as_dict=True)
	return {
		doc.name: derive(
			doc.get("items"), doc.status, [event for event in events if event.kitchen_ticket == doc.name]
		)
		for doc in tickets
	}


def status_for(items, progress):
	rows = [progress[row.line_id] for row in items if not row.parent_line_id]
	for field, status in (("served_qty", "Served"), ("ready_qty", "Ready")):
		if rows and all(row["qty"] - row[field] <= EPSILON for row in rows):
			return status
	if any(row["started_qty"] > EPSILON for row in rows):
		return "Preparing"
	return "Accepted" if any(row["accepted_qty"] > EPSILON for row in rows) else "Sent"


def selection(doc, action, quantities, progress):
	parents = {row.line_id: row for row in doc.items if not row.parent_line_id}
	if quantities is None:
		selected = {key: remaining(progress[key], action) for key in parents}
	else:
		selected = frappe.parse_json(quantities) if isinstance(quantities, str) else quantities
		if not isinstance(selected, dict) or not selected:
			fail("INVALID_KITCHEN_QUANTITIES", _("Choose at least one dish and quantity."))
	result = {}
	for key, value in selected.items():
		if key not in parents:
			fail(
				"INVALID_KITCHEN_LINE",
				_("Choose a main dish on this ticket. Add-ons follow their parent dish."),
			)
		try:
			qty = float(value)
		except (TypeError, ValueError):
			qty = float("nan")
		if (
			isinstance(value, bool)
			or not math.isfinite(qty)
			or qty < 0
			or (quantities is not None and qty <= 0)
		):
			fail("INVALID_KITCHEN_QUANTITIES", _("Enter a positive, finite quantity for each selected dish."))
		if qty > remaining(progress[key], action) + EPSILON:
			fail(
				"KITCHEN_QUANTITY_EXCEEDED",
				_("{0}: only {1} {2} can be updated with this action. Refresh the ticket.").format(
					parents[key].item_name, remaining(progress[key], action), parents[key].uom
				),
			)
		if abs(qty - flt(qty, 6)) > 0.00000001:
			fail("INVALID_KITCHEN_QUANTITIES", _("Use no more than six decimal places."))
		if (
			qty
			and frappe.get_cached_value("UOM", parents[key].uom, "must_be_whole_number")
			and abs(qty - round(qty)) > EPSILON
		):
			fail(
				"INVALID_KITCHEN_QUANTITIES",
				_("{0} must be entered in whole {1}.").format(parents[key].item_name, parents[key].uom),
			)
		if qty > EPSILON:
			result[key] = qty
	if not result:
		fail("KITCHEN_STALE_STATE", _("No quantities are waiting for this action. Refresh the ticket."))
	return result
