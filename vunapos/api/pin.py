import frappe

from vunapos.services.pin_service import verify_manager_pin, verify_salesperson_pin
from vunapos.utils.response import success


@frappe.whitelist(methods=["POST"])
def verify_salesperson(pos_profile: str, salesperson: str, pin: str):
	try:
		return success(verify_salesperson_pin(pos_profile, salesperson, pin))
	except Exception as exc:
		from vunapos.api.sales import _failure_from_exception

		return _failure_from_exception(exc)


@frappe.whitelist(methods=["POST"])
def verify_manager(pos_profile: str, pin: str, action: str = "item_removal"):
	try:
		return success(verify_manager_pin(pos_profile, pin, action))
	except Exception as exc:
		from vunapos.api.sales import _failure_from_exception

		return _failure_from_exception(exc)
