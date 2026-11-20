"""Self-service kiosk orders on a Restaurant POS Profile with Kiosk Mode ticked.

A kiosk login builds an order like a waiter would, then checks out: one request opens
a Restaurant Session with a short daily order number and saves its Sales Order round.

With "Pay at the counter first" the round stays a draft and the session is Awaiting
Payment. A cashier confirms the payment in one request: the draft is submitted, which
sends it to the kitchen, and the visit is billed with the payment. The paid visit
keeps its table until staff clear it. With "Bill at the end" the round is submitted
at once and the visit is billed through the normal session checkout.

The kiosk role may create and read its own Sales Orders but not write or submit them,
so this module submits rounds in server code after its own checks.
"""

import hashlib

import frappe
from frappe import _
from frappe.model.naming import getseries
from frappe.utils import cint, cstr, now_datetime, nowdate

from vunapos.services.floor_plan_service import get_floor_plan, is_floor_plan_manager
from vunapos.services.kitchen_service import fail
from vunapos.services.pin_service import consume_pin_token
from vunapos.services.print_service import KIOSK_ORDER_SLIP
from vunapos.services.profile_service import require_restaurant_staff_shift, resolve_pos_profile
from vunapos.services.restaurant_service import (
	kiosk_floors,
	kiosk_payment_timing,
	require_restaurant_access,
)
from vunapos.services.restaurant_session_service import (
	KIOSK_AWAITING_PAYMENT,
	KIOSK_PAID,
	KIOSK_SENT_TO_KITCHEN,
	SESSION,
	SOURCE_KIOSK,
	TABLE_HOLDING_STATUSES,
	_load,
	cancel_unsent_visit,
	create_round,
	lock_tables,
	open_session_doc,
	session_to_dict,
	submit_draft_rounds,
)
from vunapos.services.service_type_service import get_profile_service_types
from vunapos.setup.utils import CASHIER_ROLE, KIOSK_PAY_FIRST, KIOSK_ROLE, RESTAURANT_MANAGER_ROLE

MAX_NOTE_LENGTH = 500


def _permission_error(code, message):
	exc = frappe.PermissionError(message)
	exc.vuna_error_code = code
	raise exc


def require_kiosk(pos_profile):
	"""The signed-in kiosk device and its kiosk POS Profile."""
	if KIOSK_ROLE not in frappe.get_roles():
		_permission_error("KIOSK_ROLE_REQUIRED", _("Only a kiosk login can place kiosk orders."))
	profile = resolve_pos_profile(pos_profile)
	if profile.get("vunapos_pos_mode") != "Restaurant" or not cint(profile.get("vunapos_kiosk_mode")):
		fail("KIOSK_MODE_OFF", _("POS Profile {0} is not set up as a kiosk.").format(profile.name))
	require_restaurant_access(profile.vunapos_restaurant, branch=profile.vunapos_branch)
	return profile


def kiosk_service_types(profile):
	selected = {row.service_type for row in profile.get("vunapos_kiosk_service_types") or []}
	return [row for row in get_profile_service_types(profile) if row["name"] in selected]


def _occupied_tables(tables):
	"""The same occupancy rule as lock_tables, without exposing who holds a table.

	Maps each taken table to "Paid" (a settled visit waiting to be cleared) or "Occupied".
	"""
	if not tables:
		return {}
	assignments = frappe.get_all(
		"Restaurant Session Table",
		filters={"parenttype": SESSION, "table": ["in", tables], "released_at": ["is", "not set"]},
		fields=["table", "parent"],
	)
	holding = {
		row.name: row.status
		for row in frappe.get_all(
			SESSION,
			filters={
				"name": ["in", list({row.parent for row in assignments}) or [""]],
				"status": ["in", TABLE_HOLDING_STATUSES],
			},
			fields=["name", "status"],
		)
	}
	occupied = {
		row.table: "Paid" if holding[row.parent] == "Settled" else "Occupied"
		for row in assignments
		if row.parent in holding
	}
	for table in frappe.get_all(
		"Sales Order",
		filters={
			"vunapos_restaurant_table": ["in", tables],
			"docstatus": 1,
			"status": ["!=", "Closed"],
			"per_billed": ["<", 100],
			"vunapos_billing_invoice": ["is", "not set"],
			"vunapos_restaurant_session": ["is", "not set"],
		},
		pluck="vunapos_restaurant_table",
	):
		occupied.setdefault(table, "Occupied")
	return occupied


