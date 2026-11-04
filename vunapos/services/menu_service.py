"""Explicit restaurant Items grouped into independent Menu Sections/Courses.

Legacy Item Group menus are converted by the menu-sections migration.
Prices stay in ERPNext (Item Price, Pricing Rules).

Fallbacks when the restaurant has no menu: the standard POS Profile Item Groups
table, then no restriction (every sales item).
"""

import frappe
from frappe import _
from frappe.utils import cint

from vunapos.services.floor_plan_service import TABLE_DOCTYPE, require_restaurant_profile
from vunapos.services.item_service import search_items
from vunapos.services.profile_service import resolve_pos_profile
from vunapos.services.restaurant_service import get_profile_restaurant
from vunapos.services.service_type_service import (
	get_profile_service_types,
	get_service_type_pricing,
)

MENU_DOCTYPE = "Restaurant Menu"
INCLUDE, EXCLUDE = "Include", "Exclude"
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


def resolve_menu(restaurant, floor=None, service_type=None):
	"""The menu for an order: the restaurant's default menu, if it is enabled."""
	menu = restaurant.get("default_menu") if restaurant else None
	if menu and cint(frappe.db.get_value(MENU_DOCTYPE, menu, "enabled")):
		return frappe.get_cached_doc(MENU_DOCTYPE, menu)
	return None


def get_menu_definition(profile, service_type=None, floor=None):
	"""Resolve the menu categories for an order context.

	Returns {"restricted", "source", "menu", "categories", "item_groups",
	"include_items", "exclude_items"}. When restricted is False every sales item
	is on the menu and item_groups is None. When it is True, an item is on the
	menu if it is included, or its group is in item_groups and it is not excluded.
	"""
	menu = resolve_menu(get_profile_restaurant(profile), floor, service_type)
	if menu:
		return section_menu_definition(menu)
	include_items, exclude_items = {}, set()
	if profile.get("item_groups"):
		pairs = [(row.item_group, None) for row in profile.get("item_groups") if row.item_group]
		source = SOURCE_PROFILE_ITEM_GROUPS
	else:
		return {
			"restricted": False,
			"source": SOURCE_ALL_ITEMS,
			"menu": None,
			"categories": [],
			"item_groups": None,
			"include_items": {},
			"exclude_items": set(),
		}

	categories = []
	seen = set()
	for item_group, label in pairs:
		if item_group in seen:
			continue
		seen.add(item_group)
		categories.append(_category(item_group, label))
	item_groups = sorted({group for category in categories for group in category["item_groups"]})
	# An included item whose group is not on the menu shows under its own group.
	for item_group in include_items.values():
		if item_group and item_group not in item_groups and item_group not in seen:
			seen.add(item_group)
			categories.append({"item_group": item_group, "label": item_group, "item_groups": [item_group]})
	return {
		"restricted": True,
		"source": source,
		"menu": menu.name if menu else None,
		"categories": categories,
		"item_groups": item_groups,
		"include_items": include_items,
		"exclude_items": exclude_items,
	}


def is_on_menu(menu, item_code, item_group):
	if item_code in menu["exclude_items"]:
		return False
	if not menu["restricted"]:
		return True
	if item_code in menu["include_items"]:
		return True
	return item_group in menu["item_groups"] and item_code not in menu["exclude_items"]


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
	restaurant = frappe.db.get_value("POS Profile", profile_name, "vunapos_restaurant")
	row = frappe.db.get_value(TABLE_DOCTYPE, table, ["restaurant", "floor"], as_dict=True)
	if not row or not restaurant or row.restaurant != restaurant:
		_throw(
			"TABLE_NOT_FOUND",
			_("Table {0} does not belong to restaurant {1}").format(table, restaurant),
			{"table": table},
		)
	return row.floor


def validate_menu_item(profile, item_code, item_group, service_type=None, floor=None, menu=None):
	menu = menu or get_menu_definition(profile, service_type, floor)
	if not is_on_menu(menu, item_code, item_group):
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


