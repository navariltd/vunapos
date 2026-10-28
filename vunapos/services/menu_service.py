"""Restaurant menu: which items an outlet sells, as configured on the POS Profile.

The menu is the profile's `vunapos_restaurant_menu` table (VunaPOS Menu Item
Group rows). A row may be limited to one floor and/or one service type. A row
with neither applies everywhere. Rows that apply to an order's context are
unioned, and each listed item group includes all of its descendant groups.

Fallbacks, in order: the menu table, then the standard POS Profile Item Groups
table, then no restriction (every sales item).

Before a table is chosen (menu-first ordering), the menu for a service type that
uses tables spans every floor, and without a service type it spans every type.
Each item then says where it may be served (allowed_floors, allowed_service_types),
so the order screen can tag it and warn when a table's floor can't serve it.
"""

import frappe
from frappe import _
from frappe.utils import cint

from vunapos.services.floor_plan_service import TABLE_DOCTYPE, require_restaurant_profile
from vunapos.services.item_service import search_items
from vunapos.services.profile_service import resolve_pos_profile
from vunapos.services.service_type_service import (
	get_profile_service_types,
	get_service_type_pricing,
)

SOURCE_MENU = "Menu"
SOURCE_PROFILE_ITEM_GROUPS = "POS Profile Item Groups"
SOURCE_ALL_ITEMS = "All Items"


def _throw(code, message, meta=None):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	exc.vuna_error_meta = meta or {}
	raise exc


def _descendant_item_groups(item_group):
	bounds = frappe.db.get_value("Item Group", item_group, ["lft", "rgt"], as_dict=True)
	if not bounds:
		return []
	return frappe.get_all(
		"Item Group",
		filters={"lft": [">=", bounds.lft], "rgt": ["<=", bounds.rgt]},
		pluck="name",
		order_by="lft asc",
	)


def _category(item_group, label):
	return {
		"item_group": item_group,
		"label": label or item_group,
		"item_groups": _descendant_item_groups(item_group),
	}


def get_menu_definition(profile, service_type=None, floor=None, any_floor=False, any_service_type=False):
	"""Resolve the menu categories for an order context.

	Returns {"restricted", "source", "categories", "item_groups", "scopes"}. When
	restricted is False every sales item is on the menu and item_groups is None.
	When it is True, item_groups lists every allowed group (possibly empty).

	any_floor / any_service_type include menu rows for every floor / service type
	(an order with no table or no service type yet). scopes lists each matching
	menu row's groups with its floor and service type, for allowed_scope().
	"""
	rows = profile.get("vunapos_restaurant_menu") or []
	scopes = []
	if rows:
		matching = [
			row
			for row in rows
			if (not row.floor or any_floor or row.floor == floor)
			and (not row.service_type or any_service_type or row.service_type == service_type)
		]
		matching.sort(key=lambda row: (cint(row.display_order), cint(row.idx)))
		pairs = [(row.item_group, row.label) for row in matching]
		source = SOURCE_MENU
	elif profile.get("item_groups"):
		matching = []
		pairs = [(row.item_group, None) for row in profile.get("item_groups") if row.item_group]
		source = SOURCE_PROFILE_ITEM_GROUPS
	else:
		return {
			"restricted": False,
			"source": SOURCE_ALL_ITEMS,
			"categories": [],
			"item_groups": None,
			"scopes": [],
		}

	categories = []
	groups_by_category = {}
	for item_group, label in pairs:
		if item_group in groups_by_category:
			continue
		category = _category(item_group, label)
		groups_by_category[item_group] = category["item_groups"]
		categories.append(category)
	for row in matching:
		scopes.append(
			{
				"item_groups": set(groups_by_category.get(row.item_group) or []),
				"floor": row.floor or None,
				"service_type": row.service_type or None,
			}
		)
	item_groups = sorted({group for category in categories for group in category["item_groups"]})
	return {
		"restricted": True,
		"source": source,
		"categories": categories,
		"item_groups": item_groups,
		"scopes": scopes,
	}


def allowed_scope(item_group, scopes):
	"""Where an item group may be served: {"floors", "service_types"}.

	Each is None when any matching menu row leaves it open (every floor, every
	service type), otherwise the sorted names from the rows that list the group.
	No scopes (an unrestricted menu) means served everywhere.
	"""
	floors, service_types = set(), set()
	any_floor = any_service_type = not scopes
	for scope in scopes:
		if item_group not in scope["item_groups"]:
			continue
		if scope["floor"]:
			floors.add(scope["floor"])
		else:
			any_floor = True
		if scope["service_type"]:
			service_types.add(scope["service_type"])
		else:
			any_service_type = True
	return {
		"floors": None if any_floor or not floors else sorted(floors),
		"service_types": None if any_service_type or not service_types else sorted(service_types),
	}


def items_priced_in(price_list, item_codes):
	"""Item codes that have a selling price in the given price list."""
	if not item_codes:
		return set()
	return set(
		frappe.get_all(
			"Item Price",
			filters={"price_list": price_list, "item_code": ["in", list(item_codes)], "selling": 1},
			pluck="item_code",
		)
	)


