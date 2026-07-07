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
		profile = frappe.get_doc("POS Profile", pos_profile)
	else:
		filters = {"disabled": 0}
		user_profile = frappe.db.get_value("POS Profile User", {"user": frappe.session.user}, "parent")
		profile_name = user_profile or frappe.db.get_value(
			"POS Profile", filters, "name", order_by="modified desc"
		)
		if not profile_name:
			frappe.throw(_("No enabled POS Profile found"))
		require_read("POS Profile", profile_name)
		profile = frappe.get_doc("POS Profile", profile_name)

	if profile.get("disabled"):
		frappe.throw(_("POS Profile {0} is disabled").format(profile.name))

	return profile


def get_profile_defaults(pos_profile=None):
	profile = resolve_pos_profile(pos_profile)
	return profile_to_dict(profile, get_invoice_mode())


def get_bootstrap_data(pos_profile=None):
	profile = resolve_pos_profile(pos_profile)
	invoice_mode = get_invoice_mode()
	data = profile_to_dict(profile, invoice_mode)
	data.update(
		{
			"current_user": frappe.session.user,
			"pos_profile": profile.name,
		}
	)
	return data
