import frappe
from frappe import _


def execute():
	"""Preserve menu assignments on Item, without silently choosing conflicting defaults."""
	from vunapos.setup.utils import ensure_vunapos_custom_fields

	ensure_vunapos_custom_fields()
	by_item = {}
	for row in frappe.get_all(
		"Restaurant Menu Modifier",
		filters={"parenttype": "Restaurant Menu"},
		fields=["parent", "item_code", "modifier_group", "idx"],
		order_by="parent asc, idx asc",
	):
		by_item.setdefault(row.item_code, {}).setdefault(row.parent, []).append(row.modifier_group)
	pending = []
	for item_code, menus in by_item.items():
		item = frappe.get_doc("Item", item_code)
		# An explicitly configured Item is already the owner's choice; never overwrite it.
		if item.get("vunapos_restaurant_modifiers") or item.get("vunapos_restaurant_options_override"):
			continue
		if len({frozenset(groups) for groups in menus.values()}) > 1:
			frappe.throw(
				_(
					"Item {0} has different modifier groups across menus {1}. Choose its defaults under Item → Restaurant → Modifier Groups, then migrate again."
				).format(item_code, ", ".join(menus))
			)
		pending.append((item, list(dict.fromkeys(next(iter(menus.values()))))))
	# Detect conflicts before changing any Item, so manual conflict resolution is safe.
	for item, groups in pending:
		for group in groups:
			item.append("vunapos_restaurant_modifiers", {"modifier_group": group, "enabled": 1})
		item.save(ignore_permissions=True)
