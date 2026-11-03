"""The restaurant behind a POS Profile.

A POS Profile is a till. The restaurant (VunaPOS Restaurant) holds what every
till in it shares: floors and tables, service types and the order rules. A
profile in Restaurant mode links to exactly one restaurant of its own company.
"""

import frappe
from frappe import _
from frappe.utils import cint

RESTAURANT_DOCTYPE = "VunaPOS Restaurant"


def _throw(code, message, meta=None):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	exc.vuna_error_meta = meta or {}
	raise exc


def get_profile_restaurant(profile):
	"""The profile's restaurant document, or None when it has none."""
	name = profile.get("vunapos_restaurant")
	if not name or not frappe.db.exists(RESTAURANT_DOCTYPE, name):
		return None
	return frappe.get_cached_doc(RESTAURANT_DOCTYPE, name)


def require_profile_restaurant(profile):
	restaurant = get_profile_restaurant(profile)
	if not restaurant:
		_throw(
			"RESTAURANT_NOT_SET",
			_("POS Profile {0} is not linked to a restaurant").format(profile.name),
			{"pos_profile": profile.name},
		)
	if not cint(restaurant.enabled):
		_throw(
			"RESTAURANT_DISABLED",
			_("Restaurant {0} is disabled").format(restaurant.name),
			{"restaurant": restaurant.name},
		)
	return restaurant


def get_restaurant_profiles(restaurant):
	"""Every till (POS Profile) of a restaurant."""
	return frappe.get_all("POS Profile", filters={"vunapos_restaurant": restaurant}, pluck="name")


def require_restaurant_access(restaurant, user=None):
	"""Staff of any till in a restaurant may work on its tables and orders."""
	user = user or frappe.session.user
	profiles = get_restaurant_profiles(restaurant) if restaurant else []
	if not profiles or not frappe.db.exists("POS Profile User", {"parent": ["in", profiles], "user": user}):
		exc = frappe.PermissionError(
			_("User {0} is not assigned to any POS Profile of restaurant {1}").format(user, restaurant)
		)
		exc.vuna_error_code = "POS_PROFILE_NOT_ASSIGNED"
		exc.vuna_error_meta = {"restaurant": restaurant}
		raise exc


def validate_restaurant_doc(doc):
	"""VunaPOS Restaurant validate. Desk-only, so it uses frappe.throw."""
	defaults = [row.service_type for row in doc.get("service_types") or [] if cint(row.is_default)]
	if len(defaults) > 1:
		frappe.throw(
			_("Only one service type can be the default. Untick Default on all but one of: {0}").format(
				", ".join(defaults)
			),
			title=_("Service Types"),
		)
	seen = set()
	for row in doc.get("service_types") or []:
		if row.service_type in seen:
			frappe.throw(
				_("Service type {0} is listed more than once").format(row.service_type),
				title=_("Service Types"),
			)
		seen.add(row.service_type)
	if doc.default_menu:
		menu_company = frappe.db.get_value("VunaPOS Menu", doc.default_menu, "company")
		if menu_company and menu_company != doc.company:
			frappe.throw(
				_("Menu {0} belongs to company {1}, not {2}").format(
					doc.default_menu, menu_company, doc.company
				),
				title=_("Menu"),
			)
	if not doc.is_new() and doc.has_value_changed("company"):
		profiles = frappe.get_all(
			"POS Profile",
			filters={"vunapos_restaurant": doc.name, "company": ["!=", doc.company]},
			pluck="name",
		)
		if profiles:
			frappe.throw(
				_("POS Profiles {0} of another company use this restaurant").format(", ".join(profiles)),
				title=_("Company"),
			)


def validate_profile_restaurant(profile, method=None):
	"""POS Profile validate hook: a Restaurant-mode profile needs a restaurant of its company."""
	if profile.get("vunapos_pos_mode") != "Restaurant":
		return
	if not profile.get("vunapos_restaurant"):
		frappe.throw(
			_("Select the Restaurant this POS Profile belongs to"),
			title=_("Restaurant"),
		)
	company = frappe.db.get_value(RESTAURANT_DOCTYPE, profile.vunapos_restaurant, "company")
	if company != profile.company:
		frappe.throw(
			_("Restaurant {0} belongs to company {1}, not {2}").format(
				profile.vunapos_restaurant, company, profile.company
			),
			title=_("Restaurant"),
		)
