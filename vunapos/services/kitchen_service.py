"""Station routing and immutable preparation events for committed restaurant rounds."""

import hashlib
import json
from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime

from vunapos.services.restaurant_service import (
	require_restaurant_access,
	require_restaurant_context,
	validate_branch_company,
)

TICKET = "Kitchen Order Ticket"
STATION = "Kitchen Station"
KITCHEN_EVENT = "vunapos_kitchen_ticket_created"


def fail(code, message, meta=None):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	exc.vuna_error_meta = meta or {}
	raise exc


def validate_station(doc):
	context = require_restaurant_context(doc.restaurant, branch=doc.branch)
	if doc.company and doc.company != context.company:
		fail(
			"STATION_CONTEXT_MISMATCH",
			_("Kitchen Station Company and Branch must match the selected Restaurant."),
		)
	doc.company = context.company
	validate_branch_company(doc.branch, doc.company)
	if frappe.db.exists(
		STATION,
		{
			"restaurant": doc.restaurant,
			"branch": doc.branch,
			"station_name": doc.station_name,
			"name": ["!=", doc.name or ""],
		},
	):
		fail("DUPLICATE_STATION_NAME", _("Station names must be unique within a Restaurant."))
	seen = set()
	for row in doc.item_groups:
		if row.item_group in seen:
			fail("DUPLICATE_STATION_GROUP", _("An Item Group can only be listed once per station."))
		seen.add(row.item_group)
	# Lock the shared location so two station saves cannot claim a group together.
	frappe.db.get_value("Restaurant", doc.restaurant, "name", for_update=True)
	if doc.enabled and seen:
		stations = frappe.get_all(
			STATION,
			filters={
				"restaurant": doc.restaurant,
				"branch": doc.branch,
				"enabled": 1,
				"name": ["!=", doc.name or ""],
			},
			pluck="name",
		)
		duplicate = frappe.db.get_value(
			"Kitchen Station Item Group",
			{"parent": ["in", stations or [""]], "parenttype": STATION, "item_group": ["in", list(seen)]},
			["item_group", "parent"],
			as_dict=True,
		)
		if duplicate:
			fail(
				"KITCHEN_GROUP_ALREADY_ASSIGNED",
				_(
					"Item Group {0} is already assigned to Kitchen Station {1} in this Restaurant and Branch. Use a different group or disable its previous station."
				).format(duplicate.item_group, duplicate.parent),
			)
	for warehouse in (doc.raw_material_warehouse, doc.wip_warehouse):
		if warehouse:
			row = frappe.db.get_value(
				"Warehouse", warehouse, ["company", "is_group", "disabled"], as_dict=True
			)
			if not row or row.company != doc.company or row.is_group or row.disabled:
				fail(
					"INVALID_STATION_WAREHOUSE",
					_(
						"Preparation warehouses must be enabled ledger warehouses of the restaurant's company."
					),
				)
	if (
		not doc.is_new()
		and (doc.has_value_changed("restaurant") or doc.has_value_changed("branch"))
		and frappe.db.exists(TICKET, {"kitchen_station": doc.name})
	):
		fail(
			"STATION_HAS_TICKETS", _("A station with kitchen tickets cannot be moved to another Restaurant.")
		)


def allowed_stations(restaurant, branch=None):
	require_restaurant_access(restaurant, branch=branch)
	# get_list also respects Kitchen Station User Permissions when configured.
	return frappe.get_list(
		STATION,
		filters={"restaurant": restaurant, "enabled": 1, **({"branch": branch} if branch else {})},
		fields=["name", "station_name"],
		order_by="station_name asc",
		limit_page_length=0,
	)


def parse_overrides(value):
	if isinstance(value, str):
		try:
			value = json.loads(value)
		except (ValueError, TypeError):
			fail("INVALID_KITCHEN_ROUTING", _("Invalid temporary kitchen routing."))
	if value is None:
		return {}
	if (
		not isinstance(value, dict)
		or len(value) > 500
		or any(
			not isinstance(code, str) or not isinstance(station, str) or not station
			for code, station in value.items()
		)
	):
		fail("INVALID_KITCHEN_ROUTING", _("Temporary kitchen routing must map Item codes to stations."))
	return value


