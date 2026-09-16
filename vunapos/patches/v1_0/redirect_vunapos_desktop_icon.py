import frappe


def execute():
	"""Point existing VunaPOS desktop icons directly at the POS route."""
	icon_names = frappe.get_all(
		"Desktop Icon",
		filters={"label": "VunaPOS"},
		pluck="name",
	)
	for icon_name in icon_names:
		frappe.db.set_value(
			"Desktop Icon",
			icon_name,
			{"link": "/vunapos", "link_type": "External"},
			update_modified=False,
		)
	frappe.cache.delete_key("desktop_icons")
