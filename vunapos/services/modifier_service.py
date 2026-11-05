"""Menu choices are server-validated; chargeable extras remain normal ERPNext items."""

import json
import math

import frappe
from frappe import _
from frappe.utils import cint, flt


def fail(message):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = "INVALID_MODIFIERS"
	raise exc


def validate_modifier_group(doc):
	minimum, maximum = cint(doc.min_selections), cint(doc.max_selections)
	if minimum < 0 or maximum < 1 or maximum < minimum or maximum > 20:
		fail(_("Choose selection limits between 0 and 20, with maximum at least 1 and not below minimum."))
	labels = set()
	for option in doc.options:
		label = (option.option_label or "").strip().casefold()
		if not label or label in labels:
			fail(_("Modifier choices must have distinct, non-empty labels."))
		labels.add(label)
		if option.addon_item:
			qty = flt(option.addon_qty)
			if not math.isfinite(qty) or qty <= 0:
				fail(_("Add-on quantity must be greater than zero."))
			item = frappe.get_cached_doc("Item", option.addon_item)
			if item.disabled or not item.is_sales_item or item.has_variants:
				fail(_("Add-ons must be enabled sales items, not variant templates."))
			if option.uom and option.uom not in {item.stock_uom, *(row.uom for row in item.uoms)}:
				fail(_("The add-on UOM must belong to its Item."))
	if sum(cint(option.enabled) for option in doc.options) < minimum:
		fail(_("There are not enough enabled choices for the minimum selection count."))
	if len(doc.options) > 50:
		fail(_("A modifier group supports up to 50 choices."))


def validate_item_options(doc, method=None):
	"""Validate Item-owned configuration without altering standard Item permissions."""
	seen = set()
	for row in doc.get("vunapos_restaurant_modifiers") or []:
		if row.modifier_group in seen:
			fail(_("A modifier group can only be assigned once to an Item."))
		seen.add(row.modifier_group)
	seen = set()
	for row in doc.get("vunapos_restaurant_addons") or []:
		key = (row.addon_item, row.uom or frappe.get_cached_value("Item", row.addon_item, "stock_uom"))
		if key in seen:
			fail(_("An add-on Item and UOM can only be listed once."))
		seen.add(key)
		qty = flt(row.addon_qty)
		if not math.isfinite(qty) or qty <= 0:
			fail(_("Add-on quantity must be greater than zero."))
		item = frappe.get_cached_doc("Item", row.addon_item)
		if item.disabled or not item.is_sales_item or item.has_variants:
			fail(_("Add-ons must be enabled sales items, not variant templates."))
		if row.uom and row.uom not in {item.stock_uom, *(unit.uom for unit in item.uoms)}:
			fail(_("The add-on UOM must belong to its Item."))
	if len(doc.get("vunapos_restaurant_addons") or []) > 50:
		fail(_("An Item supports up to 50 add-on choices."))


def item_options_owner(item_code):
	item = frappe.get_cached_doc("Item", item_code)
	if item.get("variant_of") and not (
		item.get("vunapos_restaurant_options_override")
		or item.get("vunapos_restaurant_modifiers")
		or item.get("vunapos_restaurant_addons")
	):
		return frappe.get_cached_doc("Item", item.variant_of)
	return item


def assigned_groups(item_code):
	item = item_options_owner(item_code)
	direct = [
		row.modifier_group for row in item.get("vunapos_restaurant_modifiers") or [] if cint(row.enabled)
	]
	groups = [frappe.get_cached_doc("Restaurant Modifier Group", name) for name in dict.fromkeys(direct)]
	groups = [group for group in groups if cint(group.enabled)]
	addons = [row for row in item.get("vunapos_restaurant_addons") or [] if cint(row.enabled)]
	if addons:
		groups.append(
			frappe._dict(
				name=f"item-addons:{item.name}",
				group_name=_("Add-ons"),
				min_selections=0,
				max_selections=min(20, len(addons)),
				options=[
					frappe._dict(
						name=row.name,
						option_label=row.label
						or frappe.get_cached_value("Item", row.addon_item, "item_name")
						or row.addon_item,
						enabled=1,
						addon_item=row.addon_item,
						addon_qty=row.addon_qty,
						uom=row.uom,
					)
					for row in addons
				],
			)
		)
	return groups