def get_setup(pos_profile):
	"""Service types, the floors this kiosk serves, and whether each table is free."""
	profile = require_kiosk(pos_profile)
	floors = kiosk_floors(profile)
	plan = get_floor_plan(profile.name)
	plan["floors"] = [floor for floor in plan["floors"] if not floors or floor["name"] in floors]
	tables = [table for floor in plan["floors"] for table in floor["tables"]]
	occupied = _occupied_tables([table["name"] for table in tables])
	return {
		"service_types": kiosk_service_types(profile),
		"payment_timing": kiosk_payment_timing(profile),
		"floor_plan": plan,
		"tables": [
			{
				"table": table["name"],
				"table_label": table["table_label"],
				"floor": table["floor"],
				"seats": table["seats"],
				"status": occupied.get(table["name"], "Free"),
				"session": None,
				"orders": [],
			}
			for table in tables
		],
	}


def next_order_number(branch, date):
	"""1, 2, 3... for each branch and day. Rolled back with an order that fails."""
	# Serialize the day's first order: two first INSERTs of the counter would collide.
	frappe.db.get_value("Branch", branch, "name", for_update=True)
	key = "vunapos-kiosk-{}-{}".format(hashlib.sha1(branch.encode()).hexdigest()[:12], date.replace("-", ""))
	return cint(getseries(key, 1))


def _clean_note(note):
	note = cstr(note).strip()
	if len(note) > MAX_NOTE_LENGTH:
		fail("NOTE_TOO_LONG", _("Keep the note under {0} characters.").format(MAX_NOTE_LENGTH))
	return note or None


def _result(session):
	doc = frappe.get_doc(SESSION, session)
	order = frappe.get_all(
		"Sales Order",
		filters={"vunapos_restaurant_session": session, "docstatus": ["!=", 2]},
		fields=["name", "grand_total", "rounded_total", "currency"],
		order_by="creation asc",
		limit=1,
	)[0]
	table = next((row.table for row in doc.tables if not row.released_at), None)
	return {
		"session": doc.name,
		"order_number": cint(doc.order_number),
		"kiosk_status": doc.kiosk_status,
		"service_type": doc.service_type,
		"table": table,
		"table_label": frappe.db.get_value("Restaurant Table", table, "table_label") if table else None,
		"sales_order": order.name,
		"grand_total": order.grand_total,
		"rounded_total": order.rounded_total,
		"currency": order.currency,
		"print_format": KIOSK_ORDER_SLIP,
	}


def place_order(pos_profile, service_type, items, idempotency_key, table=None, order_note=None):
	"""Checkout: open the visit and place its only round in one transaction."""
	from vunapos.services.restaurant_stock_service import validate_cart

	profile = require_kiosk(pos_profile)
	key = cstr(idempotency_key).strip()
	if not key:
		fail("IDEMPOTENCY_REQUIRED", _("An idempotency key is required to place a kiosk order."))
	session_key = f"kiosk:{key}"
	existing = frappe.db.get_value(SESSION, {"idempotency_key": session_key}, "name")
	if existing and frappe.db.exists(
		"Sales Order", {"vunapos_restaurant_session": existing, "docstatus": ["!=", 2]}
	):
		return _result(existing)

	offered = {row["name"]: row for row in kiosk_service_types(profile)}
	if service_type not in offered:
		fail("SERVICE_TYPE_NOT_ALLOWED", _("Choose a service type this kiosk offers."))
	if offered[service_type]["requires_table"] and not table:
		fail("TABLE_REQUIRED", _("Choose your table."))
	tables = [table] if table and offered[service_type]["requires_table"] else []
	if tables and not existing:
		# Fail fast with a friendly message before any stock or pricing work.
		lock_tables(tables, profile.vunapos_restaurant, branch=profile.vunapos_branch)
	# Stock is checked as for any order. A draft reserves it only when payment is confirmed.
	validate_cart(
		profile.name, service_type, items, table=tables[0] if tables else None, customer=profile.customer
	)

	pay_first = kiosk_payment_timing(profile) == KIOSK_PAY_FIRST
	values = {
		"kiosk_status": KIOSK_AWAITING_PAYMENT if pay_first else KIOSK_SENT_TO_KITCHEN,
		"order_source": SOURCE_KIOSK,
	}
	if not existing:
		values["order_date"] = nowdate()
		values["order_number"] = next_order_number(profile.vunapos_branch, values["order_date"])
	session = open_session_doc(
		profile.name,
		session_key,
		tables=tables,
		service_type=service_type,
		customer=profile.customer,
		values=values,
	)
	create_round(
		session.name,
		items,
		f"kiosk-round:{key}",
		order_note=_clean_note(order_note),
		pos_profile=profile.name,
		draft=True,
	)
	if not pay_first:
		submit_draft_rounds(session.name, profile)
	return _result(session.name)


