import frappe
from frappe import _
from frappe.utils import cint

from vunapos.dto.restaurant import service_type_to_dict

SERVICE_TYPE_DOCTYPE = "VunaPOS Service Type"


def _throw(code, message, meta=None):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	exc.vuna_error_meta = meta or {}
	raise exc


def _enabled_service_types():
	return frappe.get_all(
		SERVICE_TYPE_DOCTYPE,
		filters={"enabled": 1},
		fields=[
			"name",
			"service_type_name",
			"requires_table",
			"display_order",
			"description",
			"price_list",
			"taxes_and_charges",
		],
		order_by="display_order asc, service_type_name asc",
	)


def get_profile_service_types(profile):
	"""Return the enabled service types a POS Profile offers, in display order."""
	enabled = _enabled_service_types()
	rows = [row for row in profile.get("vunapos_service_types") or [] if row.service_type]
	if rows:
		offered_names = {row.service_type for row in rows}
		offered = [row for row in enabled if row.name in offered_names]
		ticked = next((row.service_type for row in rows if cint(row.is_default)), None)
	else:
		offered = enabled
		ticked = None
	offered_names = [row.name for row in offered]
	default = ticked if ticked in offered_names else (offered_names[0] if offered_names else None)
	return [service_type_to_dict(row, is_default=row.name == default) for row in offered]


def get_default_service_type(profile):
	return next((row for row in get_profile_service_types(profile) if row["is_default"]), None)


def _is_restaurant_profile(profile):
	return profile.get("vunapos_pos_mode") == "Restaurant"


def get_service_type_price_lists(profile):
	"""Price lists set on the service types this profile offers."""
	if not _is_restaurant_profile(profile):
		return set()
	return {row["price_list"] for row in get_profile_service_types(profile) if row["price_list"]}


def get_service_type_pricing(profile, service_type):
	"""Return {"price_list", "taxes_and_charges"} for an order's service type."""
	pricing = {"price_list": None, "taxes_and_charges": None}
	if not service_type or not _is_restaurant_profile(profile):
		return pricing
	row = resolve_service_type(profile, service_type)
	if row["price_list"]:
		price_list = frappe.db.get_value(
			"Price List", row["price_list"], ["enabled", "selling", "currency"], as_dict=True
		)
		if not price_list or not cint(price_list.enabled) or not cint(price_list.selling):
			_throw(
				"SERVICE_TYPE_PRICE_LIST_INVALID",
				_("Price List {0} on service type {1} must be an enabled selling price list").format(
					row["price_list"], service_type
				),
				{"service_type": service_type, "price_list": row["price_list"]},
			)
		if price_list.currency != profile.get("currency"):
			_throw(
				"SERVICE_TYPE_PRICE_LIST_INVALID",
				_("Price List {0} on service type {1} must use the POS Profile currency {2}").format(
					row["price_list"], service_type, profile.get("currency")
				),
				{"service_type": service_type, "price_list": row["price_list"]},
			)
		pricing["price_list"] = row["price_list"]
	if row["taxes_and_charges"]:
		template_company = frappe.db.get_value(
			"Sales Taxes and Charges Template", row["taxes_and_charges"], "company"
		)
		if template_company != profile.company:
			# Templates belong to one company; service types are shared across them.
			_throw(
				"SERVICE_TYPE_TAX_TEMPLATE_INVALID",
				_("Taxes template {0} on service type {1} belongs to company {2}, not {3}").format(
					row["taxes_and_charges"], service_type, template_company, profile.company
				),
				{"service_type": service_type, "taxes_and_charges": row["taxes_and_charges"]},
			)
		pricing["taxes_and_charges"] = row["taxes_and_charges"]
	return pricing


def resolve_service_type(profile, service_type):
	"""Return the offered service type, or raise if the profile does not offer it."""
	if not service_type:
		_throw("SERVICE_TYPE_REQUIRED", _("Select a service type for this order"))
	row = next((row for row in get_profile_service_types(profile) if row["name"] == service_type), None)
	if not row:
		_throw(
			"SERVICE_TYPE_NOT_ALLOWED",
			_("Service type {0} is not offered by POS Profile {1}").format(service_type, profile.name),
			{"service_type": service_type, "pos_profile": profile.name},
		)
	return row


def validate_profile_service_types(profile, method=None):
	"""POS Profile validate hook: at most one default service type."""
	defaults = [
		row.service_type for row in profile.get("vunapos_service_types") or [] if cint(row.is_default)
	]
	if len(defaults) > 1:
		frappe.throw(
			_("Only one service type can be the default. Untick Default on all but one of: {0}").format(
				", ".join(defaults)
			),
			title=_("Service Types"),
		)
	seen = set()
	for row in profile.get("vunapos_service_types") or []:
		if row.service_type in seen:
			frappe.throw(
				_("Service type {0} is listed more than once").format(row.service_type),
				title=_("Service Types"),
			)
		seen.add(row.service_type)


SERVICE_TAXES_FLAG = "vunapos_service_type_taxes"


def apply_service_type_pricing(doc, profile, for_validate=False):
	"""Re-apply a service type's price list and taxes after ERPNext's POS defaults."""
	from erpnext.controllers.accounts_controller import _get_taxes_and_charges

	pricing = get_service_type_pricing(profile, doc.get("vunapos_service_type"))
	if pricing["price_list"]:
		# set_pos_fields sets the customer's or profile's list on every save; the
		# service type's list wins (pricing rules still apply to it as offers).
		doc.selling_price_list = pricing["price_list"]
	template = pricing["taxes_and_charges"]
	if not template or for_validate:
		# While validating, ERPNext keeps an existing template and its rows.
		return
	doc.taxes_and_charges = template
	if doc.flags.get(SERVICE_TAXES_FLAG) != template:
		# set_pos_fields may have just loaded the profile's tax rows. Replace them
		# with the service type's once per document load; item tax template rows
		# are added back by the recalculation that follows.
		doc.set("taxes", [])
		for tax in _get_taxes_and_charges("Sales Taxes and Charges Template", template):
			doc.append("taxes", tax)
		doc.flags[SERVICE_TAXES_FLAG] = template
