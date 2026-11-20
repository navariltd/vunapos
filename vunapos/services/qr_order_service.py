"""Guests order from their phone by scanning a table's QR code.

A table's code carries a secret token. A guest who scans it sends one order for that
table, which opens the table's visit with a draft Sales Order round: nothing reaches the
kitchen yet. Staff accept the order, which submits the draft (kitchen tickets and stock
reservations, then the normal waiter flow, billed at the end), or reject it, which
deletes the draft, cancels the visit and frees the table.

Guests never sign in. The guest actions find the table by its token, then act as the
QR ordering user of the branch's QR profile: a disabled user with the VunaPOS Kiosk
role, so every existing access check and order right applies unchanged. Only one POS
Profile per restaurant branch has QR Table Ordering switched on.
"""

import hmac
import io
import secrets
from contextlib import contextmanager

import frappe
import pyqrcode
from frappe import _
from frappe.utils import cint, cstr, get_url, now_datetime

from vunapos.services.floor_plan_service import (
	TABLE_DOCTYPE,
	require_floor_plan_manager,
	require_restaurant_profile,
)
from vunapos.services.kiosk_service import _clean_note, _occupied_tables
from vunapos.services.kitchen_service import fail
from vunapos.services.profile_service import require_restaurant_staff_shift, resolve_pos_profile
from vunapos.services.restaurant_service import require_restaurant_access
from vunapos.services.restaurant_session_service import (
	QR_ACCEPTED,
	QR_PENDING,
	QR_REJECTED,
	SESSION,
	SOURCE_QR,
	_load,
	cancel_unsent_visit,
	create_round,
	lock_tables,
	open_session_doc,
	session_to_dict,
	submit_draft_rounds,
)
from vunapos.setup.utils import CASHIER_ROLE, RESTAURANT_MANAGER_ROLE, WAITER_ROLE

STAFF_ROLES = {WAITER_ROLE, CASHIER_ROLE, RESTAURANT_MANAGER_ROLE, "System Manager"}
MAX_TABLES_PER_PRINT = 500
CARD_TEMPLATE = "vunapos/templates/qr_table_cards.html"


def _permission_error(code, message):
	exc = frappe.PermissionError(message)
	exc.vuna_error_code = code
	raise exc


def get_qr_profile(restaurant, branch):
	"""The enabled POS Profile with QR Table Ordering for a restaurant branch, if any."""
	name = frappe.db.get_value(
		"POS Profile",
		{
			"vunapos_pos_mode": "Restaurant",
			"vunapos_restaurant": restaurant,
			"vunapos_branch": branch,
			"vunapos_qr_ordering": 1,
			"disabled": 0,
		},
		"name",
	)
	return frappe.get_cached_doc("POS Profile", name) if name else None


def table_url(token):
	return get_url(f"/vunapos/table/{token}")


def _invalid_code():
	fail("QR_CODE_INVALID", _("This QR code is not valid. Please ask a waiter."))


def _table_for_token(token):
	token = cstr(token).strip()
	if not 20 <= len(token) <= 100:
		_invalid_code()
	rows = frappe.get_all(
		TABLE_DOCTYPE,
		filters={"qr_token": token},
		fields=["name", "qr_token", "table_label", "floor", "restaurant", "branch", "is_active"],
		limit=1,
	)
	if not rows or not hmac.compare_digest(cstr(rows[0].qr_token), token) or not cint(rows[0].is_active):
		_invalid_code()
	return rows[0]


def _require_guest():
	# Switching a signed-in request to the QR user would overwrite that user's session
	# when Frappe saves it after the response. The guest page never sends cookies.
	if frappe.session.user != "Guest":
		_permission_error("QR_GUEST_ONLY", _("Sign out, or open this link in a private window, to order."))


def _guest_context(token):
	_require_guest()
	table = _table_for_token(token)
	profile = get_qr_profile(table.restaurant, table.branch)
	if not profile or not profile.get("vunapos_qr_user"):
		fail("QR_ORDERING_OFF", _("Ordering from this QR code is switched off. Please ask a waiter."))
	return table, profile


