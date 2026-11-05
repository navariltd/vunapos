"""A dining visit owns table occupancy; ERPNext Sales Orders own commercial rounds."""

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

from vunapos.services.floor_plan_service import require_restaurant_profile
from vunapos.services.profile_service import require_restaurant_staff_shift, resolve_pos_profile
from vunapos.services.restaurant_service import require_restaurant_access, require_restaurant_context
from vunapos.services.service_type_service import get_default_service_type, resolve_service_type

SESSION = "Restaurant Session"
ACTIVE_STATUSES = ("Open", "Settling")


def current_assignments(table):
	assignment = frappe.qb.DocType("Restaurant Session Table")
	return (
		frappe.qb.from_(assignment)
		.select(assignment.parent)
		.where((assignment.table == table) & assignment.released_at.isnull())
		.for_update()
		.run(as_dict=True)
	)


def current_legacy_orders(table):
	order = frappe.qb.DocType("Sales Order")
	return (
		frappe.qb.from_(order)
		.select(order.name, order.vunapos_restaurant_session)
		.where(
			(order.vunapos_restaurant_table == table)
			& (order.docstatus == 1)
			& (order.status != "Closed")
			& (order.per_billed < 100)
			& (order.vunapos_billing_invoice.isnull() | (order.vunapos_billing_invoice == ""))
			& (order.vunapos_restaurant_session.isnull() | (order.vunapos_restaurant_session == ""))
		)
		.for_update()
		.run(as_dict=True)
	)


def _fail(code, message):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	raise exc


def validate_session(doc):
	if not doc.flags.restaurant_session_write:
		_fail("SESSION_MANAGED_OPERATION", _("Manage Restaurant Sessions through the restaurant actions."))
	if cint(doc.guest_count) < 0:
		_fail("INVALID_PAX", _("Guests cannot be negative."))
	profile = frappe.get_cached_doc("POS Profile", doc.pos_profile)
	restaurant = profile.vunapos_restaurant
	context = require_restaurant_context(restaurant, profile.company)
	if (doc.restaurant, doc.branch, doc.company) != (restaurant, context.branch, profile.company):
		_fail("SESSION_CONTEXT_MISMATCH", _("Restaurant Session location does not match its POS Profile."))
	service = resolve_service_type(profile, doc.service_type)
	active_tables = [row.table for row in doc.tables if not row.released_at]
	if doc.status in ACTIVE_STATUSES and service["requires_table"] and not active_tables:
		_fail("TABLE_REQUIRED", _("Select at least one table."))
	if not service["requires_table"] and active_tables:
		_fail("TABLE_NOT_APPLICABLE", _("This service type does not use tables."))
	if len(active_tables) != len(set(active_tables)):
		_fail("DUPLICATE_TABLE", _("A table cannot be assigned twice to the same session."))


def lock_tables(tables, restaurant, session=None):
	"""All entry points lock table rows in a stable order, then check current ownership."""
	for table in sorted(set(tables)):
		row = frappe.db.get_value(
			"Restaurant Table", table, ["restaurant", "is_active"], as_dict=True, for_update=True
		)
		if not row or row.restaurant != restaurant or not cint(row.is_active):
			_fail("TABLE_NOT_FOUND", _("Table {0} is unavailable in this restaurant.").format(table))
		for assignment in current_assignments(table):
			if (
				assignment.parent != session
				and frappe.db.get_value(SESSION, assignment.parent, "status", for_update=True)
				in ACTIVE_STATUSES
			):
				_fail("TABLE_OCCUPIED", _("Table {0} already belongs to an active session.").format(table))
		for order in current_legacy_orders(table):
			if not session or order.vunapos_restaurant_session != session:
				_fail("TABLE_OCCUPIED", _("Table {0} has an existing open order.").format(table))


def _load(session, for_update=False):
	doc = frappe.get_doc(SESSION, session, for_update=for_update)
	require_restaurant_access(doc.restaurant)
	doc.check_permission("read")
	return doc


