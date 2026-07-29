import frappe
from erpnext.accounts.doctype.loyalty_program.loyalty_program import (
	get_loyalty_program_details_with_points,
)
from erpnext.accounts.utils import get_balance_on
from frappe import _
from frappe.utils import cint, flt, getdate, now_datetime, today

from vunapos.dto.customer import customer_to_dict
from vunapos.services.profile_service import get_invoice_mode, resolve_pos_profile
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
	# into both directory search and the active POS catalogue snapshot.
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


def get_customer_loyalty(pos_profile=None, customer=None):
	"""Return the customer's live ERPNext loyalty ledger balance for the active company."""
	profile = resolve_pos_profile(pos_profile)
	if not customer:
		frappe.throw(_("Customer is required"))
	require_read("Customer", customer)
	loyalty_program = frappe.db.get_value("Customer", customer, "loyalty_program")
	if not loyalty_program:
		return {
			"customer": customer,
			"enrolled": False,
			"program": None,
			"tier": None,
			"points": 0.0,
			"conversion_factor": 0.0,
			"redemption_value": 0.0,
			"currency": profile.currency,
		}

	details = get_loyalty_program_details_with_points(
		customer=customer,
		loyalty_program=loyalty_program,
		company=profile.company,
	)
	points = max(flt(details.get("loyalty_points")), 0)
	conversion_factor = max(flt(details.get("conversion_factor")), 0)
	return {
		"customer": customer,
		"enrolled": True,
		"program": details.get("loyalty_program") or loyalty_program,
		"tier": details.get("tier_name"),
		"points": points,
		"conversion_factor": conversion_factor,
		"redemption_value": points * conversion_factor,
		"currency": profile.currency,
	}


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


def _permitted_linked_doc(doctype, name, fields):
	if not name or not frappe.has_permission(doctype, "read", doc=name):
		return None
	return frappe.db.get_value(doctype, name, fields, as_dict=True)


def _customer_invoice_status(row):
	if row.is_return:
		return "Credit Note"
	if flt(row.outstanding_amount) <= 0:
		return "Paid"
	if row.due_date and getdate(row.due_date) < getdate(today()):
		return "Overdue"
	if flt(row.outstanding_amount) < flt(row.grand_total):
		return "Partly Paid"
	return "Unpaid"


def get_customer_details(pos_profile=None, customer=None, invoice_limit=20, payment_limit=20):
	profile = resolve_pos_profile(pos_profile)
	if not customer:
		frappe.throw(_("Customer is required"))
	require_read("Customer", customer)
	customer_doc = frappe.get_doc("Customer", customer)
	invoice_limit = min(max(cint(invoice_limit) or 20, 1), 100)
	payment_limit = min(max(cint(payment_limit) or 20, 1), 100)

	balance = get_balance_on(party_type="Customer", party=customer_doc.name, company=profile.company)
	loyalty = None
	if customer_doc.get("loyalty_program"):
		loyalty_details = get_loyalty_program_details_with_points(
			customer=customer_doc.name,
			loyalty_program=customer_doc.loyalty_program,
			company=profile.company,
		)
		loyalty = {
			"program": loyalty_details.get("loyalty_program"),
			"points": flt(loyalty_details.get("loyalty_points")),
			"tier": loyalty_details.get("tier_name"),
			"conversion_factor": flt(loyalty_details.get("conversion_factor")),
		}

	invoices = []
	invoice_doctype = get_invoice_mode()
	if frappe.has_permission(invoice_doctype, "read"):
		invoice_rows = frappe.get_list(
			invoice_doctype,
			filters={"docstatus": 1, "company": profile.company, "customer": customer_doc.name},
			fields=[
				"name",
				"posting_date",
				"due_date",
				"currency",
				"grand_total",
				"outstanding_amount",
				"is_return",
				"return_against",
			],
			order_by="posting_date desc, modified desc",
			limit_page_length=invoice_limit,
		)
		for row in invoice_rows:
			invoices.append(
				{
					"name": row.name,
					"doctype": invoice_doctype,
					"posting_date": row.posting_date,
					"due_date": row.due_date,
					"currency": row.currency or profile.currency,
					"grand_total": flt(row.grand_total),
					"paid_amount": max(flt(row.grand_total) - flt(row.outstanding_amount), 0),
					"outstanding_amount": flt(row.outstanding_amount),
					"status": _customer_invoice_status(row),
					"is_return": bool(row.is_return),
					"return_against": row.return_against,
				}
			)

	payments = []
	if frappe.has_permission("Payment Entry", "read"):
		payment_rows = frappe.get_list(
			"Payment Entry",
			filters={
				"docstatus": 1,
				"company": profile.company,
				"payment_type": "Receive",
				"party_type": "Customer",
				"party": customer_doc.name,
			},
			fields=[
				"name",
				"posting_date",
				"mode_of_payment",
				"paid_amount",
				"received_amount",
				"unallocated_amount",
				"reference_no",
				"remarks",
			],
			order_by="posting_date desc, modified desc",
			limit_page_length=payment_limit,
		)
		payments = [dict(row) for row in payment_rows]

	contact = _permitted_linked_doc(
		"Contact",
		customer_doc.get("customer_primary_contact"),
		["name", "first_name", "last_name", "email_id", "mobile_no", "phone"],
	)
	address = _permitted_linked_doc(
		"Address",
		customer_doc.get("customer_primary_address"),
		["name", "address_title", "address_line1", "address_line2", "city", "state", "country", "pincode"],
	)
	return {
		"customer": {
			"customer": customer_doc.name,
			"customer_name": customer_doc.customer_name,
			"customer_type": customer_doc.customer_type,
			"customer_group": customer_doc.customer_group,
			"territory": customer_doc.territory,
			"mobile_no": customer_doc.mobile_no,
			"email_id": customer_doc.email_id,
			"tax_id": customer_doc.get("tax_id"),
			"currency": customer_doc.get("default_currency") or profile.currency,
		},
		"balance": flt(balance),
		"loyalty": loyalty,
		"invoices": invoices,
		"payments": payments,
		"contact": contact,
		"address": address,
		"as_of": str(now_datetime()),
	}
