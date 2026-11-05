"""Backfill only unambiguous locations; never overwrite recorded snapshots."""

import frappe


def _stamp(doctype, name, location):
	if not location or not all(location):
		return
	restaurant, branch, company = location
	row = frappe.db.get_value(
		doctype, name, ["vunapos_restaurant", "vunapos_branch", "company"], as_dict=True
	)
	if (
		not row
		or row.company != company
		or (row.vunapos_restaurant and row.vunapos_restaurant != restaurant)
		or (row.vunapos_branch and row.vunapos_branch != branch)
	):
		return
	values = {
		field: value
		for field, value in (("vunapos_restaurant", restaurant), ("vunapos_branch", branch))
		if not row.get(field)
	}
	if values:
		frappe.db.set_value(doctype, name, values, update_modified=False)


def execute():
	from vunapos.setup.utils import ensure_vunapos_custom_fields

	ensure_vunapos_custom_fields()
	for name in frappe.get_all(
		"Sales Order",
		filters={"vunapos_restaurant": ["is", "set"], "vunapos_branch": ["is", "not set"]},
		pluck="name",
	):
		order = frappe.db.get_value(
			"Sales Order", name, ["vunapos_restaurant_session", "vunapos_pos_profile"], as_dict=True
		)
		location = (
			frappe.db.get_value(
				"Restaurant Session", order.vunapos_restaurant_session, ["restaurant", "branch", "company"]
			)
			if order.vunapos_restaurant_session
			else frappe.db.get_value(
				"POS Profile", order.vunapos_pos_profile, ["vunapos_restaurant", "vunapos_branch", "company"]
			)
			if order.vunapos_pos_profile
			else None
		)
		_stamp("Sales Order", name, location)
	for doctype in ("Sales Invoice", "POS Invoice"):
		# Restrict the scan to restaurant sessions and invoices referencing restaurant orders.
		names = set(
			frappe.get_all(doctype, filters={"vunapos_restaurant_session": ["is", "set"]}, pluck="name")
		)
		names.update(
			frappe.db.sql(
				f"SELECT DISTINCT i.parent FROM `tab{doctype} Item` i INNER JOIN `tabSales Order` o ON o.name=i.sales_order WHERE coalesce(o.vunapos_restaurant, '') != ''",
				pluck=True,
			)
		)
		for name in sorted(names):
			doc = frappe.get_doc(doctype, name)
			from vunapos.services.restaurant_location_service import source_location

			try:
				location = source_location(doc)
			except frappe.ValidationError:
				# Mixed historical locations require review, not an invented location.
				continue
			_stamp(doctype, name, location)
