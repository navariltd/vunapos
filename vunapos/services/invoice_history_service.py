import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate

from vunapos.dto.invoice import invoice_to_dict
from vunapos.services.profile_service import get_invoice_mode, require_open_pos_session, resolve_pos_profile
from vunapos.utils.permissions import require_read


def _status(row):
	if row.docstatus == 2:
		return "Cancelled"
	if row.is_return:
		return "Credit Note"
	if flt(row.outstanding_amount) <= 0:
		return "Paid"
	if row.due_date and getdate(row.due_date) < getdate(nowdate()):
		return "Overdue"
	if flt(row.outstanding_amount) < flt(row.grand_total):
		return "Partly Paid"
	return "Unpaid"


def get_invoice_history(
	pos_profile=None,
	invoice=None,
	customer=None,
	from_date=None,
	to_date=None,
	status=None,
	payment_mode=None,
	sale_type=None,
	current_shift=1,
	start=0,
	page_length=50,
):
	profile = resolve_pos_profile(pos_profile)
	doctype = get_invoice_mode()
	filters = {
		"company": profile.company,
		"pos_profile": profile.name,
		"vunapos_invoice": 1,
		"docstatus": ["in", [1, 2]],
	}

	if invoice:
		filters["name"] = ["like", f"%{invoice}%"]
	if customer:
		filters["customer"] = customer
	if from_date and to_date:
		filters["posting_date"] = ["between", [from_date, to_date]]
	elif from_date:
		filters["posting_date"] = [">=", from_date]
	elif to_date:
		filters["posting_date"] = ["<=", to_date]
	opening_entry = None
	if frappe.utils.cint(current_shift):
		opening_entry = require_open_pos_session(profile.name)
		filters["vunapos_opening_entry"] = opening_entry.name
		filters["vunapos_session_cashier"] = frappe.session.user

	page_length = min(max(int(page_length or 50), 1), 200)
	fields = [
		"name",
		"posting_date",
		"posting_time",
		"customer",
		"customer_name",
		"currency",
		"grand_total",
		"rounded_total",
		"paid_amount",
		"outstanding_amount",
		"total_qty",
		"due_date",
		"docstatus",
		"is_return",
		"return_against",
		"vunapos_opening_entry",
		"vunapos_session_cashier",
		"vunapos_closing_entry",
		"vunapos_credit_sale",
	]
	rows = frappe.get_list(
		doctype,
		filters=filters,
		fields=fields,
		order_by="posting_date desc, posting_time desc, creation desc",
		limit=5000,
	)

	payment_modes = {}
	if rows and frappe.get_meta(doctype).has_field("payments"):
		payment_child = frappe.get_meta(doctype).get_field("payments").options
		payment_child_meta = frappe.get_meta(payment_child)
		payment_fields = ["parent", "mode_of_payment", "amount"]
		for fieldname in ("ke_transaction_id", "ke_transaction_date", "ke_payment_request"):
			if payment_child_meta.has_field(fieldname):
				payment_fields.append(fieldname)
		for payment in frappe.get_all(
			payment_child,
			filters={"parent": ["in", [row.name for row in rows]], "amount": ["!=", 0]},
			fields=payment_fields,
			order_by="idx",
		):
			payment_modes.setdefault(payment.parent, []).append(
				{
					"mode_of_payment": payment.mode_of_payment,
					"amount": flt(payment.amount),
					"transaction_reference": payment.get("ke_transaction_id"),
					"transaction_date": payment.get("ke_transaction_date"),
					"ke_payment_request": payment.get("ke_payment_request"),
				}
			)

	result = []
	for row in rows:
		row_status = _status(row)
		payments = payment_modes.get(row.name, [])
		if status and row_status != status:
			continue
		if payment_mode and payment_mode not in {payment["mode_of_payment"] for payment in payments}:
			continue
		if sale_type == "Credit Sale" and not row.vunapos_credit_sale:
			continue
		if sale_type == "Cash Sale" and row.vunapos_credit_sale:
			continue
		result.append(
			{
				**row,
				"doctype": doctype,
				"status": row_status,
				"payments": payments,
			}
		)

	active_rows = [row for row in result if row["docstatus"] == 1]
	net_sales = sum((-1 if row["is_return"] else 1) * abs(flt(row["grand_total"])) for row in active_rows)
	start = max(int(start or 0), 0)
	paged_result = result[start : start + page_length]
	return {
		"invoices": paged_result,
		"has_more": len(result) > start + page_length,
		"opening_entry": opening_entry.name if opening_entry else None,
		"summary": {
			"invoice_count": sum(1 for row in active_rows if not row["is_return"]),
			"returns_count": sum(1 for row in active_rows if row["is_return"]),
			"gross_sales": sum(flt(row["grand_total"]) for row in active_rows if not row["is_return"]),
			"returns": sum(abs(flt(row["grand_total"])) for row in active_rows if row["is_return"]),
			"net_sales": net_sales,
			"outstanding": sum(max(flt(row["outstanding_amount"]), 0) for row in active_rows),
			"credit_sales": sum(
				flt(row["grand_total"])
				for row in active_rows
				if row.get("vunapos_credit_sale") and not row["is_return"]
			),
			"credit_outstanding": sum(
				max(flt(row["outstanding_amount"]), 0)
				for row in active_rows
				if row.get("vunapos_credit_sale") and not row["is_return"]
			),
		},
	}


def get_invoice_details(pos_profile=None, invoice_name=None):
	profile = resolve_pos_profile(pos_profile)
	doctype = get_invoice_mode()
	require_read(doctype, invoice_name)
	doc = frappe.get_doc(doctype, invoice_name)
	if not doc.get("vunapos_invoice") or doc.company != profile.company or doc.pos_profile != profile.name:
		frappe.throw(_("Invoice is not available for this POS Profile"), frappe.PermissionError)

	returns = frappe.get_list(
		doctype,
		filters={"return_against": doc.name, "docstatus": ["in", [1, 2]]},
		fields=["name", "posting_date", "grand_total", "docstatus"],
		order_by="posting_date desc, creation desc",
		limit=100,
	)
	reference_rows = frappe.get_all(
		"Payment Entry Reference",
		filters={"reference_doctype": doctype, "reference_name": doc.name, "allocated_amount": [">", 0]},
		fields=["parent", "allocated_amount"],
	)
	payment_names = list({row.parent for row in reference_rows})
	payment_entries = []
	if payment_names:
		visible_payments = frappe.get_list(
			"Payment Entry",
			filters={"name": ["in", payment_names], "docstatus": ["in", [1, 2]]},
			fields=[
				"name",
				"posting_date",
				"mode_of_payment",
				"received_amount",
				"unallocated_amount",
				"docstatus",
			],
			limit=100,
		)
		allocated = {row.parent: flt(row.allocated_amount) for row in reference_rows}
		payment_entries = [
			{**row, "allocated_amount": allocated.get(row.name, 0)} for row in visible_payments
		]

	result = invoice_to_dict(doc)
	result.update(
		{
			"currency": doc.currency,
			"posting_time": doc.get("posting_time"),
			"due_date": doc.get("due_date"),
			"status": _status(doc),
			"is_return": bool(doc.is_return),
			"return_against": doc.return_against,
			"pos_profile": doc.pos_profile,
			"warehouse": doc.get("set_warehouse")
			or next((row.warehouse for row in doc.items if row.warehouse), None),
			"opening_entry": doc.get("vunapos_opening_entry"),
			"cashier": doc.get("vunapos_session_cashier"),
			"closing_entry": doc.get("vunapos_closing_entry"),
			"returns": returns,
			"payment_entries": payment_entries,
		}
	)
	return result