def station_matches(restaurant, item_codes, branch=None):
	"""Closest mapped ancestor wins, even when that station is hidden by permissions."""
	stations = frappe.get_all(
		STATION,
		filters={"restaurant": restaurant, "enabled": 1, **({"branch": branch} if branch else {})},
		pluck="name",
	)
	assignments = frappe.get_all(
		"Kitchen Station Item Group",
		filters={"parent": ["in", stations or [""]], "parenttype": STATION},
		fields=["parent", "item_group"],
	)
	items = frappe.get_all(
		"Item", filters={"name": ["in", list(item_codes) or [""]]}, fields=["name", "item_group"]
	)
	groups = {row.item_group for row in items} | {row.item_group for row in assignments}
	bounds = {
		row.name: row
		for row in frappe.get_all(
			"Item Group", filters={"name": ["in", list(groups) or [""]]}, fields=["name", "lft", "rgt"]
		)
	}
	result = {}
	for item in items:
		matches = [
			row
			for row in assignments
			if bounds.get(item.item_group)
			and bounds.get(row.item_group)
			and bounds[row.item_group].lft <= bounds[item.item_group].lft <= bounds[row.item_group].rgt
		]
		# In a nested set, the narrowest ancestor interval is the most specific.
		width = min(
			(bounds[row.item_group].rgt - bounds[row.item_group].lft for row in matches), default=None
		)
		result[item.name] = {
			row.parent for row in matches if bounds[row.item_group].rgt - bounds[row.item_group].lft == width
		}
	return result


def classify_items(restaurant, items, branch=None):
	require_restaurant_access(restaurant, branch=branch)
	matches = station_matches(restaurant, [item["item_code"] for item in items], branch)
	for item in items:
		item["is_qsr"] = bool(matches.get(item["item_code"]))
	return items


def route_lines(restaurant, lines, overrides=None, branch=None):
	"""Most-specific group first; legacy duplicate mappings require explicit routing."""
	if len(lines) > 500:
		fail("RESTAURANT_ROUND_TOO_LARGE", _("Send no more than 500 item/add-on lines in one round."))
	if len({line.line_id for line in lines}) != len(lines):
		fail("DUPLICATE_PREPARATION_LINE", _("Preparation line identifiers must be unique within a round."))
	overrides = parse_overrides(overrides)
	main_codes = {line.item_code for line in lines if not line.get("parent_line_id")}
	overrides = {code: name for code, name in overrides.items() if code in main_codes}
	stations = allowed_stations(restaurant, branch)
	station_names = {row.name for row in stations}
	matches_by_code = station_matches(restaurant, main_codes, branch)
	invalid = [
		{"item_code": code, "item_group": "", "reason": "invalid", "candidates": []}
		for code, name in overrides.items()
		if name not in station_names
	]
	if invalid:
		fail(
			"INVALID_KITCHEN_STATION",
			_("Choose an enabled, permitted station in this Restaurant."),
			{"items": invalid, "stations": stations},
		)
	items = {
		row.name: row
		for row in frappe.get_all(
			"Item",
			filters={"name": ["in", list({line.item_code for line in lines}) or [""]]},
			fields=["name", "item_group"],
		)
	}
	unresolved, resolved = {}, {}
	for line in lines:
		if line.get("parent_line_id"):
			continue
		item = items.get(line.item_code)
		if not item:
			fail("ITEM_NOT_FOUND", _("Preparation item {0} was not found.").format(line.item_code))
		matches = matches_by_code.get(line.item_code, set())
		if not matches:
			resolved[line.line_id] = (None, False)
			continue
		if not matches & station_names:
			frappe.throw(
				_("No permitted kitchen station for {0}.").format(line.item_code), frappe.PermissionError
			)
		if line.item_code in overrides:
			station = overrides[line.item_code]
		else:
			matches &= station_names
			if len(matches) != 1:
				unresolved[line.item_code] = {
					"item_code": line.item_code,
					"item_group": item.item_group,
					"reason": "ambiguous" if matches else "missing",
					"candidates": sorted(matches),
				}
				continue
			station = next(iter(matches))
		resolved[line.line_id] = (station, line.item_code in overrides)
	if unresolved:
		fail(
			"KITCHEN_ROUTING_REQUIRED",
			_("Choose a kitchen station for items with ambiguous routing."),
			{"items": list(unresolved.values()), "stations": stations},
		)
	for line in lines:
		parent = line.get("parent_line_id") or line.line_id
		if parent not in resolved:
			fail("INVALID_ADDON_PARENT", _("An add-on must belong to a preparation item in this round."))
		line.routed_station, line.temporary_routing = resolved[parent]
	return lines