def session_to_dict(doc):
	from vunapos.dto.restaurant import order_to_dict, waiter_name
	from vunapos.services.floor_plan_service import is_floor_plan_manager
	from vunapos.services.kitchen_lifecycle_service import preparation_summary
	from vunapos.services.kitchen_service import session_tickets

	available_waiters = []
	if is_floor_plan_manager():
		profiles = frappe.get_all(
			"POS Profile", filters={"vunapos_restaurant": doc.restaurant, "disabled": 0}, pluck="name"
		)
		users = (
			frappe.get_all("POS Profile User", filters={"parent": ["in", profiles]}, pluck="user")
			if profiles
			else []
		)
		if users:
			available_waiters = frappe.get_all(
				"User",
				filters={"name": ["in", users], "enabled": 1},
				fields=["name", "full_name"],
				order_by="full_name asc",
			)

	tickets = session_tickets(doc)
	return {
		"name": doc.name,
		"restaurant": doc.restaurant,
		"branch": doc.branch,
		"company": doc.company,
		"selling_price_list": doc.get("selling_price_list"),
		"currency": doc.get("currency"),
		"pos_profile": doc.pos_profile,
		"service_type": doc.service_type,
		"customer": doc.customer,
		"customer_name": frappe.db.get_value("Customer", doc.customer, "customer_name"),
		"waiter": doc.waiter,
		"available_waiters": available_waiters,
		"waiter_name": waiter_name(doc.waiter),
		"guest_count": cint(doc.guest_count),
		"status": doc.status,
		"kitchen_tickets": tickets,
		"preparation_status": preparation_summary(tickets),
		"opened_at": doc.opened_at,
		"modified": doc.modified,
		"tables": [
			{
				"table": row.table,
				"table_label": frappe.db.get_value("Restaurant Table", row.table, "table_label"),
				"released_at": row.released_at,
			}
			for row in doc.tables
		],
		"rounds": [
			order_to_dict(frappe.get_doc("Sales Order", name))
			for name in frappe.get_all(
				"Sales Order",
				filters={"vunapos_restaurant_session": doc.name},
				pluck="name",
				order_by="creation asc",
			)
		],
	}


def list_sessions(pos_profile):
	from vunapos.services.kitchen_lifecycle_service import preparation_summary

	profile = resolve_pos_profile(pos_profile)
	restaurant = require_restaurant_profile(profile.name)
	require_restaurant_access(restaurant)
	rows = frappe.get_all(
		SESSION,
		filters={"restaurant": restaurant, "status": ["in", ACTIVE_STATUSES]},
		fields=["name", "customer", "waiter", "guest_count", "opened_at", "service_type", "modified"],
		order_by="opened_at asc",
	)
	if not rows:
		return []
	assignments = frappe.get_all(
		"Restaurant Session Table",
		filters={"parent": ["in", [row.name for row in rows]], "released_at": ["is", "not set"]},
		fields=["parent", "table"],
		order_by="idx asc",
	)
	labels = (
		{
			row.name: row.table_label
			for row in frappe.get_all(
				"Restaurant Table",
				filters={"name": ["in", list({row.table for row in assignments})]},
				fields=["name", "table_label"],
			)
		}
		if assignments
		else {}
	)
	waiters = {
		row.name: row.full_name
		for row in frappe.get_all(
			"User", filters={"name": ["in", list({row.waiter for row in rows})]}, fields=["name", "full_name"]
		)
	}
	grouped = {}
	for assignment in assignments:
		grouped.setdefault(assignment.parent, []).append(
			frappe._dict(table=assignment.table, table_label=labels.get(assignment.table))
		)
	for row in rows:
		row["tables"] = grouped.get(row.name, [])
		row["waiter_name"] = waiters.get(row.waiter) or row.waiter
	tickets = frappe.get_list(
		"Kitchen Order Ticket",
		filters={"restaurant_session": ["in", [row.name for row in rows]]},
		fields=["restaurant_session", "status"],
		limit_page_length=0,
	)
	for row in rows:
		row["preparation_status"] = preparation_summary(
			[ticket for ticket in tickets if ticket.restaurant_session == row.name]
		)
	return rows