def _require_till(pos_profile, session):
	till = resolve_pos_profile(pos_profile)
	if (till.get("vunapos_restaurant"), till.get("vunapos_branch")) != (session.restaurant, session.branch):
		fail("SESSION_CONTEXT_MISMATCH", _("Choose a till of this kiosk order's restaurant branch."))
	return till


def confirm_payment(session, pos_profile, fingerprint, payments=None, **options):
	"""The cashier takes the payment: send the order to the kitchen and bill it, all or nothing.

	The reviewed bill's fingerprint is checked before anything is submitted. Any later
	failure rolls the whole request back, so the order stays a draft awaiting payment.
	"""
	from vunapos.services.restaurant_billing_service import (
		_build,
		_orders,
		_review_fingerprint,
		checkout,
	)

	if CASHIER_ROLE not in frappe.get_roles():
		_permission_error("KIOSK_CONFIRM_NOT_ALLOWED", _("Only a cashier can confirm a kiosk payment."))
	doc = _load(session, for_update=True)
	till = _require_till(pos_profile, doc)
	require_restaurant_staff_shift(till.name)
	if doc.kiosk_status == KIOSK_PAID:
		# A retry after success returns the visit's existing bill.
		return checkout(doc.name, till.name, fingerprint, payments, **options)
	if doc.kiosk_status != KIOSK_AWAITING_PAYMENT:
		fail("NOT_A_KIOSK_ORDER", _("This is not a kiosk order awaiting payment."))
	if doc.status != "Open":
		fail("SESSION_NOT_OPEN", _("This kiosk order is no longer open."))
	orders = _orders(doc, lock=True)
	if not fingerprint or fingerprint != _review_fingerprint(
		orders, _build(doc, till, orders, options.get("loyalty_points"))
	):
		fail(
			"SESSION_BILL_CHANGED",
			_("The order changed since this bill was reviewed. Refresh the bill before taking payment."),
		)
	doc.update(
		{"kiosk_status": KIOSK_PAID, "confirmed_by": frappe.session.user, "confirmed_at": now_datetime()}
	)
	doc.flags.restaurant_session_write = True
	doc.save()
	submit_draft_rounds(doc.name, frappe.get_cached_doc("POS Profile", doc.pos_profile))
	return checkout(doc.name, till.name, fingerprint, payments, **options)


def cancel_order(session, reason, pos_profile, manager_pin_token=None):
	"""Cancel a kiosk order nobody paid for, freeing its table. Nothing reached the kitchen."""
	from vunapos.services.restaurant_payment_service import guard_order_change

	if not set(frappe.get_roles()) & {CASHIER_ROLE, RESTAURANT_MANAGER_ROLE, "System Manager"}:
		_permission_error(
			"KIOSK_CANCEL_NOT_ALLOWED", _("Only a cashier or a manager can cancel a kiosk order.")
		)
	doc = _load(session, for_update=True)
	till = _require_till(pos_profile, doc)
	if doc.kiosk_status != KIOSK_AWAITING_PAYMENT or doc.status != "Open":
		fail(
			"KIOSK_ORDER_NOT_CANCELLABLE",
			_(
				"Only an unpaid kiosk order can be cancelled here. Cancel orders sent to the kitchen from their ticket."
			),
		)
	reason = _clean_note(reason)
	if not reason:
		fail("CANCEL_REASON_REQUIRED", _("Enter a reason for cancelling the order"))
	# A payment started from Confirm payment must be resolved first, as for any order.
	guard_order_change(doc)
	# The same rule as cancelling any restaurant order, from the cancelling till.
	approved_by = None
	if cint(till.get("vunapos_require_manager_pin_order_cancel")) and not is_floor_plan_manager():
		approved_by = consume_pin_token(manager_pin_token, till, "manager_order_cancel").get("subject")
	cancel_unsent_visit(doc, reason, "Kiosk order cancelled", approved_by)
	return session_to_dict(doc)
