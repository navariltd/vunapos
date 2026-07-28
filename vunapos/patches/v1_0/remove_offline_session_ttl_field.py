import frappe


def execute():
	fields = (
		("POS Settings-vunapos_offline_session_ttl_hours", "POS Settings"),
		("Sales Invoice-custom_pos_invoice_number_offline", "Sales Invoice"),
	)
	for field_name, doctype in fields:
		if frappe.db.exists("Custom Field", field_name):
			frappe.delete_doc("Custom Field", field_name, ignore_permissions=True)
			frappe.clear_cache(doctype=doctype)
