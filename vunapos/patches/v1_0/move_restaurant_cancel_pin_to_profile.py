import frappe


def execute():
	from vunapos.setup.utils import ensure_vunapos_custom_fields

	ensure_vunapos_custom_fields()
	# Removed standard fields retain their DB columns. Preserve existing approval
	# requirements once, without overriding subsequent per-profile choices.
	if not frappe.db.has_column("Restaurant", "require_manager_pin_order_cancel"):
		return
	for restaurant in frappe.get_all(
		"Restaurant", filters={"require_manager_pin_order_cancel": 1}, pluck="name"
	):
		for profile in frappe.get_all(
			"POS Profile", filters={"vunapos_restaurant": restaurant}, pluck="name"
		):
			frappe.db.set_value("POS Profile", profile, "vunapos_require_manager_pin_order_cancel", 1)
