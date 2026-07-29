import frappe

from vunapos.services.profile_service import get_bootstrap_data as get_bootstrap_data_service
from vunapos.services.profile_service import get_user_pos_profiles
from vunapos.utils.response import failure, success


@frappe.whitelist()
def get_bootstrap_data(pos_profile=None):
	try:
		return success(get_bootstrap_data_service(pos_profile=pos_profile))
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)


@frappe.whitelist()
def get_pos_profiles_for_user():
	try:
		return success(get_user_pos_profiles())
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)