def event_key(order, station):
	return hashlib.sha256(json.dumps([order, station], separators=(",", ":")).encode()).hexdigest()


def reject_ticket_mutation():
	fail(
		"IMMUTABLE_KITCHEN_TICKET",
		_(
			"Kitchen ticket contents are immutable. Use a preparation action or a separate cancellation event."
		),
	)


def validate_ticket(doc):
	if not frappe.flags.get("vunapos_generating_kot"):
		reject_ticket_mutation()
	if not doc.is_new() and doc.get_doc_before_save() and doc.get_doc_before_save().docstatus == 1:
		reject_ticket_mutation()
	if doc.event_key != event_key(doc.sales_order, doc.kitchen_station) or doc.status != "Sent":
		fail("INVALID_KITCHEN_TICKET", _("Invalid initial kitchen ticket event."))
	if not doc.items or any(flt(row.qty) <= 0 for row in doc.items):
		fail("INVALID_KITCHEN_TICKET", _("Kitchen tickets require positive preparation quantities."))


def generate_tickets(order, method=None):
	"""Runs in the Sales Order submission transaction; never backfills old rounds implicitly."""
	if not order.get("vunapos_restaurant_session"):
		return []
	from vunapos.services.profile_service import resolve_pos_profile
	from vunapos.services.restaurant_session_service import _load

	frappe.db.get_value("Sales Order", order.name, "name", for_update=True)
	session = _load(order.vunapos_restaurant_session, for_update=True)
	profile = resolve_pos_profile(order.vunapos_pos_profile)
	if (
		order.docstatus != 1
		or session.status != "Open"
		or profile.get("vunapos_pos_mode") != "Restaurant"
		or order.company != session.company
		or profile.company != session.company
		or profile.vunapos_branch != session.branch
		or order.get("vunapos_branch") != session.branch
		or (order.vunapos_restaurant, profile.vunapos_restaurant, order.customer, order.vunapos_service_type)
		!= (session.restaurant, session.restaurant, session.customer, session.service_type)
	):
		fail(
			"KITCHEN_CONTEXT_MISMATCH",
			_("Kitchen tickets must match an open restaurant session and submitted round."),
		)
	# Repeated calls reuse the original event, even after routing configuration changes.
	existing = frappe.get_all(TICKET, filters={"sales_order": order.name}, pluck="name")
	if existing:
		return existing
	overrides = parse_overrides(frappe.flags.get("vunapos_kitchen_routing"))
	lines = []
	for row in order.items:
		identifier = row.get("vunapos_line_id") or row.name
		if cint(row.get("vunapos_temporary_kitchen_routing")) and not row.get("vunapos_parent_line_id"):
			overrides.setdefault(row.item_code, row.get("vunapos_kitchen_station"))
		lines.append(
			frappe._dict(
				line_id=identifier,
				item_code=row.item_code,
				parent_line_id=row.get("vunapos_parent_line_id"),
				source=row,
			)
		)
	route_lines(session.restaurant, lines, overrides, branch=session.branch)
	from vunapos.services.restaurant_stock_service import reserve_round

	work_orders = reserve_round(order, profile, lines) or {}
	grouped = defaultdict(list)
	for line in lines:
		row = line.source
		if not line.routed_station:
			continue
		if row.get("vunapos_kitchen_station") != line.routed_station or cint(
			row.get("vunapos_temporary_kitchen_routing")
		) != cint(line.temporary_routing):
			row.db_set(
				{
					"vunapos_kitchen_station": line.routed_station,
					"vunapos_temporary_kitchen_routing": cint(line.temporary_routing),
				},
				update_modified=False,
			)
		grouped[line.routed_station].append(
			{
				"sales_order_item": row.name,
				"work_order": work_orders.get(row.name),
				"line_id": line.line_id,
				"parent_line_id": line.parent_line_id,
				"item_code": row.item_code,
				"item_name": row.item_name,
				"qty": flt(row.qty),
				"uom": row.uom,
				"conversion_factor": flt(row.conversion_factor),
				"stock_qty": flt(row.stock_qty),
				"stock_uom": row.stock_uom,
				"note": row.get("vunapos_item_note"),
				"modifiers": row.get("vunapos_modifiers") or "[]",
				"temporary_routing": cint(line.temporary_routing),
			}
		)
	tables = [
		frappe.get_cached_value("Restaurant Table", row.table, "table_label")
		for row in session.tables
		if not row.released_at
	]
	created = []
	previous = frappe.flags.get("vunapos_generating_kot")
	try:
		frappe.flags.vunapos_generating_kot = True
		for station, rows in grouped.items():
			doc = frappe.get_doc(
				{
					"doctype": TICKET,
					"kitchen_station": station,
					"station_label": frappe.get_cached_value(STATION, station, "station_name"),
					"restaurant": session.restaurant,
					"branch": session.branch,
					"company": session.company,
					"restaurant_session": session.name,
					"sales_order": order.name,
					"pos_profile": profile.name,
					"service_type": session.service_type,
					"table_labels": ", ".join(table for table in tables if table),
					"waiter": order.get("vunapos_waiter"),
					"sent_by": frappe.session.user,
					"sent_at": now_datetime(),
					"status": "Sent",
					"order_note": order.get("vunapos_order_note"),
					"event_key": event_key(order.name, station),
					"items": rows,
				}
			)
			doc.insert(ignore_permissions=True)
			doc.submit()
			created.append(doc.name)
			frappe.publish_realtime(
				KITCHEN_EVENT,
				{
					"name": doc.name,
					"restaurant_session": session.name,
					"sales_order": order.name,
					"kitchen_station": station,
				},
				doctype=STATION,
				docname=station,
				after_commit=True,
			)
	finally:
		frappe.flags.vunapos_generating_kot = previous
	return created