@contextmanager
def as_qr_user(token):
	"""Run a guest action as the table's QR ordering user, then return to Guest."""
	table, profile = _guest_context(token)
	# Only ever on a Guest request (checked above), and always switched back to Guest below.
	frappe.set_user(profile.vunapos_qr_user)  # nosemgrep: frappe-setuser -- the branch's disabled QR user
	frappe.flags.vunapos_qr_request = True
	try:
		yield table, profile
	finally:
		frappe.flags.vunapos_qr_request = False
		frappe.set_user("Guest")  # nosemgrep: frappe-setuser -- restores the Guest request's own user


def _table_has_order():
	fail("TABLE_HAS_ORDER", _("This table already has an order. Please ask a waiter to add items."))


def get_table_order(token):
	"""What the guest page needs to start: never customer, visit or staff data."""
	table, profile = _guest_context(token)
	restaurant_name = frappe.db.get_value("Restaurant", table.restaurant, "restaurant_name")
	return {
		"restaurant_name": restaurant_name or table.restaurant,
		"table_label": table.table_label,
		"floor_name": frappe.db.get_value("Restaurant Floor", table.floor, "floor_name"),
		"service_type": profile.vunapos_qr_service_type,
		"currency": profile.get("currency"),
		"state": "occupied" if _occupied_tables([table.name]) else "available",
	}


def get_table_menu(token, query=None):
	from vunapos.services.menu_service import get_menu

	with as_qr_user(token) as (table, profile):
		return get_menu(
			profile.name,
			service_type=profile.vunapos_qr_service_type,
			table=table.name,
			query=query,
			customer=profile.customer,
		)


def _guest_result(session):
	row = frappe.db.get_value(SESSION, session, ["qr_guest_ref", "qr_status"], as_dict=True)
	return {"order": row.qr_guest_ref, "status": row.qr_status}


def place_order(token, items, idempotency_key, order_note=None):
	"""Open the table's visit with one draft round, waiting for staff to accept it."""
	from vunapos.services.restaurant_stock_service import validate_cart

	with as_qr_user(token) as (table, profile):
		key = cstr(idempotency_key).strip()
		if not key or len(key) > 100:
			fail("IDEMPOTENCY_REQUIRED", _("An idempotency key is required to send an order."))
		session_key = f"qr:{table.name}:{key}"
		existing = frappe.db.get_value(SESSION, {"idempotency_key": session_key}, "name")
		if existing and frappe.db.exists(
			"Sales Order", {"vunapos_restaurant_session": existing, "docstatus": ["!=", 2]}
		):
			return _guest_result(existing)
		if not existing:
			# A QR order only starts on a free table, whoever holds it.
			if _occupied_tables([table.name]):
				_table_has_order()
			try:
				lock_tables([table.name], table.restaurant, branch=table.branch)
			except frappe.ValidationError as exc:
				if getattr(exc, "vuna_error_code", None) == "TABLE_OCCUPIED":
					_table_has_order()
				raise
		service_type = profile.vunapos_qr_service_type
		validate_cart(profile.name, service_type, items, table=table.name, customer=profile.customer)
		session = open_session_doc(
			profile.name,
			session_key,
			tables=[table.name],
			service_type=service_type,
			customer=profile.customer,
			values={
				"order_source": SOURCE_QR,
				"qr_status": QR_PENDING,
				"qr_guest_ref": secrets.token_urlsafe(24),
			},
		)
		create_round(
			session.name,
			items,
			f"qr-round:{table.name}:{key}",
			order_note=_clean_note(order_note),
			pos_profile=profile.name,
			draft=True,
		)
		return _guest_result(session.name)


