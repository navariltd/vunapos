import frappe
from frappe import _
from frappe.utils import add_to_date, cint, get_datetime

from vunapos.dto.profile import profile_to_dict

SUPPORTED_INVOICE_MODES = ("Sales Invoice", "POS Invoice")


def get_offline_session_ttl_hours():
	configured = cint(frappe.db.get_single_value("POS Settings", "vunapos_offline_session_ttl_hours"))
	if configured > 0:
		return configured

	field = frappe.get_meta("POS Settings").get_field("vunapos_offline_session_ttl_hours")
	default_value = cint(field.default) if field else 0
	if default_value <= 0:
		frappe.throw(_("VunaPOS Maximum Offline Session Age must be greater than zero"))
	return default_value


def _session_error(code, message, meta=None):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	exc.vuna_error_meta = meta or {}
	raise exc


def _profile_error(code, message, exc_type=frappe.ValidationError):
	exc = exc_type(message)
	exc.vuna_error_code = code
	raise exc


def _require_profile_read(pos_profile):
	if not frappe.has_permission("POS Profile", "read", doc=pos_profile):
		_profile_error(
			"POS_PROFILE_READ_DENIED",
			_("User {0} is assigned to POS Profile {1} but does not have permission to read it").format(
				frappe.session.user, pos_profile
			),
			frappe.PermissionError,
		)


def get_invoice_mode():
	invoice_type = frappe.db.get_single_value("POS Settings", "invoice_type") or "Sales Invoice"
	if invoice_type not in SUPPORTED_INVOICE_MODES:
		frappe.throw(_("Unsupported POS invoice type: {0}").format(invoice_type))
	return invoice_type


def resolve_pos_profile(pos_profile=None):
	if pos_profile:
		require_pos_profile_assignment(pos_profile)
		_require_profile_read(pos_profile)

		profile = frappe.get_cached_doc("POS Profile", pos_profile)

	else:
		profiles = frappe.get_all("POS Profile User", filters={"user": frappe.session.user}, pluck="parent")

		if not profiles:
			_profile_error("POS_PROFILE_NOT_ASSIGNED", _("No POS Profile is assigned to this user"))

		profile_name = frappe.db.get_value("POS Profile", {"name": ["in", profiles], "disabled": 0}, "name")

		if not profile_name:
			_profile_error("POS_PROFILE_NOT_ENABLED", _("No enabled POS Profile is assigned to this user"))

		_require_profile_read(profile_name)

		profile = frappe.get_cached_doc("POS Profile", profile_name)

	if profile.disabled:
		frappe.throw(_("POS Profile {0} is disabled").format(profile.name))

	return profile


def require_pos_profile_assignment(pos_profile, user=None):
	user = user or frappe.session.user
	if not user or user == "Guest":
		frappe.throw(_("A signed-in POS user is required"), frappe.PermissionError)
	if not frappe.db.exists("POS Profile User", {"parent": pos_profile, "user": user}):
		frappe.throw(
			_("POS Profile {0} is not assigned to user {1}").format(pos_profile, user),
			frappe.PermissionError,
		)


def get_pos_session(user, pos_profile, verified_at=None):
	entry = frappe.db.get_value(
		"POS Opening Entry",
		{"user": user, "pos_profile": pos_profile, "docstatus": 1, "status": "Open"},
		["name", "period_start_date"],
		as_dict=True,
	)
	closing = None
	if entry:
		closing = frappe.db.get_value(
			"POS Closing Entry",
			{
				"pos_opening_entry": entry.name,
				"docstatus": 1,
				"status": ["in", ["Queued", "Failed"]],
			},
			["name", "status"],
			as_dict=True,
		)
	ready = bool(entry) and not closing
	status = "OPEN" if ready else "OPENING_REQUIRED"
	if closing:
		status = "CLOSING" if closing.status == "Queued" else "CLOSING_FAILED"
	return {
		"has_opening_entry": bool(entry),
		"opening_entry": entry.name if entry else None,
		"opened_at": entry.period_start_date if entry else None,
		"verified_at": verified_at,
		"cashier": user,
		"pos_profile": pos_profile,
		"ready": ready,
		"status": status,
		"closing_entry": closing.name if closing else None,
	}


