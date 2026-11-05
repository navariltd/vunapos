"""Preserve legacy single-branch locations without retaining Branch on Restaurant.

Frappe retains removed database columns. Read that legacy column only during
migration; never drop it or change existing session/kitchen history.
"""

import frappe


def execute():
	if not frappe.db.has_column("Restaurant", "branch"):
		return
	for row in frappe.db.sql(
		"select name, branch from `tabRestaurant` where coalesce(branch, '') != ''", as_dict=True
	):
		for doctype, field, target in (
			("POS Profile", "vunapos_restaurant", "vunapos_branch"),
			("Restaurant Floor", "restaurant", "branch"),
			("Kitchen Station", "restaurant", "branch"),
		):
			for name in frappe.get_all(
				doctype, filters={field: row.name, target: ["is", "not set"]}, pluck="name"
			):
				frappe.db.set_value(doctype, name, target, row.branch, update_modified=False)
	for row in frappe.get_all(
		"Restaurant Table", fields=["name", "floor"], filters={"branch": ["is", "not set"]}
	):
		branch = frappe.db.get_value("Restaurant Floor", row.floor, "branch")
		if branch:
			frappe.db.set_value("Restaurant Table", row.name, "branch", branch, update_modified=False)
	frappe.clear_cache()