def resolve_selections(item_code, selections):
	"""Return trusted label/item snapshots. Never accept client prices or add-on rows."""
	if isinstance(selections, str):
		try:
			selections = json.loads(selections)
		except (TypeError, ValueError):
			fail(_("Invalid modifier selections."))
	if selections is None:
		selections = []
	if not isinstance(selections, list) or len(selections) > 100:
		fail(_("Invalid modifier selections."))
	groups = assigned_groups(item_code)
	allowed = {group.name: group for group in groups}
	chosen = {}
	for selection in selections:
		if (
			not isinstance(selection, dict)
			or not isinstance(selection.get("group"), str)
			or selection.get("group") not in allowed
		):
			fail(_("This modifier group is not assigned to the item."))
		group = allowed[selection["group"]]
		option = next(
			(row for row in group.options if row.name == selection.get("option") and cint(row.enabled)), None
		)
		if not option:
			fail(_("A selected modifier is no longer available. Please choose again."))
		key = (group.name, option.name)
		if key in chosen:
			fail(_("A modifier choice cannot be selected twice."))
		chosen[key] = {
			"group": group.name,
			"group_label": group.group_name,
			"option": option.name,
			"label": option.option_label,
			"addon_item": option.addon_item,
			"addon_qty": flt(option.addon_qty) if option.addon_item else 0,
			"uom": option.uom
			or (frappe.db.get_value("Item", option.addon_item, "stock_uom") if option.addon_item else None),
		}
	for group in groups:
		count = sum(key[0] == group.name for key in chosen)
		if not cint(group.min_selections) <= count <= cint(group.max_selections):
			fail(
				_("Choose between {0} and {1} options for {2}.").format(
					group.min_selections, group.max_selections, group.group_name
				)
			)
	return list(chosen.values())


def expand_modifier_lines(lines):
	"""One main line plus separately priced/stocked add-ons, linked by immutable line ID."""
	expanded = []
	for line in lines:
		snapshot = resolve_selections(line.item_code, line.get("modifiers"))
		line.modifiers_snapshot = json.dumps(snapshot)
		expanded.append(line)
		for index, choice in enumerate(snapshot):
			if not choice["addon_item"]:
				continue
			expanded.append(
				frappe._dict(
					line_id=f"{line.line_id}:addon:{index}",
					item_code=choice["addon_item"],
					qty=line.qty * choice["addon_qty"],
					uom=choice["uom"],
					note=_("Add-on for {0}: {1}").format(line.item_code, choice["label"]),
					parent_line_id=line.line_id,
					modifiers_snapshot="[]",
				)
			)
	if len({line.line_id for line in expanded}) != len(expanded):
		fail(_("Order line identifiers must be unique, including generated add-ons."))
	return expanded


def menu_modifier_groups(profile, menu, items, customer=None, price_list=None):
	from vunapos.services.item_service import search_items
	from vunapos.services.menu_service import items_priced_in
	from vunapos.services.price_list_service import resolve_price_list

	codes = {item["item_code"] for item in items}
	templates = [item["item_code"] for item in items if item.get("has_variants")]
	if templates:
		codes.update(
			frappe.get_all(
				"Item",
				filters={"variant_of": ["in", templates], "disabled": 0, "is_sales_item": 1},
				pluck="name",
			)
		)
	if menu.get("section_menu"):
		codes.intersection_update(menu["include_items"])
	groups_by_item = {code: assigned_groups(code) for code in codes}
	addons = {
		option.addon_item
		for groups in groups_by_item.values()
		for group in groups
		for option in group.options
		if option.addon_item and cint(option.enabled)
	}
	if len(addons) > 500:
		fail(_("A menu supports up to 500 distinct add-on items."))
	price_list = resolve_price_list(
		profile, customer=customer or profile.customer, requested_price_list=price_list
	)
	priced = items_priced_in(price_list, addons)
	addon_items = (
		{
			item["item_code"]: item
			for item in search_items(
				pos_profile=profile.name,
				customer=customer,
				price_list=price_list,
				item_codes=list(addons),
				limit=500,
			)
		}
		if addons
		else {}
	)
	result = {}
	for code, groups in groups_by_item.items():
		result[code] = []
		for group in groups:
			options = []
			for option in group.options:
				if not cint(option.enabled):
					continue
				item = addon_items.get(option.addon_item, {})
				uom = option.uom or item.get("stock_uom")
				uom_row = next((row for row in item.get("uoms", []) if row["uom"] == uom), {})
				rate = (
					flt(uom_row.get("rate"))
					if uom_row.get("rate") is not None
					else flt(item.get("rate"))
					* flt(uom_row.get("conversion_factor") or 1)
					/ flt(item.get("conversion_factor") or 1)
				)
				options.append(
					{
						"name": option.name,
						"label": option.option_label,
						"addon_item": option.addon_item,
						"addon_qty": flt(option.addon_qty) if option.addon_item else 0,
						"uom": uom,
						"rate": rate,
						"item_tax": item.get("item_tax"),
						"available": not option.addon_item or (option.addon_item in priced and bool(item)),
					}
				)
			result[code].append(
				{
					"name": group.name,
					"label": group.group_name,
					"min_selections": cint(group.min_selections),
					"max_selections": cint(group.max_selections),
					"options": options,
				}
			)
	return result
