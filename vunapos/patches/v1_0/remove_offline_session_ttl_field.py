import frappe


def execute():
	field_name = "POS Settings-vunapos_offline_session_ttl_hours"
	if frappe.db.exists("Custom Field", field_name):
		frappe.delete_doc("Custom Field", field_name, ignore_permissions=True)
		frappe.clear_cache(doctype="POS Settings")