def update_session(session, tables=None, guest_count=None, customer=None, waiter=None):
	doc = _load(session, for_update=True)
	doc.check_permission("write")
	if doc.status != "Open":
		_fail("SESSION_NOT_OPEN", _("Only open sessions can be updated."))
	if customer is not None and customer != doc.customer:
		if frappe.db.exists("Sales Order", {"vunapos_restaurant_session": doc.name, "docstatus": 1}):
			_fail("SESSION_CUSTOMER_LOCKED", _("The customer cannot change after a round is submitted."))
		doc.customer = customer
		from vunapos.services.invoice_service import _build_sales_order_doc

		priced, _profile = _build_sales_order_doc(
			doc.pos_profile, customer=customer, service_type=doc.service_type
		)
		doc.selling_price_list = priced.selling_price_list
		doc.currency = priced.currency
	if guest_count is not None:
		doc.guest_count = cint(guest_count)
	if waiter is not None and waiter != doc.waiter:
		from vunapos.services.floor_plan_service import require_floor_plan_manager

		require_floor_plan_manager()
		require_restaurant_access(doc.restaurant, user=None)
		profiles = frappe.get_all(
			"POS Profile", filters={"vunapos_restaurant": doc.restaurant, "disabled": 0}, pluck="name"
		)
		if not frappe.db.exists("POS Profile User", {"parent": ["in", profiles], "user": waiter}):
			_fail("WAITER_NOT_ASSIGNED", _("Choose a waiter assigned to this restaurant."))
		doc.waiter = waiter
	if tables is not None:
		if isinstance(tables, str):
			tables = frappe.parse_json(tables)
		if not isinstance(tables, list) or len(tables) != len(set(tables)):
			_fail("INVALID_TABLES", _("Choose each table once."))
		old = [row.table for row in doc.tables if not row.released_at]
		lock_tables(set(old) | set(tables), doc.restaurant, session=doc.name)
		for row in doc.tables:
			if not row.released_at and row.table not in tables:
				row.update(
					{
						"released_at": now_datetime(),
						"released_by": frappe.session.user,
						"release_reason": "Table reassignment",
					}
				)
		for table in tables:
			if table not in old:
				doc.append(
					"tables",
					{"table": table, "assigned_at": now_datetime(), "assigned_by": frappe.session.user},
				)
	doc.flags.restaurant_session_write = True
	doc.save()
	return session_to_dict(doc)


def open_session(pos_profile, idempotency_key, tables=None, service_type=None, customer=None, guest_count=0):
	idempotency_key = str(idempotency_key or "").strip()
	if not idempotency_key or not str(idempotency_key).strip():
		_fail("IDEMPOTENCY_REQUIRED", _("An idempotency key is required to open a session."))
	profile = resolve_pos_profile(pos_profile)
	require_restaurant_staff_shift(profile.name)
	restaurant = require_restaurant_profile(profile.name)
	require_restaurant_access(restaurant)
	# Serialize retries on the profile even for takeaway sessions without tables.
	frappe.db.get_value("POS Profile", profile.name, "name", for_update=True)
	existing = frappe.db.get_value(SESSION, {"idempotency_key": idempotency_key}, "name", for_update=True)
	if existing:
		doc = _load(existing)
		if doc.pos_profile != profile.name:
			_fail("IDEMPOTENCY_CONFLICT", _("This key belongs to a different POS Profile."))
		return session_to_dict(doc)
	if isinstance(tables, str):
		tables = frappe.parse_json(tables)
	if not isinstance(tables or [], list):
		_fail("INVALID_TABLES", _("Tables must be a list."))
	tables = tables or []
	service_type = service_type or (get_default_service_type(profile) or {}).get("name")
	service = resolve_service_type(profile, service_type)
	if not service["requires_table"] and tables:
		_fail("TABLE_NOT_APPLICABLE", _("This service type does not use tables."))
	if len(tables) != len(set(tables)):
		_fail("DUPLICATE_TABLE", _("Choose each table once."))
	lock_tables(tables, restaurant)
	context = frappe.get_cached_doc("Restaurant", restaurant)
	from vunapos.services.invoice_service import _build_sales_order_doc

	priced, _profile = _build_sales_order_doc(
		profile.name, customer=customer or profile.customer, service_type=service_type
	)
	doc = frappe.get_doc(
		{
			"doctype": SESSION,
			"restaurant": restaurant,
			"branch": context.branch,
			"company": profile.company,
			"pos_profile": profile.name,
			"service_type": service_type,
			"selling_price_list": priced.selling_price_list,
			"currency": priced.currency,
			"customer": customer or profile.customer,
			"waiter": frappe.session.user,
			"guest_count": cint(guest_count),
			"status": "Open",
			"opened_at": now_datetime(),
			"idempotency_key": idempotency_key,
			"tables": [
				{"table": table, "assigned_at": now_datetime(), "assigned_by": frappe.session.user}
				for table in tables
			],
		}
	)
	doc.flags.restaurant_session_write = True
	doc.insert()
	return session_to_dict(doc)