def get_menu(pos_profile, service_type=None, table=None, query=None, customer=None, price_list=None):
	"""Return the menu categories and priced items for an order context."""
	profile = resolve_pos_profile(pos_profile)
	require_restaurant_profile(profile.name)
	service_price_list = get_service_type_pricing(profile, service_type)["price_list"]
	floor = resolve_table_floor(profile.name, table)
	menu = get_menu_definition(profile, service_type, floor)
	search_groups = menu["item_groups"]
	if menu["restricted"]:
		# Included items can sit outside the menu's groups, so search their groups
		# too, then keep only what is on the menu.
		search_groups = sorted(
			set(search_groups) | {group for group in menu["include_items"].values() if group}
		)
	if menu["restricted"] and not search_groups:
		items = []
	else:
		items = search_items(
			query=query,
			pos_profile=profile.name,
			customer=customer,
			price_list=price_list or service_price_list,
			item_groups=search_groups,
			item_codes=[code for code in menu["explicit_items"] if code in menu["include_items"]]
			if menu.get("section_menu")
			else None,
			limit=500,
		)
		items = [item for item in items if is_on_menu(menu, item["item_code"], item.get("item_group"))]
	if service_price_list:
		# A service type's own price list is strict: items without a price in it
		# are not sold for that service type.
		priced = items_priced_in(service_price_list, [item["item_code"] for item in items])
		items = [item for item in items if item["item_code"] in priced]
	for item in items:
		item["menu_category"] = (
			menu.get("sections", {}).get(item["item_code"])
			if menu.get("section_menu")
			else _category_for(item.get("item_group"), menu["categories"])
		)
	if menu.get("section_menu"):
		items = [
			item
			for item in items
			if not item.get("variant_of") or item["item_code"] in menu["explicit_items"]
		]
		items.sort(
			key=lambda item: (
				menu["item_order"].get(item["item_code"], 0),
				item.get("item_name") or item["item_code"],
			)
		)
	from vunapos.services.modifier_service import menu_modifier_groups

	modifier_groups = menu_modifier_groups(profile, menu, items, customer, price_list or service_price_list)
	return {
		"pos_profile": profile.name,
		"service_type": service_type,
		"table": table,
		"floor": floor,
		"price_list": price_list or service_price_list or profile.selling_price_list,
		"restricted": menu["restricted"],
		"source": menu["source"],
		"menu": menu["menu"],
		"modifier_groups": modifier_groups,
		"available_item_codes": list(menu["include_items"]) if menu.get("section_menu") else None,
		"categories": [
			{"item_group": category["item_group"], "label": category["label"]}
			for category in menu["categories"]
		],
		"items": items,
	}


def validate_menu_doc(doc):
	"""Restaurant Menu validate. Desk-only, so it uses frappe.throw."""
	groups = set()
	for row in doc.get("item_groups") or []:
		if row.item_group in groups:
			frappe.throw(
				_("Item group {0} is on the menu more than once").format(row.item_group), title=_("Menu")
			)
		groups.add(row.item_group)
	items = set()
	for row in doc.get("items") or []:
		if row.action != EXCLUDE and not row.get("menu_section") and not doc.get("item_groups"):
			frappe.throw(_("Select a Section / Course for item {0}").format(row.item_code))
		if row.item_code in items:
			frappe.throw(
				_("Item {0} is listed more than once. Keep one row: Include or Exclude.").format(
					row.item_code
				),
				title=_("Menu"),
			)
		items.add(row.item_code)
	if doc.company and not doc.is_new() and doc.has_value_changed("company"):
		restaurants = frappe.get_all(
			"Restaurant",
			filters={"default_menu": doc.name, "company": ["!=", doc.company]},
			pluck="name",
		)
		if restaurants:
			frappe.throw(
				_("Restaurants {0} of another company use this menu").format(", ".join(restaurants)),
				title=_("Company"),
			)


def section_menu_definition(menu):
	"""Explicit menu membership and courses, independent of inventory Item Groups."""
	rows = sorted(menu.get("items") or [], key=lambda row: (cint(row.display_order), cint(row.idx)))
	sections = {
		row.name: row
		for row in frappe.get_all(
			"Menu Section",
			filters={
				"enabled": 1,
				"name": ["in", list({row.menu_section for row in rows if row.menu_section}) or [""]],
			},
			fields=["name", "section_name", "display_order"],
		)
	}
	include, exclude, item_sections = {}, set(), {}
	item_rows = frappe.get_all(
		"Item",
		filters={"name": ["in", [row.item_code for row in rows] or [""]]},
		fields=["name", "item_group"],
	)
	groups = {row.name: row.item_group for row in item_rows}
	for row in rows:
		if row.action == EXCLUDE or not cint(row.get("available", 1)) or row.menu_section not in sections:
			exclude.add(row.item_code)
		else:
			include[row.item_code] = groups.get(row.item_code)
			item_sections[row.item_code] = row.menu_section
	# Explicit variants override inherited membership; a disabled template hides its variants.
	explicit = {row.item_code for row in rows}
	for variant in frappe.get_all(
		"Item",
		filters={"variant_of": ["in", list(groups) or [""]]},
		fields=["name", "variant_of", "item_group"],
	):
		if variant.name in explicit:
			continue
		if variant.variant_of in include:
			include[variant.name] = variant.item_group
			item_sections[variant.name] = item_sections[variant.variant_of]
		else:
			exclude.add(variant.name)
	used = set(item_sections.values())
	categories = [
		{"item_group": section.name, "label": section.section_name, "item_groups": []}
		for section in sorted(
			sections.values(), key=lambda section: (cint(section.display_order), section.section_name)
		)
		if section.name in used
	]
	return {
		"restricted": True,
		"section_menu": True,
		"source": SOURCE_MENU,
		"menu": menu.name,
		"categories": categories,
		"item_groups": [],
		"include_items": include,
		"exclude_items": exclude,
		"sections": item_sections,
		"explicit_items": explicit,
		"item_order": {row.item_code: index for index, row in enumerate(rows)},
	}
