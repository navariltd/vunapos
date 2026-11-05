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
	return frappe.db.get_value("Restaurant Table", table, "table_label") if table else None


def waiter_name(user):
	# The user's full name, falling back to the user id (get_fullname is cached).
	return frappe.utils.get_fullname(user) if user else None


ORDER_STATUS_OPEN = "Open"
ORDER_STATUS_BILLED = "Billed"
ORDER_STATUS_CANCELLED = "Cancelled"
# Sales Order fields order_status() reads; list queries must select them.
ORDER_STATUS_FIELDS = ("docstatus", "status", "per_billed", "vunapos_billing_invoice")


def order_status(order):
	"""A restaurant order's status, derived from its Sales Order.

	Billed once VunaPOS has billed it (even while a queued invoice is still
	being submitted) or ERPNext shows it fully billed. A Sales Order cancelled,
	or closed in Desk before billing, is Cancelled.
	"""
	if cint(order.docstatus) == 2:
		return ORDER_STATUS_CANCELLED
	if order.get("vunapos_billing_invoice") or flt(order.get("per_billed")) >= 100:
		return ORDER_STATUS_BILLED
	if order.get("status") == "Closed":
		return ORDER_STATUS_CANCELLED
	return ORDER_STATUS_OPEN


def line_id(row):
	# Lines added in Desk (Update Items) have no VunaPOS line id; their row name serves.
	return row.get("vunapos_line_id") or row.name


def order_summary_to_dict(row):
	return {
		"restaurant": row.get("vunapos_restaurant"),
		"branch": row.get("vunapos_branch"),
		"restaurant_session": row.get("vunapos_restaurant_session"),
		"name": row.name,
		"status": order_status(row),
		"service_type": row.vunapos_service_type,
		"table": row.vunapos_restaurant_table,
		"table_label": _table_label(row.vunapos_restaurant_table),
		"customer": row.customer,
		"pax": cint(row.vunapos_pax),
		"waiter": row.vunapos_waiter,
		"waiter_name": waiter_name(row.vunapos_waiter),
		"opened_at": row.vunapos_opened_at,
		"invoice_doctype": row.vunapos_billing_doctype,
		"invoice": row.vunapos_billing_invoice,
		"grand_total": flt(row.grand_total),
		"modified": row.modified,
	}


def order_to_dict(doc):
	return {
		"restaurant_session": doc.get("vunapos_restaurant_session"),
		"name": doc.name,
		"status": order_status(doc),
		"sales_order_status": doc.status,
		"pos_profile": doc.vunapos_pos_profile,
		"restaurant": doc.vunapos_restaurant,
		"branch": doc.get("vunapos_branch"),
		"service_type": doc.vunapos_service_type,
		"table": doc.vunapos_restaurant_table,
		"table_label": _table_label(doc.vunapos_restaurant_table),
		"customer": doc.customer,
		"customer_name": doc.customer_name,
		"pax": cint(doc.vunapos_pax),
		"waiter": doc.vunapos_waiter,
		"waiter_name": waiter_name(doc.vunapos_waiter),
		"opened_at": doc.vunapos_opened_at,
		"order_note": doc.vunapos_order_note,
		"items": [
			{
				"line_id": line_id(row),
				"item_code": row.item_code,
				"item_name": row.item_name,
				"qty": flt(row.qty),
				"uom": row.uom,
				"rate": flt(row.rate),
				"amount": flt(row.amount),
				"note": row.vunapos_item_note,
				"modifiers": frappe.parse_json(row.get("vunapos_modifiers") or "[]"),
				"parent_line_id": row.get("vunapos_parent_line_id"),
				"added_by": row.vunapos_added_by or doc.owner,
				"added_at": row.vunapos_added_at or row.creation,
			}
			for row in doc.get("items") or []
		],
		"grand_total": flt(doc.grand_total),
		"invoice_doctype": doc.vunapos_billing_doctype,
		"invoice": doc.vunapos_billing_invoice,
		"billed_by": doc.vunapos_billed_by,
		"billed_at": doc.vunapos_billed_at,
		"cancel_reason": doc.vunapos_cancel_reason,
		"cancel_approved_by": doc.vunapos_cancel_approved_by,
		"cancelled_by": doc.vunapos_cancelled_by,
		"cancelled_at": doc.vunapos_cancelled_at,
		"modified": doc.modified,
	}
