"""The restaurant behind a POS Profile.

A POS Profile is a till in one Branch. Restaurant is the shared Company-level
business; service types can have branch-specific overrides.
"""

import frappe
from frappe import _
from frappe.utils import cint

RESTAURANT_DOCTYPE = "Restaurant"


def validate_branch_company(branch, company):
	if not branch:
		_throw("RESTAURANT_BRANCH_REQUIRED", _("Select the operating Branch on the POS Profile."))
	branch_company = frappe.db.get_value("Branch", branch, "vunapos_company")
	if not branch_company or branch_company != company:
		_throw(
			"RESTAURANT_BRANCH_COMPANY_MISMATCH",
			_("Branch {0} must be assigned to company {1} before using this restaurant.").format(
				branch, company
			),
		)


def require_restaurant_context(restaurant, company=None, branch=None):
	"""Validate location ownership and enforce Frappe User Permissions, including Branch."""
	doc = frappe.get_cached_doc(RESTAURANT_DOCTYPE, restaurant)
	if not cint(doc.enabled):
		_throw("RESTAURANT_DISABLED", _("Restaurant {0} is disabled").format(restaurant))
	if company and doc.company != company:
		_throw(
			"RESTAURANT_COMPANY_MISMATCH", _("Restaurant and POS Profile must belong to the same company.")
		)
	doc.check_permission("read")
	if branch:
		validate_branch_company(branch, doc.company)
		frappe.get_doc("Branch", branch).check_permission("read")
	return doc


def validate_branch_doc(doc, method=None):
	"""Never let a Branch company change invalidate its restaurant history."""
	if not doc.is_new() and doc.has_value_changed("vunapos_company"):
		company = doc.get("vunapos_company") or ""
		conflicts = []
		for doctype, branch_field in (
			("POS Profile", "vunapos_branch"),
			("Kitchen Station", "branch"),
			("Restaurant Session", "branch"),
		):
			conflicts.extend(
				frappe.get_all(
					doctype, filters={branch_field: doc.name, "company": ["!=", company]}, pluck="name"
				)
			)
		for floor in frappe.get_all(
			"Restaurant Floor", filters={"branch": doc.name}, fields=["name", "restaurant"]
		):
			if frappe.get_cached_value("Restaurant", floor.restaurant, "company") != company:
				conflicts.append(floor.name)
		for restaurant in frappe.get_all(
			"Restaurant Service Type Assignment",
			filters={"branch": doc.name, "parenttype": "Restaurant"},
			pluck="parent",
		):
			if frappe.get_cached_value("Restaurant", restaurant, "company") != company:
				conflicts.append(restaurant)
		if conflicts:
			_throw(
				"RESTAURANT_BRANCH_COMPANY_MISMATCH",
				_("Branch is used by restaurants of another company: {0}").format(", ".join(conflicts)),
			)


def backfill_branch_companies():
	"""Only infer ownership from unambiguous existing profiles; never invent locations."""
	if not frappe.db.exists("DocType", RESTAURANT_DOCTYPE):
		return
	companies = {}
	for row in frappe.get_all(
		"POS Profile",
		fields=["vunapos_branch as branch", "company"],
		filters={"vunapos_pos_mode": "Restaurant"},
	):
		if row.branch and row.company:
			companies.setdefault(row.branch, set()).add(row.company)
	for branch, owners in companies.items():
		if len(owners) == 1 and not frappe.db.get_value("Branch", branch, "vunapos_company"):
			frappe.db.set_value("Branch", branch, "vunapos_company", next(iter(owners)))


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


def get_restaurant_profiles(restaurant, branch=None, enabled_only=True):
	"""Enabled tills of a Restaurant, optionally restricted to one operating Branch."""
	filters = {"vunapos_restaurant": restaurant}
	if enabled_only:
		filters["disabled"] = 0
	if branch:
		filters["vunapos_branch"] = branch
	return frappe.get_all("POS Profile", filters=filters, pluck="name")


def require_restaurant_access(restaurant, user=None, branch=None):
	"""Staff assigned to a till in this Restaurant/Branch may work on its operations."""
	user = user or frappe.session.user
	if user != frappe.session.user:
		raise frappe.PermissionError(_("Restaurant access must be checked for the current user."))
	require_restaurant_context(restaurant, branch=branch)
	profiles = get_restaurant_profiles(restaurant, branch) if restaurant else []
	if not profiles or not frappe.db.exists("POS Profile User", {"parent": ["in", profiles], "user": user}):
		exc = frappe.PermissionError(
			_("User {0} is not assigned to any POS Profile of restaurant {1}").format(user, restaurant)
		)
		exc.vuna_error_code = "POS_PROFILE_NOT_ASSIGNED"
		exc.vuna_error_meta = {"restaurant": restaurant}
		raise exc


