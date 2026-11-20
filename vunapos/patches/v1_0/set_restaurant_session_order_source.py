import frappe


def execute():
	"""Visits opened before Order Source existed: kiosk visits have a kiosk status."""
	if not frappe.db.has_column("Restaurant Session", "order_source"):
		return
	session = frappe.qb.DocType("Restaurant Session")
	kiosk = session.kiosk_status.isnotnull() & (session.kiosk_status != "")
	unset = session.order_source.isnull() | (session.order_source == "") | (session.order_source == "Waiter")
	frappe.qb.update(session).set(session.order_source, "Kiosk").where(unset & kiosk).run()
	frappe.qb.update(session).set(session.order_source, "Waiter").where(
		session.order_source.isnull() | (session.order_source == "")
	).run()
