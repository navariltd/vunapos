import frappe
from frappe.sessions import get_csrf_token as get_session_csrf_token

from vunapos.utils.response import success


@frappe.whitelist(methods=["GET"])
def get_csrf_token():
	try:
		csrf_token = get_session_csrf_token()
	except AttributeError:
		csrf_token = frappe.local.session.data.get("csrf_token") or frappe.generate_hash()
		frappe.local.session.data.csrf_token = csrf_token

	return success({"csrf_token": csrf_token})