def get_order_status(token, order):
	"""Pending, Accepted or Rejected, for the guest who sent the order."""
	_require_guest()
	table = _table_for_token(token)
	order = cstr(order).strip()
	session = (
		frappe.db.get_value(
			SESSION, {"qr_guest_ref": order}, ["name", "qr_guest_ref", "qr_status"], as_dict=True
		)
		if order
		else None
	)
	if (
		not session
		or not hmac.compare_digest(cstr(session.qr_guest_ref), order)
		or not frappe.db.exists(
			"Restaurant Session Table", {"parent": session.name, "parenttype": SESSION, "table": table.name}
		)
	):
		fail("QR_ORDER_NOT_FOUND", _("This order could not be found. Please ask a waiter."))
	return {"order": order, "status": session.qr_status}


def _require_till(pos_profile, session):
	till = resolve_pos_profile(pos_profile)
	if (till.get("vunapos_restaurant"), till.get("vunapos_branch")) != (session.restaurant, session.branch):
		fail("SESSION_CONTEXT_MISMATCH", _("Choose a till of this order's restaurant branch."))
	return till


def _require_qr_staff():
	if not set(frappe.get_roles()) & STAFF_ROLES:
		_permission_error("QR_ACTION_NOT_ALLOWED", _("Only restaurant staff can accept or reject QR orders."))


def _pending_qr_visit(session, pos_profile):
	_require_qr_staff()
	doc = _load(session, for_update=True)
	till = _require_till(pos_profile, doc)
	if doc.get("order_source") != SOURCE_QR or not doc.get("qr_status"):
		fail("NOT_A_QR_ORDER", _("This is not a QR order."))
	return doc, till


def accept_order(session, pos_profile):
	"""Send a guest's QR order to the kitchen. The accepting staff member becomes its waiter."""
	doc, till = _pending_qr_visit(session, pos_profile)
	if doc.qr_status == QR_ACCEPTED:
		return session_to_dict(doc)
	if doc.qr_status != QR_PENDING or doc.status != "Open":
		fail("QR_ORDER_NOT_PENDING", _("This QR order was already handled."))
	require_restaurant_staff_shift(till.name)
	doc.update(
		{
			"qr_status": QR_ACCEPTED,
			"accepted_by": frappe.session.user,
			"accepted_at": now_datetime(),
			"waiter": frappe.session.user,
		}
	)
	doc.flags.restaurant_session_write = True
	doc.save()
	submit_draft_rounds(doc.name, frappe.get_cached_doc("POS Profile", doc.pos_profile))
	doc.reload()
	return session_to_dict(doc)


def reject_order(session, reason, pos_profile):
	"""Delete a guest's QR order before it reaches the kitchen, and free its table."""
	doc, _till = _pending_qr_visit(session, pos_profile)
	if doc.qr_status == QR_REJECTED:
		return session_to_dict(doc)
	if doc.qr_status != QR_PENDING or doc.status != "Open":
		fail("QR_ORDER_NOT_PENDING", _("This QR order was already handled."))
	reason = _clean_note(reason)
	if not reason:
		fail("REJECT_REASON_REQUIRED", _("Enter a reason for rejecting the order."))
	doc.qr_status = QR_REJECTED
	cancel_unsent_visit(doc, reason, "QR order rejected")
	return session_to_dict(doc)


def _manager_context(pos_profile):
	require_floor_plan_manager()
	profile = resolve_pos_profile(pos_profile)
	restaurant = require_restaurant_profile(profile.name)
	require_restaurant_access(restaurant, branch=profile.vunapos_branch)
	return restaurant, profile.vunapos_branch


def _require_qr_on(restaurant, branch):
	if not get_qr_profile(restaurant, branch):
		fail(
			"QR_ORDERING_OFF",
			_("Switch on QR Table Ordering on a POS Profile of this restaurant branch first."),
		)


