"""Transactional delivery outbox. A spooler acknowledgement is not proof of paper output."""

import hashlib
import json
import secrets
from contextlib import contextmanager

import frappe
from frappe import _
from frappe.utils import add_to_date, get_datetime, now_datetime

from vunapos.services.kitchen_service import STATION, TICKET
from vunapos.services.restaurant_service import require_restaurant_access

JOB = "Kitchen Print Job"
PRINT_WORKER_ROLES = {
	"System Manager",
	"VunaPOS Restaurant Manager",
	"VunaPOS Kitchen User",
}
PRINT_ACTIONS = (
	"Cancel Items",
	"Stop Preparation",
	"Cancel Order",
	"Cancel Remake",
	"Update preparation notes",
)


@contextmanager
def writing():
	old = frappe.flags.get("kitchen_print_job_write")
	frappe.flags.kitchen_print_job_write = True
	try:
		yield
	finally:
		frappe.flags.kitchen_print_job_write = old


def _cashier_print_profile(pos_profile):
	from vunapos.services.floor_plan_service import require_restaurant_profile

	if not pos_profile:
		frappe.throw(
			_("A POS Profile is required for cashier printing."),
			frappe.PermissionError,
		)

	restaurant = require_restaurant_profile(pos_profile)
	profile = frappe.get_doc("POS Profile", pos_profile)

	if profile.get("disabled") or not profile.get("custom_run_kitchen_print_worker_on_pos"):
		frappe.throw(
			_("POS terminal printing is not enabled for this profile."),
			frappe.PermissionError,
		)

	return restaurant, profile


def station_access(name, pos_profile=None):
	doc = frappe.get_doc(STATION, name)
	require_restaurant_access(doc.restaurant, branch=doc.branch)
	doc.check_permission("read")
	roles = set(frappe.get_roles())

	if roles & PRINT_WORKER_ROLES:
		return doc

	if "VunaPOS Cashier" in roles:
		restaurant, profile = _cashier_print_profile(pos_profile)
		if doc.restaurant == restaurant and doc.branch == profile.vunapos_branch:
			return doc

	frappe.throw(
		_("Kitchen printing is not permitted for this station."),
		frappe.PermissionError,
	)
	return doc


def enqueue_ticket(doc, method=None):
	_enqueue(doc)


def enqueue_action(doc, method=None):
	if doc.action == "Cancel Remake" and doc.to_status != "Cancelled":
		return
	if doc.outcome == "Succeeded" and doc.action in PRINT_ACTIONS:
		frappe.publish_realtime(
			"vunapos_kitchen_action_saved",
			{"name": doc.name, "kitchen_station": doc.kitchen_station, "action": doc.action},
			doctype=STATION,
			docname=doc.kitchen_station,
			after_commit=True,
		)
		_enqueue(frappe.get_doc(TICKET, doc.kitchen_ticket), doc.name)


def _enqueue(ticket, action=None):
	station = frappe.get_doc(STATION, ticket.kitchen_station)
	if not station.enabled or station.get("output_mode") not in ("Printer", "Both"):
		return
	key = f"action:{action}" if action else f"ticket:{ticket.name}"
	# Source events are already unique. The database also enforces one job per source.
	if frappe.db.exists(JOB, {"source_key": key}):
		return
	kind = "NEW ORDER"
	if action:
		kind = (
			"MODIFIED INSTRUCTIONS"
			if frappe.db.get_value("Kitchen Ticket Action", action, "action") == "Update preparation notes"
			else "CANCELLATION"
		)
	elif ticket.get("remake_of"):
		kind = "REPLACEMENT"
	elif frappe.qb.get_query(
		TICKET,
		filters={
			"restaurant_session": ticket.restaurant_session,
			"sales_order": ["!=", ticket.sales_order],
			"docstatus": 1,
			"creation": ["<", ticket.creation],
		},
		fields=["name"],
		limit=1,
		for_update=True,
	).run():
		kind = "ADD-ON ROUND"
	with writing():
		frappe.get_doc(
			{
				"doctype": JOB,
				"source_key": key,
				"ticket_kind": kind,
				"kitchen_ticket": ticket.name,
				"kitchen_station": ticket.kitchen_station,
				"restaurant": ticket.restaurant,
				"branch": ticket.branch,
				"company": ticket.company,
				"action_event": action,
				"status": "Queued",
				"attempts": 0,
			}
		).insert(ignore_permissions=True)


def _save(doc, status, message=""):
	doc.status = status
	doc.last_error = str(message)[:500]
	history = frappe.parse_json(doc.delivery_history or "[]")
	history.append(
		dict(
			status=status,
			at=str(now_datetime()),
			actor=frappe.session.user,
			printer=doc.printer_name,
			message=doc.last_error,
		)
	)
	doc.delivery_history = json.dumps(history)
	with writing():
		doc.save(ignore_permissions=True)


