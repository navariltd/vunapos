from decimal import Decimal, InvalidOperation

import frappe
from frappe import _
from frappe.utils import flt, now_datetime

from vunapos.services.profile_service import require_pos_profile_assignment
from vunapos.utils.permissions import require_create, require_read


def validate_opening_balances(profile, opening_balance):
	configured_modes = {row.mode_of_payment for row in profile.get("payments", []) if row.mode_of_payment}
	balances = []
	seen_modes = set()
	for row in opening_balance:
		if not isinstance(row, dict):
			frappe.throw(_("Each opening balance must be an object"))
		mode = row.get("mode_of_payment")
		if not mode or mode not in configured_modes:
			frappe.throw(
				_("Payment mode {0} is not configured for POS Profile {1}").format(
					mode or "(blank)", profile.name
				)
			)
		if mode in seen_modes:
			frappe.throw(_("Duplicate opening balance for payment mode {0}").format(mode))
		seen_modes.add(mode)
		try:
			raw_amount = Decimal(str(row.get("opening_amount", 0)))
		except (InvalidOperation, TypeError, ValueError):
			frappe.throw(_("Invalid opening amount for payment mode {0}").format(mode))
		if not raw_amount.is_finite():
			frappe.throw(_("Invalid opening amount for payment mode {0}").format(mode))
		amount = flt(raw_amount)
		if amount < 0:
			frappe.throw(_("Opening amount cannot be negative for payment mode {0}").format(mode))
		balances.append({"mode_of_payment": mode, "opening_amount": amount})

	missing_modes = configured_modes - seen_modes
	if missing_modes:
		frappe.throw(_("Opening balances are missing for: {0}").format(", ".join(sorted(missing_modes))))
	return balances


def create_pos_opening_entry(
	pos_profile: str,
	opening_balance: list[dict],
	user: str,
):
	"""
	Create and submit a POS Opening Entry
	"""

	if not pos_profile:
		frappe.throw(_("POS Profile is required"))

	if not opening_balance:
		frappe.throw(_("Opening balances are required"))

	require_pos_profile_assignment(pos_profile, user)
	require_read("POS Profile", pos_profile)
	require_create("POS Opening Entry")
	profile = frappe.get_cached_doc("POS Profile", pos_profile)

	if profile.disabled:
		frappe.throw(_("POS Profile {0} is disabled").format(profile.name))

	existing = frappe.db.exists(
		"POS Opening Entry",
		{
			"user": user,
			"pos_profile": pos_profile,
			"status": "Open",
			"docstatus": 1,
		},
	)

	if existing:
		frappe.throw(_("An open POS session already exists for profile {0}").format(pos_profile))

	balances = validate_opening_balances(profile, opening_balance)

	opening_entry = frappe.new_doc("POS Opening Entry")

	opening_entry.user = user
	opening_entry.company = profile.company
	opening_entry.pos_profile = profile.name
	opening_entry.period_start_date = now_datetime()

	for row in balances:
		opening_entry.append(
			"balance_details",
			{
				"mode_of_payment": row.get("mode_of_payment"),
				"opening_amount": row.get("opening_amount", 0),
			},
		)

	opening_entry.insert()
	opening_entry.submit()

	return opening_entry
