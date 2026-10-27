import frappe
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


def service_type_to_dict(row, is_default=False):
	return {
		"name": row.name,
		"service_type_name": row.service_type_name,
		"requires_table": bool(cint(row.requires_table)),
		"display_order": cint(row.display_order),
		"description": row.description,
		"price_list": row.price_list,
		"taxes_and_charges": row.taxes_and_charges,
		"is_default": bool(is_default),
	}


def _table_label(table):
	return frappe.db.get_value("VunaPOS Restaurant Table", table, "table_label") if table else None


def waiter_name(user):
	# The user's full name, falling back to the user id (get_fullname is cached).
	return frappe.utils.get_fullname(user) if user else None


def order_summary_to_dict(row):
	return {
		"name": row.name,
		"status": row.status,
		"service_type": row.service_type,
		"table": row.restaurant_table,
		"table_label": _table_label(row.restaurant_table),
		"customer": row.customer,
		"pax": cint(row.pax),
		"waiter": row.waiter,
		"waiter_name": waiter_name(row.waiter),
		"opened_at": row.opened_at,
		"invoice_doctype": row.invoice_doctype,
		"invoice": row.invoice,
		"modified": row.modified,
	}


def order_to_dict(doc):
	return {
		"name": doc.name,
		"status": doc.status,
		"pos_profile": doc.pos_profile,
		"service_type": doc.service_type,
		"table": doc.restaurant_table,
		"table_label": _table_label(doc.restaurant_table),
		"customer": doc.customer,
		"customer_name": frappe.db.get_value("Customer", doc.customer, "customer_name")
		if doc.customer
		else None,
		"pax": cint(doc.pax),
		"waiter": doc.waiter,
		"waiter_name": waiter_name(doc.waiter),
		"opened_at": doc.opened_at,
		"order_note": doc.order_note,
		"items": [
			{
				"line_id": row.line_id,
				"item_code": row.item_code,
				"item_name": row.item_name,
				"qty": flt(row.qty),
				"uom": row.uom,
				"note": row.note,
				"added_by": row.added_by,
				"added_at": row.added_at,
			}
			for row in doc.get("items") or []
		],
		"invoice_doctype": doc.invoice_doctype,
		"invoice": doc.invoice,
		"billed_by": doc.billed_by,
		"billed_at": doc.billed_at,
		"cancel_reason": doc.cancel_reason,
		"cancel_approved_by": doc.cancel_approved_by,
		"cancelled_by": doc.cancelled_by,
		"cancelled_at": doc.cancelled_at,
		"modified": doc.modified,
	}