def validate_restaurant_doc(doc):
	"""Restaurant validate. Desk-only, so it uses frappe.throw."""
	seen, defaults = set(), set()
	for row in doc.get("service_types") or []:
		branch = row.get("branch") or None
		scope = branch or _("Unspecified branches")
		if branch:
			validate_branch_company(branch, doc.company)
		key = (row.service_type, branch)
		if key in seen:
			frappe.throw(
				_("Row {0}: Service type {1} is listed more than once for {2}.").format(
					row.idx, row.service_type, scope
				),
				title=_("Service Types"),
			)
		seen.add(key)
		if cint(row.is_default):
			if branch in defaults:
				frappe.throw(
					_("Only one service type can be the default for {0}.").format(scope),
					title=_("Service Types"),
				)
			defaults.add(branch)
	if doc.default_menu:
		menu = frappe.get_cached_doc("Restaurant Menu", doc.default_menu)
		menu_company = menu.company
		if menu.get("restaurant") and menu.restaurant != doc.name:
			_throw("MENU_CONTEXT_MISMATCH", _("The default menu belongs to another Restaurant."))
		if menu_company and menu_company != doc.company:
			frappe.throw(
				_("Menu {0} belongs to company {1}, not {2}").format(
					doc.default_menu, menu_company, doc.company
				),
				title=_("Menu"),
			)
	if not doc.is_new() and doc.has_value_changed("company"):
		if any(
			frappe.db.exists(doctype, {"restaurant": doc.name})
			for doctype in ("Restaurant Floor", "Kitchen Station")
		):
			_throw(
				"RESTAURANT_COMPANY_IN_USE",
				_(
					"This Restaurant has branch locations. Create another Restaurant instead of changing its Company."
				),
			)
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


def allow_repeated_order_items():
	"""Turn on Selling Settings "Allow Item to Be Added Multiple Times".

	A restaurant order repeats items (a second round of the same drink, or one
	dish with two different notes), which ERPNext refuses on a Sales Order
	without this setting. Returns True when it was switched on now.
	"""
	if cint(frappe.db.get_single_value("Selling Settings", "allow_multiple_items")):
		return False
	frappe.db.set_single_value("Selling Settings", "allow_multiple_items", 1)
	return True


def on_restaurant_update(doc):
	if cint(doc.enabled) and allow_repeated_order_items():
		frappe.msgprint(
			_(
				"Allow Item to Be Added Multiple Times is now on in Selling Settings, so an order "
				"can hold the same item on several lines."
			),
			title=_("Selling Settings"),
			indicator="blue",
		)


def kiosk_payment_timing(profile):
	from vunapos.setup.utils import KIOSK_PAY_FIRST, KIOSK_PAYMENT_TIMINGS

	timing = profile.get("vunapos_kiosk_payment_timing")
	return timing if timing in KIOSK_PAYMENT_TIMINGS else KIOSK_PAY_FIRST


def kiosk_idle_seconds(profile):
	from vunapos.setup.utils import DEFAULT_KIOSK_IDLE_SECONDS

	return cint(profile.get("vunapos_kiosk_idle_seconds")) or DEFAULT_KIOSK_IDLE_SECONDS


def kiosk_floors(profile):
	"""The floors a kiosk offers, or None for every floor of its branch."""
	return {row.floor for row in profile.get("vunapos_kiosk_floors") or [] if row.floor} or None


def _validate_profile_kiosk(profile):
	from vunapos.services.service_type_service import get_profile_service_types

	if not profile.get("customer"):
		frappe.throw(_("Set the Customer that kiosk orders are placed for."), title=_("Kiosk"))
	if not any(
		row.get("enabled") and row.get("role") == "Manager" for row in profile.get("vunapos_pin_users") or []
	):
		frappe.throw(
			_("Add an enabled Manager PIN user. A manager PIN is needed to leave the kiosk."),
			title=_("Kiosk"),
		)
	if not 30 <= kiosk_idle_seconds(profile) <= 3600:
		frappe.throw(_("Kiosk Idle Reset must be between 30 and 3600 seconds."), title=_("Kiosk"))
	selected = [row.service_type for row in profile.get("vunapos_kiosk_service_types") or []]
	if not selected:
		frappe.throw(_("Choose the service types the kiosk offers."), title=_("Kiosk"))
	offered = {row["name"] for row in get_profile_service_types(profile)}
	missing = [name for name in selected if name not in offered]
	if missing:
		frappe.throw(
			_("Service types not offered at this restaurant branch: {0}").format(", ".join(missing)),
			title=_("Kiosk"),
		)
	for row in profile.get("vunapos_kiosk_floors") or []:
		floor = frappe.db.get_value("Restaurant Floor", row.floor, ["restaurant", "branch"], as_dict=True)
		if not floor or (floor.restaurant, floor.branch) != (
			profile.get("vunapos_restaurant"),
			profile.get("vunapos_branch"),
		):
			frappe.throw(
				_("Kiosk floor {0} is not a floor of this restaurant branch.").format(row.floor),
				title=_("Kiosk"),
			)