def validate_service_type_price(profile, item_code, service_type):
	"""Strict pricing: an item must have a price in its service type's own price list."""
	price_list = get_service_type_pricing(profile, service_type)["price_list"]
	if price_list and item_code not in items_priced_in(price_list, [item_code]):
		_throw(
			"ITEM_NOT_PRICED_FOR_SERVICE_TYPE",
			_("Item {0} has no price in {1}, so it cannot be ordered for {2}").format(
				item_code, price_list, service_type
			),
			{"item_code": item_code, "price_list": price_list, "service_type": service_type},
		)


def resolve_table_floor(profile_name, table):
	if not table:
		return None
	row = frappe.db.get_value(TABLE_DOCTYPE, table, ["pos_profile", "floor"], as_dict=True)
	if not row or row.pos_profile != profile_name:
		_throw(
			"TABLE_NOT_FOUND",
			_("Table {0} does not belong to POS Profile {1}").format(table, profile_name),
			{"table": table},
		)
	return row.floor


def validate_menu_item(profile, item_code, item_group, service_type=None, floor=None, menu=None):
	menu = menu or get_menu_definition(profile, service_type, floor)
	if menu["restricted"] and item_group not in menu["item_groups"]:
		_throw(
			"MENU_ITEM_NOT_AVAILABLE",
			_("Item {0} is not on the menu for this order").format(item_code),
			{"item_code": item_code, "item_group": item_group, "service_type": service_type, "floor": floor},
		)


def _category_for(item_group, categories):
	# An item can sit under two listed groups (a parent and its child). The
	# first category in menu order wins, matching how the menu is displayed.
	return next(
		(category["item_group"] for category in categories if item_group in category["item_groups"]), None
	)


def list_service_types(pos_profile):
	# Lives here rather than in service_type_service: that module is imported by
	# dto.profile, which profile_service imports, so it cannot import
	# profile_service back without a cycle.
	profile = resolve_pos_profile(pos_profile)
	require_restaurant_profile(profile.name)
	return get_profile_service_types(profile)


def _requires_table(service_type):
	return bool(service_type) and bool(
		cint(frappe.db.get_value("VunaPOS Service Type", service_type, "requires_table"))
	)


def _floor_labels(floor_names):
	if not floor_names:
		return []
	labels = dict(
		frappe.get_all(
			"VunaPOS Restaurant Floor",
			filters={"name": ["in", list(floor_names)]},
			fields=["name", "floor_name"],
			as_list=True,
		)
	)
	return [{"floor": name, "floor_name": labels.get(name) or name} for name in sorted(floor_names)]


def get_menu(pos_profile, service_type=None, table=None, query=None, customer=None, price_list=None):
	"""Return the menu categories and priced items for an order context.

	Without a table, a service type that uses tables gets the menu of every floor,
	and no service type gets the menu of every type, each item tagged with where
	it may be served. With a table, or for a type without tables, the menu is
	exactly what the order may contain.
	"""
	profile = resolve_pos_profile(pos_profile)
	require_restaurant_profile(profile.name)
	service_price_list = get_service_type_pricing(profile, service_type)["price_list"]
	floor = resolve_table_floor(profile.name, table)
	any_service_type = not service_type
	any_floor = not table and (any_service_type or _requires_table(service_type))
	menu = get_menu_definition(
		profile, service_type, floor, any_floor=any_floor, any_service_type=any_service_type
	)
	if menu["restricted"] and not menu["item_groups"]:
		items = []
	else:
		items = search_items(
			query=query,
			pos_profile=profile.name,
			customer=customer,
			price_list=price_list or service_price_list,
			item_groups=menu["item_groups"],
		)
	if service_price_list:
		# A service type's own price list is strict: items without a price in it
		# are not sold for that service type.
		priced = items_priced_in(service_price_list, [item["item_code"] for item in items])
		items = [item for item in items if item["item_code"] in priced]
	floor_names = set()
	for item in items:
		item["menu_category"] = _category_for(item.get("item_group"), menu["categories"])
		scope = allowed_scope(item.get("item_group"), menu["scopes"])
		item["allowed_floors"] = scope["floors"]
		item["allowed_service_types"] = scope["service_types"] if any_service_type else None
		floor_names.update(scope["floors"] or [])
	return {
		"pos_profile": profile.name,
		"service_type": service_type,
		"table": table,
		"floor": floor,
		"price_list": price_list or service_price_list or profile.selling_price_list,
		"restricted": menu["restricted"],
		"source": menu["source"],
		"categories": [
			{"item_group": category["item_group"], "label": category["label"]}
			for category in menu["categories"]
		],
		"floors": _floor_labels(floor_names),
		"items": items,
	}


def validate_profile_menu(profile, method=None):
	"""POS Profile validate hook: menu floors must belong to this profile.

	Runs only when a profile is saved in Desk, so it uses frappe.throw (which
	shows the message there) rather than an API error code.
	"""
	for row in profile.get("vunapos_restaurant_menu") or []:
		if not row.floor:
			continue
		floor_profile = frappe.db.get_value("VunaPOS Restaurant Floor", row.floor, "pos_profile")
		if floor_profile != profile.name:
			frappe.throw(
				_("Menu row {0}: floor {1} belongs to a different POS Profile").format(row.idx, row.floor),
				title=_("Menu"),
			)
