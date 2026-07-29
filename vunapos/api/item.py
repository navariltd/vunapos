import frappe

from vunapos.services.item_service import get_item_details_for_pos
from vunapos.services.item_service import search_items as search_items_service
from vunapos.utils.response import failure, success


@frappe.whitelist()
def search_items(
	query: str | None = None,
	pos_profile: str | None = None,
	customer: str | None = None,
	price_list: str | None = None,
	limit: int | None = None,
):
	try:
		return success(
			search_items_service(
				query=query,
				pos_profile=pos_profile,
				customer=customer,
				price_list=price_list,
				limit=limit,
			)
		)
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)


@frappe.whitelist()
def get_item_details(
	item_code: str,
	pos_profile: str | None = None,
	customer: str | None = None,
	price_list: str | None = None,
):
	try:
		return success(
			get_item_details_for_pos(
				item_code=item_code,
				pos_profile=pos_profile,
				customer=customer,
				price_list=price_list,
			)
		)
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)
