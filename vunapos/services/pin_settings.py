import frappe
from frappe.utils import cint

DEFAULT_SALESPERSON_PIN_SESSION_MINUTES = 15
MAX_SALESPERSON_PIN_SESSION_MINUTES = 24 * 60


def get_salesperson_pin_session_minutes() -> int:
	configured = cint(frappe.db.get_single_value("POS Settings", "vunapos_salesperson_pin_session_minutes"))
	return min(
		max(configured or DEFAULT_SALESPERSON_PIN_SESSION_MINUTES, 1),
		MAX_SALESPERSON_PIN_SESSION_MINUTES,
	)
