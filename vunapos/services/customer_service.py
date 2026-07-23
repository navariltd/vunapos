import frappe
from erpnext.accounts.doctype.loyalty_program.loyalty_program import (
	get_loyalty_program_details_with_points,
)
from erpnext.accounts.utils import get_balance_on
from frappe import _
from frappe.utils import cint, flt, now_datetime

from vunapos.dto.customer import customer_to_dict
from vunapos.services.profile_service import resolve_pos_profile
from vunapos.utils.permissions import require_create, require_read


def search_customers(query=None, limit=20, since=None):
	limit = cint(limit) or 20
	query = (query or "").strip()
	filters = {"disabled": 0}
	if since:
		filters["modified"] = [">", since]
	or_filters = []
	if query:
		or_filters = [
			["Customer", "name", "like", f"%{query}%"],
			["Customer", "customer_name", "like", f"%{query}%"],
			["Customer", "mobile_no", "like", f"%{query}%"],
			["Customer", "email_id", "like", f"%{query}%"],
		]

	# get_list applies Customer permission query conditions; get_all would leak rows
	# into both online search and the device's offline cache.
	customers = frappe.get_list(
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


def get_customer_directory(
	pos_profile=None,
	query=None,
	customer_group=None,
	customer_type=None,
	territory=None,
	start=0,
	limit=25,
):
	"""Return a permission-filtered customer page with live accounting summaries."""
	profile = resolve_pos_profile(pos_profile)
	start = max(cint(start), 0)
	limit = min(max(cint(limit) or 25, 1), 100)
	filters = {"disabled": 0}
	if customer_group:
		filters["customer_group"] = customer_group
	if customer_type:
		filters["customer_type"] = customer_type
	if territory:
		filters["territory"] = territory

	query = (query or "").strip()
	or_filters = []
	if query:
		like = f"%{query}%"
		or_filters = [
			["Customer", "name", "like", like],
			["Customer", "customer_name", "like", like],
			["Customer", "mobile_no", "like", like],
			["Customer", "email_id", "like", like],
		]

	fields = [
		"name",
		"customer_name",
		"customer_type",
		"customer_group",
		"territory",
		"mobile_no",
		"email_id",
		"default_currency",
		"loyalty_program",
		"modified",
	]
	customers = frappe.get_list(
		"Customer",
		filters=filters,
		or_filters=or_filters,
		fields=fields,
		start=start,
		page_length=limit,
		order_by="customer_name asc",
	)
	count_rows = frappe.get_list(
		"Customer",
		filters=filters,
		or_filters=or_filters,
		fields=[{"COUNT": "*", "as": "total"}],
		limit_page_length=1,
	)
	total_count = cint(count_rows[0].total) if count_rows else 0
	names = [row.name for row in customers]
	filter_rows = frappe.get_list(
		"Customer",
		filters={"disabled": 0},
		fields=["customer_group", "territory"],
		limit_page_length=10000,
	)

	invoice_summary = {}
	financials_visible = bool(names)
	invoice_history_visible = bool(names and frappe.has_permission("Sales Invoice", "read"))
	if invoice_history_visible:
		invoice_rows = frappe.get_list(
			"Sales Invoice",
			filters={
				"docstatus": 1,
				"company": profile.company,
				"customer": ["in", names],
				"is_return": 0,
			},
			fields=[
				"customer",
				{"COUNT": "*", "as": "invoice_count"},
				{"MAX": "posting_date", "as": "last_purchase_date"},
			],
			group_by="customer",
			limit_page_length=len(names),
		)
		invoice_summary = {row.customer: row for row in invoice_rows}

	# ERPNext's own helpers validate access to the Customer and calculate these
	# values from the ledger/loyalty program rather than from client-supplied data.
	loyalty_visible = bool(names)

	data = []
	for customer in customers:
		summary = invoice_summary.get(customer.name)
		customer_balance = None
		if financials_visible:
			customer_balance = get_balance_on(
				party_type="Customer",
				party=customer.name,
				company=profile.company,
			)
		loyalty_points = None
		if loyalty_visible and customer.loyalty_program:
			loyalty = get_loyalty_program_details_with_points(
				customer=customer.name,
				loyalty_program=customer.loyalty_program,
				company=profile.company,
			)
			loyalty_points = flt(loyalty.get("loyalty_points"))
		elif loyalty_visible:
			loyalty_points = 0
		data.append(
			{
				"customer": customer.name,
				"customer_name": customer.customer_name,
				"customer_type": customer.customer_type,
				"customer_group": customer.customer_group,
				"territory": customer.territory,
				"mobile_no": customer.mobile_no,
				"email_id": customer.email_id,
				"currency": customer.default_currency or profile.currency,
				"outstanding_balance": flt(customer_balance) if customer_balance is not None else None,
				"invoice_count": cint(summary.invoice_count)
				if summary
				else (0 if invoice_history_visible else None),
				"last_purchase_date": summary.last_purchase_date if summary else None,
				"loyalty_points": loyalty_points,
				"modified": customer.modified,
			}
		)

	return {
		"customers": data,
		"total_count": total_count,
		"start": start,
		"limit": limit,
		"as_of": str(now_datetime()),
		"financials_visible": financials_visible,
		"loyalty_visible": loyalty_visible,
		"customer_groups": sorted({row.customer_group for row in filter_rows if row.customer_group}),
		"territories": sorted({row.territory for row in filter_rows if row.territory}),
	}
