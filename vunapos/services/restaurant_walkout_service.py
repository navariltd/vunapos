"""Manager-approved unpaid billing, not permission to offer ordinary credit."""

import frappe
from frappe import _

APPROVAL = object()
MANAGERS = {"System Manager", "VunaPOS Restaurant Manager"}


def require_manager(reason):
	if not set(frappe.get_roles()) & MANAGERS:
		frappe.throw(_("A restaurant manager must approve a walkout."), frappe.PermissionError)
	if not isinstance(reason, str) or not reason.strip() or len(reason) > 500:
		from vunapos.services.kitchen_service import fail

		fail("WALKOUT_REASON_REQUIRED", _("Enter a walkout reason of up to 500 characters."))
	return reason.strip()


def authorized(doc, profile):
	return bool(
		doc
		and doc.flags.get("restaurant_walkout_approval") is APPROVAL
		and doc.get("vunapos_restaurant_session")
		and doc.doctype in ("Sales Invoice", "POS Invoice")
		and profile.get("vunapos_pos_mode") == "Restaurant"
		and set(frappe.get_roles()) & MANAGERS
	)


def record(session, pos_profile, fingerprint, reason):
	from vunapos.services.restaurant_billing_service import checkout

	return checkout(session, pos_profile, fingerprint, _walkout_reason=require_manager(reason))


def approved_bill(doc):
	"""A workflow may reload an already approved bill without its transient flags."""
	if not doc.get("vunapos_restaurant_session") or doc.is_new():
		return False
	row = frappe.db.get_value(
		"Restaurant Session",
		doc.vunapos_restaurant_session,
		[
			"walkout_reason",
			"walkout_by",
			"walkout_at",
			"billing_doctype",
			"billing_invoice",
			"billing_profile",
			"customer",
			"company",
		],
		as_dict=True,
		for_update=True,
	)
	return bool(
		row
		and row.walkout_reason
		and row.walkout_by
		and row.walkout_at
		and (row.billing_doctype, row.billing_invoice, row.billing_profile, row.customer, row.company)
		== (doc.doctype, doc.name, doc.pos_profile, doc.customer, doc.company)
	)