def session_tickets(session):
	return frappe.get_list(
		TICKET,
		filters={"restaurant_session": session.name, "restaurant": session.restaurant, "docstatus": 1},
		fields=["name", "sales_order", "kitchen_station", "station_label", "status", "sent_at"],
		order_by="creation asc",
		limit_page_length=0,
	)


def protect_order_cancellation(order, method=None):
	if frappe.flags.get("vunapos_cancelling_kitchen_order") == order.name:
		return
	if order.get("vunapos_restaurant_session") and frappe.db.exists(
		TICKET, {"sales_order": order.name, "docstatus": 1}
	):
		fail(
			"KITCHEN_CANCELLATION_REQUIRED",
			_(
				"This round has been sent to a kitchen. It requires a kitchen cancellation event before the order can be cancelled."
			),
		)


def get_ticket(name):
	doc = frappe.get_doc(TICKET, name)
	require_restaurant_access(doc.restaurant, branch=doc.branch)
	doc.check_permission("read")
	frappe.get_doc(STATION, doc.kitchen_station).check_permission("read")
	from vunapos.services.kitchen_lifecycle_service import MANAGERS, action_history, can_cancel, capabilities

	return {
		"modified": doc.modified,
		"pos_profile": doc.pos_profile,
		"available_actions": capabilities(doc.status),
		"can_cancel_order": can_cancel() and doc.status not in ("Served", "Cancelled"),
		"requires_cancel_pin": bool(
			frappe.get_cached_value(
				"POS Profile", doc.pos_profile, "vunapos_require_manager_pin_order_cancel"
			)
		)
		and not bool(set(frappe.get_roles()) & MANAGERS),
		"actions": action_history(doc),
		"name": doc.name,
		"sales_order": doc.sales_order,
		"restaurant_session": doc.restaurant_session,
		"kitchen_station": doc.kitchen_station,
		"station_label": doc.station_label,
		"table_labels": doc.table_labels,
		"service_type": doc.service_type,
		"status": doc.status,
		"sent_at": doc.sent_at,
		"sent_by": doc.sent_by,
		"waiter": doc.waiter,
		"order_note": doc.order_note,
		"items": [
			{
				"line_id": row.line_id,
				"work_order": row.work_order,
				"parent_line_id": row.parent_line_id,
				"item_code": row.item_code,
				"item_name": row.item_name,
				"qty": flt(row.qty),
				"uom": row.uom,
				"stock_qty": flt(row.stock_qty),
				"stock_uom": row.stock_uom,
				"note": row.note,
				"modifiers": frappe.parse_json(row.modifiers or "[]"),
				"temporary_routing": bool(row.temporary_routing),
			}
			for row in doc.items
		],
	}
