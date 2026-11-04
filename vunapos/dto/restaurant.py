from frappe.utils import cint, flt


def element_to_dict(element):
	return {
		"name": element.name,
		"element_type": element.element_type,
		"label": element.label,
		"x": flt(element.x),
		"y": flt(element.y),
		"width": flt(element.width),
		"height": flt(element.height),
		"rotation": flt(element.rotation),
		"color": element.color,
	}


def table_to_dict(table):
	return {
		"name": table.name,
		"floor": table.floor,
		"table_label": table.table_label,
		"seats": cint(table.seats),
		"shape": table.shape or "Square",
		"x": flt(table.x),
		"y": flt(table.y),
		"width": flt(table.width),
		"height": flt(table.height),
		"rotation": flt(table.rotation),
		"color": table.color,
		"is_active": bool(cint(table.is_active)),
	}


def floor_to_dict(floor, elements, tables):
	return {
		"name": floor.name,
		"floor_name": floor.floor_name,
		"display_order": cint(floor.display_order),
		"is_active": bool(cint(floor.is_active)),
		"background_color": floor.background_color,
		"background_image": floor.background_image,
		"elements": [element_to_dict(element) for element in elements],
		"tables": [table_to_dict(table) for table in tables],
	}