def require_open_pos_session(pos_profile, user=None):
	user = user or frappe.session.user
	require_pos_profile_assignment(pos_profile, user)
	session = get_pos_session(user, pos_profile)
	if session["status"] in ("CLOSING", "CLOSING_FAILED"):
		_session_error(
			"POS_SESSION_CLOSING",
			_("POS session {0} is already being closed").format(session["opening_entry"]),
			{"closing_entry": session["closing_entry"], "status": session["status"]},
		)
	if not session["ready"]:
		_session_error(
			"POS_OPENING_REQUIRED",
			_("An open POS session is required for profile {0}").format(pos_profile),
			{"pos_profile": pos_profile, "cashier": user},
		)
	return frappe.get_doc("POS Opening Entry", session["opening_entry"])


def validate_historical_pos_session(
	pos_profile, opening_entry, cashier, posting_date, posting_time=None, verified_at=None
):
	user = frappe.session.user
	require_pos_profile_assignment(pos_profile, user)
	if not opening_entry or not cashier or not posting_date or not verified_at:
		_session_error(
			"POS_SESSION_METADATA_REQUIRED",
			_("This queued sale has no complete verified POS session metadata"),
		)
	if cashier != user:
		_session_error(
			"POS_SESSION_CASHIER_MISMATCH",
			_("The queued sale belongs to cashier {0}, not {1}").format(cashier, user),
		)
	if not frappe.db.exists("POS Opening Entry", opening_entry):
		_session_error(
			"POS_SESSION_NOT_FOUND",
			_("POS Opening Entry {0} was not found").format(opening_entry),
		)

	entry = frappe.get_doc("POS Opening Entry", opening_entry)
	if entry.docstatus != 1 or entry.status not in ("Open", "Closed"):
		_session_error(
			"POS_SESSION_INVALID",
			_("POS Opening Entry {0} is cancelled or invalid").format(opening_entry),
		)
	if entry.user != cashier or entry.pos_profile != pos_profile:
		_session_error(
			"POS_SESSION_MISMATCH",
			_("POS Opening Entry {0} does not match this cashier and profile").format(opening_entry),
		)

	try:
		sale_at = get_datetime(f"{posting_date} {posting_time or '00:00:00'}")
		verified = get_datetime(verified_at)
	except (TypeError, ValueError):
		_session_error("POS_SESSION_TIME_INVALID", _("The queued sale has invalid session timestamps"))

	opened_at = get_datetime(entry.period_start_date)
	if sale_at < opened_at or verified < opened_at:
		_session_error(
			"POS_SESSION_TIME_INVALID",
			_("The queued sale predates POS Opening Entry {0}").format(opening_entry),
		)
	if sale_at > add_to_date(opened_at, hours=get_offline_session_ttl_hours()):
		_session_error(
			"POS_SESSION_CACHE_EXPIRED",
			_("The cached POS session had expired before this offline sale was completed"),
		)

	closed_at = None
	if entry.status == "Closed":
		if entry.get("pos_closing_entry") and frappe.db.exists("POS Closing Entry", entry.pos_closing_entry):
			closed_at = frappe.db.get_value("POS Closing Entry", entry.pos_closing_entry, "period_end_date")
		fallback_end = closed_at or entry.get("period_end_date")
		closed_at = get_datetime(fallback_end) if fallback_end else None
		if not closed_at or sale_at > closed_at:
			_session_error(
				"POS_SESSION_CLOSED_BEFORE_SALE",
				_("POS Opening Entry {0} was closed before this sale").format(opening_entry),
			)

	return entry


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
			"session": get_pos_session(frappe.session.user, profile.name, frappe.utils.now_datetime()),
		}
	)
	return data


def get_opening_entry(user, pos_profile):
	return get_pos_session(user, pos_profile).get("opening_entry")


@frappe.whitelist()
def get_user_pos_profiles():
	profiles = frappe.get_all("POS Profile User", filters={"user": frappe.session.user}, pluck="parent")

	if not profiles:
		frappe.throw(_("No POS Profile assigned to user"))

	enabled_profiles = frappe.get_all(
		"POS Profile",
		filters={"name": ["in", profiles], "disabled": 0},
		fields=[
			"name",
			"company",
			"warehouse",
			"currency",
		],
	)

	if not enabled_profiles:
		frappe.throw(_("No enabled POS Profile assigned to user"))

	# Attach payment modes
	for profile in enabled_profiles:
		profile["modes_of_payment"] = frappe.get_all(
			"POS Payment Method",
			filters={"parent": profile.name},
			fields=["mode_of_payment", "default"],
			order_by="idx",
		)

	return enabled_profiles
