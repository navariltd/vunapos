import frappe
from frappe import _


def get_default_price_list(customer=None, pos_profile=None):
	if customer:
		customer_details = frappe.db.get_value(
			"Customer", customer, ["default_price_list", "customer_group"], as_dict=True
		)
		if customer_details:
			if customer_details.get("default_price_list"):
				return customer_details.default_price_list
			if customer_details.get("customer_group"):
				group_price_list = frappe.db.get_value(
					"Customer Group", customer_details.customer_group, "default_price_list"
				)
				if group_price_list:
					return group_price_list

	if pos_profile and pos_profile.get("selling_price_list"):
		return pos_profile.selling_price_list

	return frappe.db.get_single_value("Selling Settings", "selling_price_list")


def get_permitted_price_lists(pos_profile):
	if not pos_profile.get("vunapos_allow_price_list_switching"):
		return []

	names = list(
		dict.fromkeys(
			row.price_list
			for row in pos_profile.get("vunapos_allowed_price_lists", [])
			if row.get("price_list")
		)
	)
	filters = {"enabled": 1, "selling": 1}
	if names:
		filters["name"] = ["in", names]
	price_lists = frappe.get_all(
		"Price List",
		filters=filters,
		fields=["name", "currency"],
		order_by="name asc",
	)
	return [
		{"name": row.name, "currency": row.currency}
		for row in price_lists
		if frappe.has_permission("Price List", "read", doc=row.name)
	]


def resolve_price_list(pos_profile, customer=None, requested_price_list=None):
	default_price_list = get_default_price_list(customer=customer, pos_profile=pos_profile)
	requested_price_list = (requested_price_list or "").strip() or None
	if not requested_price_list or requested_price_list == default_price_list:
		return default_price_list

	if not pos_profile.get("vunapos_allow_price_list_switching"):
		frappe.throw(_("Price list switching is not allowed for POS Profile {0}").format(pos_profile.name))

	permitted = {row["name"] for row in get_permitted_price_lists(pos_profile)}
	if requested_price_list not in permitted:
		frappe.throw(
			_("Price List {0} is not available for this cashier and POS Profile").format(
				requested_price_list
			),
			frappe.PermissionError,
		)

	price_list_currency = frappe.db.get_value("Price List", requested_price_list, "currency")
	if price_list_currency and price_list_currency != pos_profile.get("currency"):
		frappe.throw(
			_("Price List {0} must use the POS Profile currency {1}").format(
				requested_price_list, pos_profile.get("currency")
			)
		)

	return requested_price_list