def get_session(session):
	return session_to_dict(_load(session))


def create_round(session, items, idempotency_key, order_note=None, pos_profile=None, kitchen_routing=None):
	from vunapos.services.restaurant_order_service import create_order

	doc = _load(session, for_update=True)
	if doc.status != "Open":
		_fail("SESSION_NOT_OPEN", _("Only an open session can receive new orders."))
	idempotency_key = str(idempotency_key or "").strip()
	if not idempotency_key:
		_fail("IDEMPOTENCY_REQUIRED", _("An idempotency key is required for each round."))
	tables = [row.table for row in doc.tables if not row.released_at]
	lock_tables(tables, doc.restaurant, session=doc.name)
	profile = resolve_pos_profile(pos_profile or doc.pos_profile)
	if require_restaurant_profile(profile.name) != doc.restaurant:
		_fail("SESSION_CONTEXT_MISMATCH", _("Choose a POS Profile belonging to this session's restaurant."))
	return create_order(
		pos_profile=profile.name,
		service_type=doc.service_type,
		customer=doc.customer,
		table=tables[0] if tables else None,
		pax=doc.guest_count,
		items=items,
		order_note=order_note,
		idempotency_key=idempotency_key,
		restaurant_session=doc.name,
		price_list=doc.get("selling_price_list"),
		kitchen_routing=kitchen_routing,
	)


def cancel_empty_session(session):
	doc = _load(session, for_update=True)
	doc.check_permission("write")
	if doc.status == "Cancelled":
		return session_to_dict(doc)
	if doc.status != "Open" or frappe.db.exists(
		"Sales Order", {"vunapos_restaurant_session": doc.name, "docstatus": ["!=", 2]}
	):
		_fail(
			"SESSION_HAS_ROUNDS",
			_("A session with ordering rounds must use the order cancellation or settlement workflow."),
		)
	lock_tables([row.table for row in doc.tables if not row.released_at], doc.restaurant, session=doc.name)
	for row in doc.tables:
		if not row.released_at:
			row.update(
				{
					"released_at": now_datetime(),
					"released_by": frappe.session.user,
					"release_reason": "Empty session cancelled",
				}
			)
	doc.status = "Cancelled"
	doc.closed_at = now_datetime()
	doc.flags.restaurant_session_write = True
	doc.save()
	return session_to_dict(doc)


def protect_committed_round(doc, method=None):
	"""Allow billing/fulfilment bookkeeping, but not rewriting a submitted round."""
	before = doc.get_doc_before_save()
	if not before:
		return
	if not doc.get("vunapos_restaurant_session") and not before.get("vunapos_restaurant_session"):
		return
	headers = ("customer", "selling_price_list", "currency", "vunapos_restaurant_session")
	line_fields = (
		"name",
		"item_code",
		"qty",
		"uom",
		"conversion_factor",
		"rate",
		"discount_percentage",
		"discount_amount",
		"warehouse",
		"item_tax_template",
		"vunapos_item_note",
		"vunapos_modifiers",
		"vunapos_parent_line_id",
		"vunapos_kitchen_station",
		"vunapos_temporary_kitchen_routing",
	)
	old_lines = [tuple(row.get(field) for field in line_fields) for row in before.items]
	new_lines = [tuple(row.get(field) for field in line_fields) for row in doc.items]
	if old_lines != new_lines or any(doc.get(field) != before.get(field) for field in headers):
		_fail(
			"ROUND_ALREADY_COMMITTED",
			_(
				"Submitted restaurant rounds cannot be rewritten. Create a new round or use the cancellation workflow."
			),
		)
