"""Immutable commercial location snapshots, independent of today's till settings."""

import frappe
from frappe import _

from vunapos.services.restaurant_service import validate_branch_company


def fail(message):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = "RESTAURANT_LOCATION_MISMATCH"
	raise exc


def source_location(doc):
	"""Authoritative location: visit first, otherwise originating order/till."""
	if doc.get("vunapos_restaurant_session"):
		return frappe.db.get_value(
			"Restaurant Session", doc.vunapos_restaurant_session, ["restaurant", "branch", "company"]
		)
	if doc.doctype == "Sales Order" and doc.get("vunapos_restaurant"):
		if not doc.get("vunapos_pos_profile"):
			fail(_("Select the originating POS Profile for this restaurant order."))
		return frappe.db.get_value(
			"POS Profile", doc.get("vunapos_pos_profile"), ["vunapos_restaurant", "vunapos_branch", "company"]
		)
	if doc.doctype in ("Sales Invoice", "POS Invoice"):
		names = {row.get("sales_order") for row in doc.get("items") or [] if row.get("sales_order")}
		rows = (
			frappe.get_all(
				"Sales Order",
				filters={"name": ["in", sorted(names)]},
				fields=["vunapos_restaurant", "vunapos_branch", "company"],
			)
			if names
			else []
		)
		if any(row.vunapos_restaurant for row in rows):
			locations = {(row.vunapos_restaurant, row.vunapos_branch, row.company) for row in rows}
			if len(locations) != 1:
				fail(_("A restaurant invoice cannot combine orders from different Restaurants or Branches."))
			return next(iter(locations))
	return None


def validate_location_snapshot(doc, method=None):
	before = doc.get_doc_before_save()
	if before and before.get("vunapos_restaurant"):
		if doc.get("vunapos_restaurant") != before.vunapos_restaurant or (
			before.get("vunapos_branch") and doc.get("vunapos_branch") != before.vunapos_branch
		):
			fail(_("Restaurant and Branch cannot be changed after the document's location is recorded."))
	location = source_location(doc)
	if location:
		restaurant, branch, company = location
		if not restaurant or not branch or company != doc.company:
			fail(_("The source must have a Restaurant and Branch belonging to this Company."))
		if (doc.get("vunapos_restaurant") and doc.vunapos_restaurant != restaurant) or (
			doc.get("vunapos_branch") and doc.vunapos_branch != branch
		):
			fail(_("Restaurant and Branch must match the originating order or session."))
		doc.vunapos_restaurant, doc.vunapos_branch = restaurant, branch
	if not doc.get("vunapos_restaurant"):
		return
	if frappe.get_cached_value("Restaurant", doc.vunapos_restaurant, "company") != doc.company:
		fail(_("Restaurant and document must belong to the same Company."))
	validate_branch_company(doc.get("vunapos_branch"), doc.company)
	profile_name = doc.get("vunapos_pos_profile") if doc.doctype == "Sales Order" else doc.get("pos_profile")
	if profile_name:
		pair = frappe.db.get_value("POS Profile", profile_name, ["vunapos_restaurant", "vunapos_branch"])
		if tuple(pair or ()) != (doc.vunapos_restaurant, doc.vunapos_branch):
			fail(_("The POS Profile must belong to the document's Restaurant and Branch."))
