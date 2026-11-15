"""Durable command receipts, committed atomically with restaurant commands.

Callers must hold the POS Profile lock (opening) or Session lock (rounds).
Receipts are not a second order ledger: they only identify the native result.
"""

import hashlib
import json
import math

import frappe
from frappe import _


def fail(code, message):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	raise exc


def request_key(value):
	key = str(value or "").strip()
	if not key or len(key) > 140:
		fail("IDEMPOTENCY_REQUIRED", _("Use an order request key of 1 to 140 characters."))
	return key


def parsed(value):
	return frappe.parse_json(value) if isinstance(value, str) else value


def _canonical(value):
	if isinstance(value, dict):
		return {key: _canonical(item) for key, item in value.items()}
	if isinstance(value, list):
		return [_canonical(item) for item in value]
	if isinstance(value, (int, float)) and not isinstance(value, bool):
		if not math.isfinite(value):
			fail("INVALID_REQUEST", _("Order quantities must be finite numbers."))
		return float(value)
	return value


def fingerprint(payload):
	encoded = json.dumps(_canonical(payload), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
	return hashlib.sha256(encoded.encode()).hexdigest()


def receipt_name(action, key):
	return hashlib.sha256(f"{action}:{request_key(key)}".encode()).hexdigest()


def find(action, key, for_update=True):
	return frappe.db.get_value(
		"Restaurant Request",
		receipt_name(action, key),
		["pos_profile", "fingerprint", "reference_name", "owner"],
		as_dict=True,
		for_update=for_update,
	)


def replay(action, key, profile, payload, for_update=True):
	receipt = find(action, key, for_update=for_update)
	if not receipt:
		return None
	if receipt.owner != frappe.session.user:
		frappe.throw(_("This restaurant request belongs to another user."), frappe.PermissionError)
	if receipt.pos_profile != profile or receipt.fingerprint != fingerprint(payload):
		fail(
			"IDEMPOTENCY_CONFLICT",
			_(
				"This request was already used for a different order. Recover the original order before making changes."
			),
		)
	return receipt.reference_name


def record(action, key, profile, payload, reference_doctype, reference_name, details=None):
	doc = frappe.get_doc(
		{
			"doctype": "Restaurant Request",
			"name": receipt_name(action, key),
			"action": action,
			"pos_profile": profile,
			"fingerprint": fingerprint(payload),
			"reference_doctype": reference_doctype,
			"reference_name": reference_name,
			"details": details,
		}
	)
	doc.flags.restaurant_request_write = True
	doc.insert(ignore_permissions=True)


def round_payload(session, profile, items, order_note, kitchen_routing):
	return {
		"session": session,
		"pos_profile": profile,
		"items": parsed(items),
		"order_note": order_note or "",
		"kitchen_routing": parsed(kitchen_routing) or {},
	}
