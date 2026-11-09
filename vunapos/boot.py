import frappe


def add_setup_app_entry(bootinfo):
	"""Expose the setup launcher on Desk versions that use one entry per app."""
	entries = bootinfo.get("app_data")
	if not isinstance(entries, list):
		return
	if any(row.get("app_name") == "vunapos_setup" for row in entries):
		return
	if not any(row.get("app_name") == "vunapos" and row.get("on_apps_screen") for row in entries):
		return
	setup = next(
		(
			row
			for row in frappe.get_hooks("add_to_apps_screen", app_name="vunapos")
			if row.get("name") == "vunapos_setup"
		),
		None,
	)
	if not setup:
		return
	permission = setup.get("has_permission")
	if permission and not frappe.get_attr(permission)():
		return
	entries.append(
		{
			"on_apps_screen": True,
			"sequence_id": setup.get("sequence_id", 100),
			"app_name": setup["name"],
			"app_title": setup["title"],
			"app_route": setup["route"],
			"desk_route": "",
			"app_logo_url": setup.get("logo"),
			"dock": [],
		}
	)
