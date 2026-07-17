import frappe
from frappe.utils import cint, now_datetime

from vunapos.dto.profile import profile_to_dict
from vunapos.services.customer_service import search_customers
from vunapos.services.item_service import search_items
from vunapos.services.profile_service import get_invoice_mode, resolve_pos_profile

# Doctypes the device replicates are read-only. Deleted records are reported
# so the device can remove them from its local copy.
SYNCED_DOCTYPES = ("Item", "Customer")


def _bootstrap_version():
	return cint(frappe.db.get_single_value("POS Settings", "vunapos_bootstrap_version")) or 1


def _tax_template_to_dict(template_name):
	doc = frappe.get_cached_doc("Sales Taxes and Charges Template", template_name)
	return {
		"name": doc.name,
		"title": doc.get("title"),
		"company": doc.company,
		"is_default": bool(doc.get("is_default")),
		"disabled": bool(doc.get("disabled")),
		"modified": doc.get("modified"),
		"taxes": [
			{
				"account_head": row.account_head,
				"charge_type": row.charge_type,
				"rate": row.rate,
				"included_in_print_rate": bool(row.get("included_in_print_rate")),
				"description": row.get("description"),
			}
			for row in doc.get("taxes", [])
		],
	}


def _sync_tax_templates(since=None):
	filters = {}
	if since:
		filters["modified"] = [">", since]
	names = frappe.get_all("Sales Taxes and Charges Template", filters=filters, pluck="name")
	return [_tax_template_to_dict(name) for name in names]


def _item_tax_template_to_dict(template_name):
	doc = frappe.get_cached_doc("Item Tax Template", template_name)
	return {
		"name": doc.name,
		"title": doc.get("title"),
		"company": doc.company,
		"disabled": bool(doc.get("disabled")),
		"modified": doc.get("modified"),
		# Item Tax Template Detail has no charge_type/included_in_print_rate - it is
		# always a flat percentage added on top of that item's own amount.
		"taxes": [{"account_head": row.tax_type, "rate": row.tax_rate} for row in doc.get("taxes", [])],
	}


def _sync_item_tax_templates(since=None):
	filters = {}
	if since:
		filters["modified"] = [">", since]
	names = frappe.get_all("Item Tax Template", filters=filters, pluck="name")
	return [_item_tax_template_to_dict(name) for name in names]


def _get_tax_settings():
	# The active tax configuration is a company setting, not determined by the
	# available templates. The Invoice Engine uses it to match the server.
	return {
		"add_taxes_from_item_tax_template": bool(
			frappe.db.get_single_value("Accounts Settings", "add_taxes_from_item_tax_template")
		),
		"add_taxes_from_taxes_and_charges_template": bool(
			frappe.db.get_single_value("Accounts Settings", "add_taxes_from_taxes_and_charges_template")
		),
	}


def _sync_payment_modes(profile):
	return [
		{"mode_of_payment": row.mode_of_payment, "default": bool(row.get("default"))}
		for row in profile.get("payments", [])
	]


def _deleted_since(since):
	if not since:
		return {}
	rows = frappe.get_all(
		"Deleted Document",
		filters={"deleted_doctype": ["in", list(SYNCED_DOCTYPES)], "creation": [">", since]},
		fields=["deleted_doctype", "deleted_name"],
	)
	deleted = {doctype: [] for doctype in SYNCED_DOCTYPES}
	for row in rows:
		deleted.setdefault(row.deleted_doctype, []).append(row.deleted_name)
	return deleted


def get_pos_bootstrap(pos_profile=None, since=None):
	profile = resolve_pos_profile(pos_profile)
	invoice_mode = get_invoice_mode()
	server_time = now_datetime()
	since = since or None

	result = {
		"server_time": server_time,
		"bootstrap_version": _bootstrap_version(),
		"mode": "delta" if since else "full",
		"pos_profile": profile_to_dict(profile, invoice_mode),
		"items": search_items(pos_profile=profile.name, limit=0, since=since),
		"customers": search_customers(limit=100000, since=since),
		"tax_templates": _sync_tax_templates(since=since),
		"item_tax_templates": _sync_item_tax_templates(since=since),
		"tax_settings": _get_tax_settings(),
		"payment_modes": _sync_payment_modes(profile),
	}
	if since:
		result["deleted"] = _deleted_since(since)
	return result
