import frappe
from frappe import _

from vunapos.dto.profile import profile_to_dict
from vunapos.utils.permissions import require_read

SUPPORTED_INVOICE_MODES = ("Sales Invoice", "POS Invoice")


def get_invoice_mode():
	invoice_type = frappe.db.get_single_value("POS Settings", "invoice_type") or "Sales Invoice"
	if invoice_type not in SUPPORTED_INVOICE_MODES:
		frappe.throw(_("Unsupported POS invoice type: {0}").format(invoice_type))
	return invoice_type


def resolve_pos_profile(pos_profile=None):
	if pos_profile:
		require_read("POS Profile", pos_profile)

		profile = frappe.get_cached_doc("POS Profile", pos_profile)

	else:
		profiles = frappe.get_all("POS Profile User", filters={"user": frappe.session.user}, pluck="parent")

		if not profiles:
			frappe.throw(_("No POS Profile assigned to user"))

		profile_name = frappe.db.get_value("POS Profile", {"name": ["in", profiles], "disabled": 0}, "name")

		if not profile_name:
			frappe.throw(_("No enabled POS Profile assigned to user"))

		require_read("POS Profile", profile_name)

		profile = frappe.get_cached_doc("POS Profile", profile_name)

	if profile.disabled:
		frappe.throw(_("POS Profile {0} is disabled").format(profile.name))

	return profile


def get_profile_defaults(pos_profile=None):
	profile = resolve_pos_profile(pos_profile)
	return profile_to_dict(profile, get_invoice_mode())


def get_bootstrap_data(pos_profile=None):
	profile = resolve_pos_profile(pos_profile)
	invoice_mode = get_invoice_mode()
	data = profile_to_dict(profile, invoice_mode)
	opening_entry = get_opening_entry(frappe.session.user, profile.name)
	data.update(
		{
			"current_user": frappe.session.user,
			"pos_profile": profile.name,
			"session": {
				"has_opening_entry": bool(opening_entry),
				"opening_entry": opening_entry,
				"ready": bool(opening_entry),
				"status": ("OPEN" if opening_entry else "OPENING_REQUIRED"),
			},
		}
	)
	return data


def get_opening_entry(user, pos_profile):
	return frappe.db.get_value(
		"POS Opening Entry",
		{"user": user, "pos_profile": pos_profile, "docstatus": 1, "status": "Open"},
		"name",
	)
