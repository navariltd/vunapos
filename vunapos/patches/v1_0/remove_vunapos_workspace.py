import frappe


def execute():
	"""Remove the legacy Desk workspace now that the app opens the POS directly."""
	icon_names = frappe.get_all(
		"Desktop Icon",
		filters={"app": "vunapos", "icon_type": "App"},
		pluck="name",
	)
	if frappe.db.exists("Desktop Icon", "VunaPOS") and "VunaPOS" not in icon_names:
		icon_names.append("VunaPOS")
	for icon_name in icon_names:
		frappe.db.set_value(
			"Desktop Icon",
			icon_name,
			{"link": "/vunapos", "link_type": "External"},
			update_modified=False,
		)
	for doctype, name in (("Workspace Sidebar", "VunaPOS"), ("Workspace", "VunaPOS")):
		if frappe.db.exists(doctype, name):
			frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
	frappe.cache.delete_key("desktop_icons")
