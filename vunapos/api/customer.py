import frappe

from vunapos.services.customer_service import create_customer as create_customer_service
from vunapos.services.customer_service import get_customer_addresses as get_customer_addresses_service
from vunapos.services.customer_service import get_customer_contact_phone as get_customer_contact_phone_service
from vunapos.services.customer_service import get_customer_details as get_customer_details_service
from vunapos.services.customer_service import get_customer_directory as get_customer_directory_service
from vunapos.services.customer_service import get_customer_loyalty as get_customer_loyalty_service
from vunapos.services.customer_service import search_customers as search_customers_service
from vunapos.utils.response import failure, success


@frappe.whitelist()
def search_customers(query=None, limit=20):
	try:
		return success(search_customers_service(query=query, limit=limit))
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)


@frappe.whitelist()
def get_customer_details(pos_profile=None, customer=None, invoice_limit=20, payment_limit=20):
	try:
		return success(
			get_customer_details_service(
				pos_profile=pos_profile,
				customer=customer,
				invoice_limit=invoice_limit,
				payment_limit=payment_limit,
			)
		)
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)


@frappe.whitelist()
def get_customer_loyalty(pos_profile: str | None = None, customer: str | None = None):
	try:
		return success(get_customer_loyalty_service(pos_profile=pos_profile, customer=customer))
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)


@frappe.whitelist()
def get_customer_contact_phone(pos_profile: str | None = None, customer: str | None = None):
	try:
		return success(get_customer_contact_phone_service(pos_profile=pos_profile, customer=customer))
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)


@frappe.whitelist()
def get_customer_addresses(
	pos_profile: str | None = None, customer: str | None = None, limit: int | str | None = 100
):
	try:
		return success(
			get_customer_addresses_service(pos_profile=pos_profile, customer=customer, limit=limit)
		)
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)


@frappe.whitelist()
def create_customer(
	customer_name: str,
	mobile_no: str | None = None,
	email_id: str | None = None,
	pos_profile: str | None = None,
):
	try:
		return success(
			create_customer_service(
				customer_name=customer_name,
				mobile_no=mobile_no,
				email_id=email_id,
				pos_profile=pos_profile,
			)
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
