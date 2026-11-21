"""Append-only preparation corrections; never rewrite a submitted order snapshot."""

import hashlib
import json

import frappe
from frappe.utils import strip_html

ACTION = "Update preparation notes"


def current_notes(ticket, for_update=False):
	result = {}
	for row in frappe.qb.get_query(
		"Kitchen Ticket Action",
		filters={"kitchen_ticket": ticket, "action": ACTION, "outcome": "Succeeded"},
		fields=["item_quantities"],
		order_by="creation asc, name asc",
		for_update=for_update,
	).run(as_dict=True):
		payload = frappe.parse_json(row.item_quantities or "{}")
		result[payload["line_id"]] = payload["after"]
	return result


def update_preparation_notes(ticket, line_id, note, expected_note, request_key):
	from vunapos.services.kitchen_lifecycle_service import (
		CASHIER_ROLE,
		MANAGERS,
		WAITER_ROLE,
		_order,
		_publish,
		_record,
		_replay,
		_request_key,
		_ticket,
	)

	if not set(frappe.get_roles()) & (MANAGERS | {WAITER_ROLE, CASHIER_ROLE}):
		frappe.throw("Only restaurant staff can change preparation instructions.", frappe.PermissionError)
	if not isinstance(note, str) or len(note) > 1000:
		frappe.throw("Preparation notes must be text up to 1000 characters.")
	note = strip_html(note).strip()
	doc = _ticket(ticket, lock=True)
	key = _request_key(request_key)
	fingerprint = hashlib.sha256(json.dumps([line_id, note, expected_note]).encode()).hexdigest()
	if _replay(doc, ACTION, key, reason="Preparation instructions updated", request_fingerprint=fingerprint):
		return
	order = _order(doc)
	order.check_permission("write")
	if doc.status in ("Cancelled", "Ready", "Served", "Completed"):
		frappe.throw("Finished or cancelled tickets require the existing remake workflow.")
	row = next((row for row in doc.items if row.line_id == line_id), None)
	if row is None:
		frappe.throw("Select an item belonging to this ticket.")
	from vunapos.services.kitchen_progress_service import load

	progress = load([doc], for_update=True)[doc.name][line_id]
	if progress.get("ready_qty", 0) > 0 or progress.get("cancelled_qty", 0) >= row.qty:
		frappe.throw("Prepared or fully cancelled items cannot receive new preparation notes.")
	before = current_notes(doc.name, for_update=True).get(line_id, row.note or "")
	if before != expected_note:
		frappe.throw("Preparation notes changed on another terminal. Refresh before editing.")
	if before == note:
		return
	_record(
		doc,
		ACTION,
		key,
		doc.status,
		request_fingerprint=fingerprint,
		quantities=dict(line_id=line_id, before=before, after=note),
		reason="Preparation instructions updated",
	)
	_publish(doc)
