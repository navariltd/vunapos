import frappe

from vunapos.setup.utils import DEFAULT_POS_MODE, ensure_vunapos_custom_fields


def execute():
	if not frappe.db.table_exists("POS Profile"):
		return
	# Post-model-sync patches run before the after_migrate hook that creates
	# VunaPOS custom fields, so an upgraded site has no column yet.
	ensure_vunapos_custom_fields()
	if not frappe.db.has_column("POS Profile", "vunapos_pos_mode"):
		return
	for name in frappe.get_all(
		"POS Profile",
		or_filters=[["vunapos_pos_mode", "is", "not set"], ["vunapos_pos_mode", "=", ""]],
		pluck="name",
	):
		frappe.db.set_value(
			"POS Profile",
			name,
			"vunapos_pos_mode",
			DEFAULT_POS_MODE,
			update_modified=False,
		)