def _recover_station(station):
	for row in frappe.get_all(
		JOB,
		filters={
			"kitchen_station": station,
			"status": ["in", ["Claimed", "Sending"]],
			"lease_until": ["<", now_datetime()],
		},
		pluck="name",
	):
		doc = frappe.get_doc(JOB, row, for_update=True)
		if doc.status in ("Claimed", "Sending") and get_datetime(doc.lease_until) < now_datetime():
			_save(
				doc,
				"Queued" if doc.status == "Claimed" else "Uncertain",
				"Terminal disconnected before confirmation. Review before retrying.",
			)
			doc.db_set("claim_token", None, update_modified=False)


def recover():
	# Locks match claim's station -> job order. No printing happens in the worker.
	for station in sorted(
		set(
			frappe.get_all(
				JOB,
				filters={"status": ["in", ["Claimed", "Sending"]], "lease_until": ["<", now_datetime()]},
				pluck="kitchen_station",
				limit=500,
			)
		)
	):
		frappe.db.get_value(STATION, station, "name", for_update=True)
		_recover_station(station)


def claim(station, pos_profile=None):
	config = station_access(station, pos_profile)
	if (
		not config.enabled
		or config.get("output_mode") not in ("Printer", "Both")
		or not config.get("printer_name")
	):
		frappe.throw(_("Configure an enabled station's printer before starting printing."))
	frappe.db.get_value(STATION, station, "name", for_update=True)
	_recover_station(station)
	# An unresolved job blocks later work: preserve corrections and cancellation order.
	rows = frappe.qb.get_query(
		JOB,
		filters={"kitchen_station": station, "status": ["!=", "Submitted"]},
		fields=["name", "status"],
		order_by="creation asc, name asc",
		limit=1,
		for_update=True,
	).run(as_dict=True)
	if not rows or rows[0].status != "Queued":
		return None
	doc = frappe.get_doc(JOB, rows[0].name, for_update=True)
	ticket = frappe.get_doc(TICKET, doc.kitchen_ticket)
	ticket.check_permission("read")
	ticket.check_permission("print")
	token = secrets.token_urlsafe(32)
	doc.claim_token = hashlib.sha256(token.encode()).hexdigest()
	doc.claimed_by = frappe.session.user
	doc.printer_name = config.printer_name
	doc.lease_until = add_to_date(now_datetime(), seconds=60)
	doc.attempts = (doc.attempts or 0) + 1
	_save(doc, "Claimed")
	return dict(name=doc.name, token=token, printer=doc.printer_name)


def _claimed(name, token, pos_profile=None):
	base = frappe.get_doc(JOB, name)
	station_access(base.kitchen_station, pos_profile)
	frappe.db.get_value(STATION, base.kitchen_station, "name", for_update=True)
	doc = frappe.get_doc(JOB, name, for_update=True)
	if (
		not token
		or not secrets.compare_digest(doc.claim_token or "", hashlib.sha256(token.encode()).hexdigest())
		or doc.claimed_by != frappe.session.user
	):
		frappe.throw(_("This delivery belongs to another terminal."), frappe.PermissionError)
	return doc


def release_claim(name, token, pos_profile=None):
	"""Release an owned claim only before dispatch."""
	doc = _claimed(name, token, pos_profile)
	if doc.status != "Claimed":
		frappe.throw(_("Only undispatched claims can be released."))

	doc.claim_token = None
	doc.lease_until = None
	_save(doc, "Queued", "Terminal released claim before dispatch.")


def dispatch(name, token, pos_profile=None):
	from vunapos.services.print_service import render_kitchen_ticket

	doc = _claimed(name, token, pos_profile)
	if doc.status != "Claimed" or get_datetime(doc.lease_until) < now_datetime():
		frappe.throw(_("Delivery claim expired. Refresh printing status."))
	try:
		payload = render_kitchen_ticket(
			doc.kitchen_ticket,
			action=doc.action_event,
			delivery=dict(name=doc.name, attempt=doc.attempts, kind=doc.ticket_kind),
		)
	except Exception:
		_save(doc, "Failed", "Ticket rendering failed. Review the ticket and print format before retrying.")
		return {"error": doc.last_error}
	doc.lease_until = add_to_date(now_datetime(), seconds=120)
	_save(doc, "Sending")
	return payload


def acknowledge(name, token, submitted=False, error=None, pos_profile=None):
	from frappe.utils import cint

	doc = _claimed(name, token, pos_profile)
	if doc.status == "Submitted":
		return
	if doc.status != "Sending":
		frappe.throw(_("This job is not awaiting a printer acknowledgement."))
	_save(doc, "Submitted" if cint(submitted) else "Uncertain", error or "")


def retry(name, reason):
	if not set(frappe.get_roles()) & {"System Manager", "VunaPOS Restaurant Manager"}:
		frappe.throw(_("A manager must review an uncertain delivery."), frappe.PermissionError)
	if not str(reason or "").strip():
		frappe.throw(_("Record why this delivery should be retried."))
	base = frappe.get_doc(JOB, name)
	station_access(base.kitchen_station)
	frappe.db.get_value(STATION, base.kitchen_station, "name", for_update=True)
	doc = frappe.get_doc(JOB, name, for_update=True)
	if doc.status not in ("Uncertain", "Failed"):
		frappe.throw(_("Only failed or uncertain deliveries can be retried."))
	doc.claim_token = None
	_save(doc, "Queued", reason)


