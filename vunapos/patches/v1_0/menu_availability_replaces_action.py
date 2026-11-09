import frappe


def execute():
	"""Keep excluded menu items unavailable when retiring the Action control."""
	if not frappe.db.table_exists("Restaurant Menu Item"):
		return
	rows = frappe.qb.DocType("Restaurant Menu Item")
	frappe.qb.update(rows).set(rows.available, 0).where(rows.action == "Exclude").run()
	frappe.qb.update(rows).set(rows.action, "Include").where(rows.action == "Exclude").run()
