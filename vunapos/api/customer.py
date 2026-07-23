import frappe

from vunapos.services.customer_service import create_customer as create_customer_service
from vunapos.services.customer_service import get_customer_directory as get_customer_directory_service
from vunapos.services.customer_service import search_customers as search_customers_service
from vunapos.utils.response import failure, success


@frappe.whitelist()
def search_customers(query=None, limit=20):
	try:
		return success(search_customers_service(query=query, limit=limit))
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)


@frappe.whitelist()
def create_customer(customer_name, mobile_no=None, email_id=None):
	try:
		return success(
			create_customer_service(customer_name=customer_name, mobile_no=mobile_no, email_id=email_id)
		)
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)


@frappe.whitelist()
def get_customer_directory(
	pos_profile=None, query=None, customer_group=None, customer_type=None, territory=None, start=0, limit=25
):
	try:
		return success(
			get_customer_directory_service(
				pos_profile=pos_profile,
				query=query,
				customer_group=customer_group,
				customer_type=customer_type,
				territory=territory,
				start=start,
				limit=limit,
			)
		)
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)
