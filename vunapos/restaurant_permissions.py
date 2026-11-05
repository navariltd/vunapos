"""Apply Branch User Permissions to restaurant records in Desk as well as API calls."""

import frappe


def query_conditions(user=None):
	# Restaurant is Company-level. Native Company User Permissions still apply.
	return ""


def _related_conditions(doctype, fieldname, user=None, allow_retail=False):
	restaurants = frappe.get_list(
		"Restaurant", pluck="name", user=user or frappe.session.user, limit_page_length=0
	)
	column = f"`tab{doctype}`.`{fieldname}`"
	condition = "1=0"
	if restaurants:
		values = ", ".join(frappe.db.escape(name) for name in restaurants)
		condition = f"{column} in ({values})"
	branch_column = f"`tab{doctype}`.`branch`"
	if doctype == "Sales Order":
		branch_column = "`tabSales Order`.`vunapos_branch`"
	branches = frappe.get_list("Branch", pluck="name", user=user or frappe.session.user, limit_page_length=0)
	values = ", ".join(frappe.db.escape(name) for name in branches) or "NULL"
	condition = f"({condition}) and {branch_column} in ({values})"
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
	return _station_scoped_conditions("Kitchen Order Ticket", user)


def ticket_action_conditions(user=None):
	return _station_scoped_conditions("Kitchen Ticket Action", user)


def _station_scoped_conditions(doctype, user=None):
	stations = frappe.get_list(
		"Kitchen Station", pluck="name", user=user or frappe.session.user, limit_page_length=0
	)
	if not stations:
		return "1=0"
	values = ", ".join(frappe.db.escape(station) for station in stations)
	return f"({_related_conditions(doctype, 'restaurant', user)}) and `tab{doctype}`.`kitchen_station` in ({values})"


def order_conditions(user=None):
	# Do not affect ordinary retail Sales Orders.
	if not frappe.has_permission("Restaurant", "read", user=user or frappe.session.user):
		return "coalesce(`tabSales Order`.`vunapos_restaurant`, '') = ''"
	return _related_conditions("Sales Order", "vunapos_restaurant", user, allow_retail=True)


def related_has_permission(doc, user=None, permission_type=None):
	branch = doc.get("branch")
	if doc.doctype == "Sales Order" and doc.get("vunapos_restaurant"):
		branch = doc.get("vunapos_branch")
	if branch and not frappe.has_permission("Branch", "read", doc=branch, user=user or frappe.session.user):
		return False
	if (
		doc.doctype in ("Kitchen Order Ticket", "Kitchen Ticket Action")
		and doc.get("kitchen_station")
		and not frappe.has_permission(
			"Kitchen Station", "read", doc=doc.kitchen_station, user=user or frappe.session.user
		)
	):
		return False
	restaurant = doc.get("restaurant") or doc.get("vunapos_restaurant")
	if restaurant and not frappe.has_permission(
		"Restaurant", "read", doc=restaurant, user=user or frappe.session.user
	):
		return False
	return True


def has_permission(doc, user=None, permission_type=None):
	# Ignore the retired Branch column: Restaurant is Company-level now.
	return True
