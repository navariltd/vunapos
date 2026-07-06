import frappe

from vunapos.services.profile_service import get_bootstrap_data as get_bootstrap_data_service
from vunapos.utils.response import failure, success


@frappe.whitelist()
def get_bootstrap_data(pos_profile=None):
	try:
		return success(get_bootstrap_data_service(pos_profile=pos_profile))
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)