def status(station, pos_profile=None):
	station_access(station, pos_profile)
	return frappe.get_list(
		JOB,
		filters={"kitchen_station": station},
		fields=["name", "kitchen_ticket", "action_event", "status", "attempts", "last_error"],
		order_by="creation desc",
		limit_page_length=30,
	)


def confirm_delivery(name, reason):
	"""Manager observed the existing paper copy: unblock without sending it again."""
	if not set(frappe.get_roles()) & {"System Manager", "VunaPOS Restaurant Manager"}:
		frappe.throw(_("A manager must review an uncertain delivery."), frappe.PermissionError)
	if not str(reason or "").strip():
		frappe.throw(_("Record how the existing print was confirmed."))
	base = frappe.get_doc(JOB, name)
	station_access(base.kitchen_station)
	frappe.db.get_value(STATION, base.kitchen_station, "name", for_update=True)
	doc = frappe.get_doc(JOB, name, for_update=True)
	if doc.status != "Uncertain":
		frappe.throw(_("Only uncertain deliveries need manual confirmation."))
	doc.claim_token = None
	_save(doc, "Submitted", "Manually confirmed: " + reason)


def _normalize_stations(stations):
	if isinstance(stations, str):
		stations = frappe.parse_json(stations) if stations.strip().startswith("[") else [stations]
	if not isinstance(stations, list) or not 1 <= len(stations) <= 100:
		frappe.throw(_("Select between 1 and 100 kitchen stations."))
	if any(not isinstance(name, str) or not name.strip() for name in stations):
		frappe.throw(_("Kitchen stations must be non-empty names."))
	return sorted(set(stations))


def claim_many(stations, pos_profile=None):
	names = _normalize_stations(stations)
	# Validate the whole request before claiming anything. Stable lock order avoids deadlocks.
	for name in names:
		station_access(name, pos_profile)
	for name in names:
		job = claim(name, pos_profile)
		if job:
			return job
	return None


def status_many(stations, pos_profile=None):
	names = _normalize_stations(stations)
	for name in names:
		station_access(name, pos_profile)
	# Fetch unresolved jobs first so recent successful jobs cannot hide a blocked queue.
	return frappe.get_list(
		JOB,
		filters={"kitchen_station": ["in", names], "status": ["in", ["Failed", "Uncertain"]]},
		fields=[
			"name",
			"kitchen_station",
			"kitchen_ticket",
			"ticket_kind",
			"status",
			"attempts",
			"last_error",
		],
		order_by="creation asc, name asc",
		limit_page_length=100,
	)


def configuration(pos_profile):
	from vunapos.services.floor_plan_service import require_restaurant_profile

	restaurant = require_restaurant_profile(pos_profile)
	profile = frappe.get_doc("POS Profile", pos_profile)
	require_restaurant_access(restaurant, branch=profile.vunapos_branch)
	roles = set(frappe.get_roles())
	can_print = bool(
		roles & PRINT_WORKER_ROLES
		or (
			"VunaPOS Cashier" in roles
			and not profile.get("disabled")
			and profile.get("custom_run_kitchen_print_worker_on_pos")
		)
	)
	stations = (
		frappe.get_list(
			STATION,
			filters={"restaurant": restaurant, "branch": profile.vunapos_branch, "enabled": 1},
			fields=["name", "station_name", "printer_name", "output_mode"],
			order_by="name",
			limit_page_length=100,
		)
		if can_print
		else []
	)
	return dict(
		stations=stations,
		can_print=can_print,
		can_manage=bool(roles & {"System Manager", "VunaPOS Restaurant Manager"}),
		user=frappe.session.user,
		run_on_pos=bool(profile.get("custom_run_kitchen_print_worker_on_pos")),
		signing_enabled=bool(frappe.conf.get("vunapos_qz_signing_enabled")),
	)


def all_day(pos_profile, station=None):
	from vunapos.services.kitchen_lifecycle_service import list_board

	totals = {}
	# Reuse the board's permission and quantity projection, including saved progress.
	# Bound work explicitly; callers must display the partial flag if the cap is reached.
	for start in range(0, 1000, 100):
		board = list_board(pos_profile, station=station, start=start)
		for ticket in board["tickets"]:
			if ticket.status not in ("Sent", "Accepted", "Preparing"):
				continue
			for item in ticket.get("items"):
				remaining = max(0, item["qty"] - item.get("ready_qty", 0) - item.get("cancelled_qty", 0))
				if not remaining:
					continue
				key = (item["item_code"], item["uom"])
				row = totals.setdefault(
					key, dict(item_code=key[0], uom=key[1], item_name=item["item_name"], remaining=0)
				)
				row["remaining"] += remaining
		if not board["has_more"]:
			break
	return dict(items=sorted(totals.values(), key=lambda row: -row["remaining"]), partial=board["has_more"])