def _validate_profile_qr(profile):
	from vunapos.services.service_type_service import get_profile_service_types

	title = _("QR Table Ordering")
	if not profile.get("customer"):
		frappe.throw(_("Set the Customer that QR orders are placed for."), title=title)
	service = next(
		(
			row
			for row in get_profile_service_types(profile)
			if row["name"] == profile.get("vunapos_qr_service_type")
		),
		None,
	)
	if not service:
		frappe.throw(_("Choose a QR Service Type offered at this restaurant branch."), title=title)
	if not service["requires_table"]:
		frappe.throw(_("The QR Service Type must use tables, for example Dine In."), title=title)
	if not cint(profile.get("disabled")):
		other = frappe.db.get_value(
			"POS Profile",
			{
				"name": ["!=", profile.name or ""],
				"vunapos_restaurant": profile.get("vunapos_restaurant"),
				"vunapos_branch": profile.get("vunapos_branch"),
				"vunapos_qr_ordering": 1,
				"disabled": 0,
			},
			"name",
		)
		if other:
			frappe.throw(
				_(
					"POS Profile {0} already has QR Table Ordering for this restaurant branch. Switch it off there first."
				).format(other),
				title=title,
			)
	_ensure_qr_user(profile)


def _ensure_qr_user(profile):
	"""The user guest QR orders run as: disabled, so it can never sign in, and without a password."""
	from vunapos.setup.utils import KIOSK_ROLE

	user = profile.get("vunapos_qr_user")
	if not user or not frappe.db.exists("User", user):
		doc = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"qr-ordering-{frappe.generate_hash(length=10)}@vunapos.invalid",
				"first_name": _("QR Ordering"),
				"last_name": profile.get("vunapos_branch"),
				"enabled": 0,
				"send_welcome_email": 0,
				"roles": [{"role": KIOSK_ROLE}],
			}
		)
		doc.flags.no_welcome_mail = True
		doc.insert(ignore_permissions=True)
		user = profile.vunapos_qr_user = doc.name
	if not any(row.user == user for row in profile.get("applicable_for_users") or []):
		profile.append("applicable_for_users", {"user": user})


def validate_profile_restaurant(profile, method=None):
	"""POS Profile validate hook: a Restaurant-mode profile needs a restaurant of its company."""
	if profile.get("vunapos_pos_mode") != "Restaurant":
		if cint(profile.get("vunapos_kiosk_mode")):
			frappe.throw(_("Kiosk Mode is available for Restaurant POS Profiles only."), title=_("Kiosk"))
		if cint(profile.get("vunapos_qr_ordering")):
			frappe.throw(
				_("QR Table Ordering is available for Restaurant POS Profiles only."),
				title=_("QR Table Ordering"),
			)
		return
	if profile.get("vunapos_cancellation_charge_item"):
		from vunapos.services.restaurant_stop_service import validate_charge_item

		validate_charge_item(profile.vunapos_cancellation_charge_item)
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
	validate_branch_company(profile.get("vunapos_branch"), profile.company)
	if not profile.is_new() and any(
		profile.has_value_changed(field) for field in ("vunapos_restaurant", "vunapos_branch")
	):
		if frappe.db.exists("Restaurant Session", {"pos_profile": profile.name}) or frappe.db.exists(
			"Sales Order", {"vunapos_pos_profile": profile.name, "vunapos_restaurant": ["is", "set"]}
		):
			frappe.throw(
				_(
					"This POS Profile has restaurant history. Create a new profile instead of changing its Restaurant or Branch."
				),
				title=_("Restaurant"),
			)
	if cint(profile.get("vunapos_kiosk_mode")):
		_validate_profile_kiosk(profile)
	if cint(profile.get("vunapos_qr_ordering")):
		_validate_profile_qr(profile)
