import frappe
from frappe import _
from frappe.utils import cint

from vunapos.dto.customer import customer_to_dict
from vunapos.utils.permissions import require_create, require_read


def search_customers(query=None, limit=20):
	limit = cint(limit) or 20
	query = (query or "").strip()
	filters = {"disabled": 0}
	or_filters = []
	if query:
		or_filters = [
			["Customer", "name", "like", f"%{query}%"],
			["Customer", "customer_name", "like", f"%{query}%"],
			["Customer", "mobile_no", "like", f"%{query}%"],
			["Customer", "email_id", "like", f"%{query}%"],
		]

	customers = frappe.get_all(
		"Customer",
		filters=filters,
		or_filters=or_filters,
		fields=["name"],
		limit_page_length=limit,
		order_by="customer_name asc",
	)
	return [customer_to_dict(frappe.get_doc("Customer", row.name)) for row in customers]


def create_customer(customer_name, mobile_no=None, email_id=None):
	if not customer_name:
		frappe.throw(_("Customer name is required"))

	require_create("Customer")
	customer = frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": customer_name,
			"customer_type": "Individual",
			"mobile_no": mobile_no,
			"email_id": email_id,
		}
	)
	customer.insert()
	require_read("Customer", customer.name)
	return customer_to_dict(customer)
