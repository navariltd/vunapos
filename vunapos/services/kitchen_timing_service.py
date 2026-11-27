"""Read-only stage timings from successful preparation events.

Quantities are matched FIFO within each dish, not treated as individually tracked
meals. Add-ons follow their parent and do not double-count preparation. Missing
legacy timestamps stay unknown; billing stock movements are not kitchen progress.
"""

from zoneinfo import ZoneInfo

import frappe
from frappe.utils import flt, get_datetime, get_system_timezone

STAGES = ("acceptance", "queue", "preparation", "service")
ACTIONS = {"Accept": 0, "Start": 1, "Ready": 2, "Serve": 3}
BUCKETS = ("not_accepted_qty", "waiting_qty", "preparing_qty", "ready_to_serve_qty", "served_qty")
TERMINAL_ACTIONS = {
	"Served": {"Serve"},
	"Completed": {"Request Remake", "Reject Items", "Cancel Items", "Stop Preparation"},
	"Cancelled": {"Cancel Order", "Cancel Items", "Stop Preparation", "Cancel Remake"},
}
EPSILON = 0.000001


def _take(queue, qty):
	parts = []
	while qty > EPSILON and queue:
		part = queue[0]
		used = min(qty, part["qty"])
		parts.append({"qty": used, "at": part["at"]})
		qty -= used
		part["qty"] -= used
		if part["qty"] <= EPSILON:
			queue.pop(0)
	if qty > EPSILON:
		parts.append({"qty": qty, "at": None})
	return parts


def _align(queue, qty):
	"""Keep known entries, never invent times for imported/pre-upgrade progress."""
	difference = flt(qty) - sum(part["qty"] for part in queue)
	if difference > EPSILON:
		queue.append({"qty": difference, "at": None})
	elif difference < -EPSILON:
		_take(queue, -difference)


def derive(items, sent_at, status, events, progress, *, details=False):
	zone = ZoneInfo(get_system_timezone())
	items = [row.as_dict() if callable(getattr(row, "as_dict", None)) else row for row in items]

	def stamp(value):
		if not value:
			return None
		date = get_datetime(value)
		return date.replace(tzinfo=zone).isoformat() if date.tzinfo is None else date.isoformat()

	parents = {row["line_id"]: row for row in items if not row.get("parent_line_id")}
	queues = {
		key: [[{"qty": flt(row["qty"]), "at": sent_at}], [], [], [], []] for key, row in parents.items()
	}
	completed = []
	closed_at = None
	quantified = False
	for event in events:
		if event.get("outcome", "Succeeded") != "Succeeded":
			continue
		action = event["action"]
		at = event.get("occurred_at")
		if action in TERMINAL_ACTIONS.get(status, set()) and (
			status == "Served" or event.get("to_status") == status
		):
			closed_at = at
		payload = frappe.parse_json(event.get("item_quantities"))
		if (
			payload is not None
			and not quantified
			and action
			in (*ACTIONS, "Undo Serve", "Cancel Items", "Stop Preparation", "Request Remake", "Reject Items")
		):
			for key, before in payload.get("before", {}).items():
				if key not in queues:
					continue
				counts = [
					flt(parents[key]["qty"]),
					*(
						flt(before.get(field))
						for field in ("accepted_qty", "started_qty", "ready_qty", "served_qty")
					),
					0,
				]
				for index, queue in enumerate(queues[key]):
					_align(queue, max(0, counts[index] - counts[index + 1]))
			quantified = True
		for key, buckets in queues.items():
			qty = flt(payload.get("deltas", {}).get(key)) if payload is not None else None
			if action in ACTIONS:
				index = ACTIONS[action]
				qty = sum(part["qty"] for part in buckets[index]) if qty is None else qty
				for part in _take(buckets[index], qty):
					if details:
						start = part["at"]
						seconds = (
							(get_datetime(at) - get_datetime(start)).total_seconds() if at and start else None
						)
						completed.append(
							{
								"stage": STAGES[index],
								"line_id": key,
								"qty": flt(part["qty"], 6),
								"started_at": stamp(start),
								"finished_at": stamp(at),
								"seconds": seconds if seconds is not None and seconds >= 0 else None,
							}
						)
					buckets[index + 1].append({"qty": part["qty"], "at": at})
			elif action in ("Cancel Items", "Stop Preparation"):
				remaining = qty or 0
				for bucket in buckets[:3]:
					removed = min(remaining, sum(part["qty"] for part in bucket))
					_take(bucket, removed)
					remaining -= removed
			elif action in ("Request Remake", "Reject Items") and payload:
				_take(buckets[3], flt(payload.get("retired", {}).get(key)))
			elif action == "Undo Serve":
				qty = sum(part["qty"] for part in buckets[4]) if qty is None else qty
				_take(buckets[4], qty)
				buckets[3].append({"qty": qty, "at": at})

	stages = []
	for index, stage in enumerate(STAGES):
		pending = []
		for key, buckets in queues.items():
			_align(buckets[index], progress.get(key, {}).get(BUCKETS[index], 0))
			pending.extend(part for part in buckets[index] if part["qty"] > EPSILON)
		# Do not show a live timer for cancelled/retired quantities or closed tickets.
		if status in ("Served", "Completed", "Cancelled"):
			pending = []
		unknown = any(not part["at"] for part in pending)
		stages.append(
			{
				"stage": stage,
				"pending": bool(pending),
				"since": None if unknown or not pending else min(stamp(part["at"]) for part in pending),
			}
		)
	current = next((stage for stage in stages if stage["pending"]), None)
	result = {"sent_at": stamp(sent_at), "current": current, "finished_at": stamp(closed_at)}
	if details:
		result.update({"stages": stages, "batches": completed})
	return result
