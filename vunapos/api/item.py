import frappe

from vunapos.services.item_service import get_item_details_for_pos
from vunapos.services.item_service import search_items as search_items_service
from vunapos.utils.response import failure, success


@frappe.whitelist()
def search_items(query=None, pos_profile=None, customer=None, limit=None):
	try:
		return success(
			search_items_service(query=query, pos_profile=pos_profile, customer=customer, limit=limit)
		)
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)


@frappe.whitelist()
def get_item_details(item_code, pos_profile=None, customer=None):
	try:
		return success(
			get_item_details_for_pos(item_code=item_code, pos_profile=pos_profile, customer=customer)
		)
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)