def get_qr_tables(pos_profile):
	"""The branch's active tables by floor, and whether each has a code. Never the tokens."""
	restaurant, branch = _manager_context(pos_profile)
	qr_profile = get_qr_profile(restaurant, branch)
	floors = frappe.get_all(
		"Restaurant Floor",
		filters={"restaurant": restaurant, "branch": branch, "is_active": 1},
		fields=["name", "floor_name"],
		order_by="display_order asc, creation asc",
	)
	tables = frappe.get_all(
		TABLE_DOCTYPE,
		filters={"floor": ["in", [floor.name for floor in floors] or [""]], "is_active": 1},
		fields=["name", "table_label", "floor", "qr_token", "qr_token_created_at"],
		order_by="table_label asc",
	)
	return {
		"enabled": bool(qr_profile),
		"qr_profile": qr_profile.name if qr_profile else None,
		"floors": [
			{
				"name": floor.name,
				"floor_name": floor.floor_name,
				"tables": [
					{
						"table": table.name,
						"table_label": table.table_label,
						"has_code": bool(table.qr_token),
						"code_created_at": table.qr_token_created_at,
					}
					for table in tables
					if table.floor == floor.name
				],
			}
			for floor in floors
		],
	}


def _branch_tables(restaurant, branch, tables):
	if isinstance(tables, str):
		tables = frappe.parse_json(tables)
	if not isinstance(tables, list) or not tables or len(tables) > MAX_TABLES_PER_PRINT:
		fail("INVALID_TABLES", _("Choose between 1 and {0} tables.").format(MAX_TABLES_PER_PRINT))
	rows = frappe.get_all(
		TABLE_DOCTYPE,
		filters={
			"name": ["in", list(set(tables))],
			"restaurant": restaurant,
			"branch": branch,
			"is_active": 1,
		},
		fields=["name", "table_label", "floor", "qr_token"],
	)
	if len(rows) != len(set(tables)):
		fail("TABLE_NOT_FOUND", _("Some of these tables are not active tables of this restaurant branch."))
	order = {name: index for index, name in enumerate(tables)}
	return sorted(rows, key=lambda row: order[row.name])


def _set_token(table):
	token = secrets.token_urlsafe(32)
	frappe.db.set_value(
		TABLE_DOCTYPE,
		table,
		{
			"qr_token": token,
			"qr_token_created_at": now_datetime(),
			"qr_token_created_by": frappe.session.user,
		},
	)
	return token


def _qr_svg(url):
	stream = io.BytesIO()
	pyqrcode.create(url, error="M").svg(stream, scale=1, xmldecl=False, omithw=True, quiet_zone=2)
	return stream.getvalue().decode()


def print_cards(pos_profile, tables):
	"""The cards of these tables, one A6 card per page. A table gets its code the first time."""
	restaurant, branch = _manager_context(pos_profile)
	_require_qr_on(restaurant, branch)
	rows = _branch_tables(restaurant, branch, tables)
	floors = dict(
		frappe.get_all(
			"Restaurant Floor",
			filters={"name": ["in", list({row.floor for row in rows})]},
			fields=["name", "floor_name"],
			as_list=True,
		)
	)
	company, restaurant_name = frappe.db.get_value("Restaurant", restaurant, ["company", "restaurant_name"])
	cards = []
	for row in rows:
		token = row.qr_token or _set_token(row.name)
		cards.append(
			{
				"floor_name": floors.get(row.floor) or row.floor,
				"table_label": row.table_label,
				"qr_svg": _qr_svg(table_url(token)),
			}
		)
	html = frappe.render_template(  # nosemgrep: frappe-ssti -- a fixed app template path, values escaped
		CARD_TEMPLATE,
		is_path=True,
		context={
			"cards": cards,
			"restaurant_name": restaurant_name or restaurant,
			"logo": frappe.db.get_value("Company", company, "company_logo"),
		},
	)
	return {"html": html}


def regenerate_code(pos_profile, table):
	"""A new code for the table. Its old printed code stops working."""
	restaurant, branch = _manager_context(pos_profile)
	_require_qr_on(restaurant, branch)
	row = _branch_tables(restaurant, branch, [table])[0]
	_set_token(row.name)
	return {"table": row.name, "has_code": True}
