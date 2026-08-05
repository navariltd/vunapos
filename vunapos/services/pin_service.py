import hmac
import re
import secrets

import frappe
from frappe import _

from vunapos.services.profile_service import require_pos_profile_assignment, resolve_pos_profile

PIN_PATTERN = re.compile(r"^\d{4,6}$")
TOKEN_TTL_SECONDS = 15 * 60


def _failure(code, message):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	raise exc


def _attempt_key(pos_profile, purpose):
	return f"vunapos:pin-attempts:{frappe.session.user}:{pos_profile}:{purpose}"


def _check_lockout(profile, purpose):
	cache = frappe.cache()
	state = cache.get_value(_attempt_key(profile.name, purpose)) or {}
	if state.get("locked_until") and state["locked_until"] > frappe.utils.now_datetime().timestamp():
		_failure("PIN_LOCKED", _("Too many failed PIN attempts. Try again later."))
	return state


def _record_failure(profile, purpose, state):
	maximum = max(int(profile.get("vunapos_pin_max_attempts") or 5), 1)
	attempts = int(state.get("attempts") or 0) + 1
	lockout = int(profile.get("vunapos_pin_lockout_minutes") or 5)
	updated = {"attempts": attempts}
	if attempts >= maximum:
		updated = {
			"attempts": 0,
			"locked_until": frappe.utils.now_datetime().timestamp() + lockout * 60,
		}
	frappe.cache().set_value(_attempt_key(profile.name, purpose), updated, expires_in_sec=lockout * 60)


def _clear_failures(profile, purpose):
	frappe.cache().delete_value(_attempt_key(profile.name, purpose))


def _issue_token(profile, purpose, subject=None):
	token = secrets.token_urlsafe(32)
	frappe.cache().set_value(
		f"vunapos:pin-token:{token}",
		{
			"user": frappe.session.user,
			"pos_profile": profile.name,
			"purpose": purpose,
			"subject": subject,
		},
		expires_in_sec=TOKEN_TTL_SECONDS,
	)
	return token


def verify_salesperson_pin(pos_profile: str, salesperson: str, pin: str) -> dict:
	profile = resolve_pos_profile(pos_profile)
	require_pos_profile_assignment(profile.name)
	if not isinstance(salesperson, str) or not salesperson.strip():
		_failure("INVALID_SALESPERSON", _("Select a salesperson before entering a PIN."))
	# PIN identities are ERPNext Sales Person records. They are deliberately
	# independent of the logged-in Frappe User so several cashiers can share a
	# terminal account while retaining individual sales attribution.
	if not frappe.db.exists("Sales Person", salesperson):
		_failure("INVALID_SALESPERSON", _("The selected salesperson does not exist."))
	if not profile.get("vunapos_enable_salesperson_pin"):
		_failure("PIN_NOT_ENABLED", _("Salesperson PIN verification is not enabled for this POS Profile."))
	if not isinstance(pin, str) or not PIN_PATTERN.fullmatch(pin):
		_failure("INVALID_PIN_FORMAT", _("PIN must contain 4 to 6 digits."))
	state = _check_lockout(profile, "salesperson")
	row = next(
		(
			row
			for row in profile.get("vunapos_pin_users", [])
			if row.get("enabled")
			and row.get("role") == "Salesperson"
			and row.get("sales_person") == salesperson
		),
		None,
	)
	valid = False
	if row:
		try:
			valid = hmac.compare_digest(row.get_password("pin"), pin)
		except Exception:
			valid = False
	if not valid:
		_record_failure(profile, "salesperson", state)
		_failure("INVALID_PIN", _("The salesperson PIN is incorrect."))
	_clear_failures(profile, "salesperson")
	return {
		"token": _issue_token(profile, "salesperson", salesperson),
		"salesperson": salesperson,
		"sales_person": salesperson,
		"display_name": row.get("display_name") or salesperson,
		"expires_in": TOKEN_TTL_SECONDS,
	}


def verify_manager_pin(pos_profile: str, pin: str, action: str = "item_removal") -> dict:
	profile = resolve_pos_profile(pos_profile)
	require_pos_profile_assignment(profile.name)
	if action == "item_removal" and not profile.get("vunapos_require_manager_pin_item_removal"):
		_failure("MANAGER_PIN_NOT_REQUIRED", _("Manager PIN approval is not enabled for item removal."))
	if not isinstance(pin, str) or not PIN_PATTERN.fullmatch(pin):
		_failure("INVALID_PIN_FORMAT", _("PIN must contain 4 to 6 digits."))
	state = _check_lockout(profile, "manager")
	valid_manager = None
	for row in profile.get("vunapos_pin_users", []):
		if not row.get("enabled") or row.get("role") != "Manager":
			continue
		try:
			if hmac.compare_digest(row.get_password("pin"), pin):
				valid_manager = row
				break
		except Exception:
			continue
	if not valid_manager:
		_record_failure(profile, "manager", state)
		_failure("INVALID_MANAGER_PIN", _("The manager PIN is incorrect."))
	_clear_failures(profile, "manager")
	return {
		"token": _issue_token(profile, "manager", valid_manager.get("sales_person")),
		"manager": valid_manager.get("sales_person"),
		"sales_person": valid_manager.get("sales_person"),
		"display_name": valid_manager.get("display_name") or valid_manager.get("sales_person"),
		"expires_in": TOKEN_TTL_SECONDS,
	}
