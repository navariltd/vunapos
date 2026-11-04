import frappe


def execute():
	"""Materialize legacy group menus once; keep old rows as migration history."""
	from vunapos.services.menu_service import _descendant_item_groups
	from vunapos.setup.utils import ensure_vunapos_custom_fields

	ensure_vunapos_custom_fields()
	for name in frappe.get_all("Restaurant Menu", pluck="name"):
		doc = frappe.get_doc("Restaurant Menu", name)
		if (not doc.items and not doc.item_groups) or (
			any(row.action != "Exclude" for row in doc.items)
			and all(row.action == "Exclude" or row.menu_section for row in doc.items)
		):
			continue
		sections, existing = {}, {row.item_code: row for row in doc.items}
		for group in sorted(doc.item_groups, key=lambda row: (row.display_order or 0, row.idx)):
			label = group.label or group.item_group
			if not frappe.db.exists("Menu Section", label):
				frappe.get_doc(
					{
						"doctype": "Menu Section",
						"section_name": label,
						"display_order": group.display_order or 0,
					}
				).insert(ignore_permissions=True)
			for item in frappe.get_all(
				"Item",
				filters={"item_group": ["in", _descendant_item_groups(group.item_group)]},
				pluck="name",
			):
				sections.setdefault(item, label)
				if item not in existing:
					existing[item] = doc.append(
						"items", {"item_code": item, "action": "Include", "available": 1}
					)
		for item, row in existing.items():
			if row.action == "Exclude":
				continue
			label = row.menu_section or sections.get(item) or frappe.db.get_value("Item", item, "item_group")
			if not frappe.db.exists("Menu Section", label):
				frappe.get_doc({"doctype": "Menu Section", "section_name": label}).insert(
					ignore_permissions=True
				)
			row.menu_section = label
			row.available = 1
		doc.save(ignore_permissions=True)
