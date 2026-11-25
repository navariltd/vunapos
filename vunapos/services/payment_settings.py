import frappe
from frappe.utils import cint


def require_bank_payment_reference() -> bool:
	if not frappe.get_meta("POS Settings").has_field("vunapos_require_bank_payment_reference"):
		return False
	value = frappe.db.get_singles_dict("POS Settings").get("vunapos_require_bank_payment_reference")
	return bool(cint(value))


def ensure_bank_payment_reference_default():
	values = frappe.db.get_singles_dict("POS Settings")
	if values.get("vunapos_require_bank_payment_reference") in (None, ""):
		frappe.db.set_single_value("POS Settings", "vunapos_require_bank_payment_reference", 0)
