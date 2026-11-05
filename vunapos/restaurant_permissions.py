"""Apply Branch User Permissions to restaurant records in Desk as well as API calls."""

import frappe


def query_conditions(user=None):
	if (user or frappe.session.user) == "Administrator":
		return ""
	branches = frappe.get_list("Branch", pluck="name", user=user or frappe.session.user, limit_page_length=0)
	if not branches:
		return "1=0"
	values = ", ".join(frappe.db.escape(branch) for branch in branches)
	return f"`tabRestaurant`.`branch` in ({values})"


def _related_conditions(doctype, fieldname, user=None, allow_retail=False):
	restaurants = frappe.get_list(
		"Restaurant", pluck="name", user=user or frappe.session.user, limit_page_length=0
	)
	column = f"`tab{doctype}`.`{fieldname}`"
	condition = "1=0"
	if restaurants:
		values = ", ".join(frappe.db.escape(name) for name in restaurants)
		condition = f"{column} in ({values})"
	if allow_retail:
		condition = f"({column} is null or {column} = '' or ({condition}))"
	return condition


def floor_conditions(user=None):
	return _related_conditions("Restaurant Floor", "restaurant", user)


def table_conditions(user=None):
	return _related_conditions("Restaurant Table", "restaurant", user)


def session_conditions(user=None):
	return _related_conditions("Restaurant Session", "restaurant", user)


def station_conditions(user=None):
	return _related_conditions("Kitchen Station", "restaurant", user)


def ticket_conditions(user=None):
	return _related_conditions("Kitchen Order Ticket", "restaurant", user)


def order_conditions(user=None):
	# Do not affect ordinary retail Sales Orders.
	if not frappe.has_permission("Restaurant", "read", user=user or frappe.session.user):
		return "coalesce(`tabSales Order`.`vunapos_restaurant`, '') = ''"
	return _related_conditions("Sales Order", "vunapos_restaurant", user, allow_retail=True)


def related_has_permission(doc, user=None, permission_type=None):
	restaurant = doc.get("restaurant") or doc.get("vunapos_restaurant")
	if restaurant and not frappe.has_permission(
		"Restaurant", "read", doc=restaurant, user=user or frappe.session.user
	):
		return False
	return True


def has_permission(doc, user=None, permission_type=None):
	if not doc.get("branch"):
		# Legacy records can still be configured by users with normal document rights.
		return True
	if not frappe.has_permission("Branch", "read", doc=doc.branch, user=user or frappe.session.user):
		return False
	return True
