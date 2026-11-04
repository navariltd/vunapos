"""Rename restaurant masters without losing records, links or permission assignments."""

import frappe

RENAMES = [
	["VunaPOS Restaurant Service Type", "Restaurant Service Type Assignment"],
	["VunaPOS Restaurant Floor", "Restaurant Floor"],
	["VunaPOS Restaurant Table", "Restaurant Table"],
	["VunaPOS Restaurant", "Restaurant"],
	["VunaPOS Menu Item Group", "Restaurant Menu Item Group"],
	["VunaPOS Menu Item", "Restaurant Menu Item"],
	["VunaPOS Menu", "Restaurant Menu"],
	["VunaPOS Service Type", "Restaurant Service Type"],
	["VunaPOS Floor Element", "Restaurant Floor Element"],
]


def execute():
	# Preflight every target before any rename: never merge with another app's master.
	for old, new in RENAMES:
		if frappe.db.exists("DocType", old) and frappe.db.exists("DocType", new):
			frappe.throw(
				f"Cannot rename {old} to {new}: the target DocType already exists. Resolve the naming conflict before migrating."
			)
	for old, new in RENAMES:
		if frappe.db.exists("DocType", old):
			frappe.rename_doc("DocType", old, new, force=True)
