import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate

from vunapos.dto.invoice import invoice_to_dict
from vunapos.services.profile_service import get_invoice_mode, require_open_pos_session, resolve_pos_profile
from vunapos.services.workflow_service import assert_pos_workflow_editable
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


def _sales_order_status(row):
	if row.docstatus == 0:
		return "Draft"
	if row.docstatus == 2:
		return "Cancelled"
	total = flt(row.rounded_total or row.grand_total)
	advance = flt(row.advance_paid)
	if advance >= total and total > 0:
		return "Paid"
	if advance > 0:
		return "Partly Paid"
	return "Unpaid"


def _get_sales_order_history(
	profile,
	invoice=None,
	customer=None,
	from_date=None,
	to_date=None,
	status=None,
	payment_mode=None,
	current_shift=1,
	start=0,
	page_length=50,
	draft_only=False,
):
	page_length = min(max(int(page_length or 50), 1), 200)
	start = max(int(start or 0), 0)
	meta = frappe.get_meta("Sales Order")
	filters = {
		"company": profile.company,
		"vunapos_pos_profile": profile.name,
		"vunapos_invoice": 1,
		"docstatus": 0 if draft_only else ["in", [1, 2]],
	}
	opening_entry = None
	if customer:
		filters["customer"] = customer
	if invoice:
		filters["name"] = ["like", f"%{invoice}%"]
	if from_date and to_date:
		filters["transaction_date"] = ["between", [from_date, to_date]]
	elif from_date:
		filters["transaction_date"] = [">=", from_date]
	elif to_date:
		filters["transaction_date"] = ["<=", to_date]
	if frappe.utils.cint(current_shift):
		opening_entry = require_open_pos_session(profile.name)
		filters["vunapos_opening_entry"] = opening_entry.name
		filters["vunapos_session_cashier"] = frappe.session.user

	fields = [
		"name",
		"transaction_date",
		"transaction_time",
		"customer",
		"customer_name",
		"currency",
		"grand_total",
		"rounded_total",
		"advance_paid",
		"total_qty",
		"delivery_date",
		"docstatus",
		"creation",
	]
	# ``name`` is Frappe's implicit document identifier and is not always
	# reported by ``Meta.has_field``. Keep it explicitly so draft-order rows
	# retain the identifier needed by the POS list and details view.
	fields = [field for field in fields if field in {"name", "creation"} or meta.has_field(field)]
	for fieldname in (
		"vunapos_opening_entry",
		"vunapos_session_cashier",
		"vunapos_closing_entry",
	):
		if meta.has_field(fieldname):
			fields.append(fieldname)
	rows = frappe.get_list(
		"Sales Order",
		filters=filters,
		fields=fields,
		order_by="transaction_date desc, creation desc",
		limit=5000,
	)
	refs = (
		frappe.get_all(
			"Payment Entry Reference",
			filters={
				"reference_doctype": "Sales Order",
				"reference_name": ["in", [row.name for row in rows]],
				"allocated_amount": [">", 0],
			},
			fields=["parent", "reference_name", "allocated_amount"],
		)
		if rows
		else []
	)
	payment_names = list({row.parent for row in refs})
	payment_rows = (
		frappe.get_all(
			"Payment Entry",
			filters={"name": ["in", payment_names], "docstatus": 1},
			fields=["name", "mode_of_payment", "received_amount"],
		)
		if payment_names
		else []
	)
	payments_by_order = {}
	payments_by_name = {row.name: row for row in payment_rows}
	for ref in refs:
		payment = payments_by_name.get(ref.parent)
		if not payment:
			continue
		payments_by_order.setdefault(ref.reference_name, []).append(
			{"mode_of_payment": payment.mode_of_payment, "amount": flt(ref.allocated_amount)}
		)
	result = []
	for row in rows:
		payments = payments_by_order.get(row.name, [])
		row_status = _sales_order_status(row)
		if status and row_status != status:
			continue
		if payment_mode and payment_mode not in {payment["mode_of_payment"] for payment in payments}:
			continue
		total = flt(row.rounded_total or row.grand_total)
		result.append(
			{
				"name": row.name,
				"doctype": "Sales Order",
				"posting_date": row.transaction_date,
				"posting_time": row.get("transaction_time") or row.get("creation"),
				"customer": row.customer,
				"customer_name": row.customer_name,
				"currency": row.currency,
				"grand_total": total,
				"rounded_total": total,
				"paid_amount": flt(row.advance_paid),
				"outstanding_amount": max(total - flt(row.advance_paid), 0),
				"total_qty": row.total_qty,
				"due_date": row.delivery_date,
				"docstatus": row.docstatus,
				"is_return": False,
				"return_against": None,
				"vunapos_credit_sale": False,
				"vunapos_opening_entry": row.get("vunapos_opening_entry"),
				"vunapos_session_cashier": row.get("vunapos_session_cashier"),
				"vunapos_closing_entry": row.get("vunapos_closing_entry"),
				"payments": payments,
				"status": row_status,
			}
		)
	active_rows = [row for row in result if row["docstatus"] == 1]
	paged_result = result[start : start + page_length]
	return {
		"invoices": paged_result,
		"has_more": len(result) > start + page_length,
		"opening_entry": (opening_entry.name if frappe.utils.cint(current_shift) and opening_entry else None),
		"summary": {
			"invoice_count": len(result),
			"returns_count": 0,
			"gross_sales": sum(flt(row["grand_total"]) for row in active_rows),
			"returns": 0,
			"net_sales": sum(flt(row["grand_total"]) for row in active_rows),
			"outstanding": sum(row["outstanding_amount"] for row in active_rows),
			"credit_sales": 0,
			"credit_outstanding": 0,
		},
	}


def get_invoice_history(
	pos_profile=None,
	invoice=None,
	customer=None,
	from_date=None,
	to_date=None,
	status=None,
	payment_mode=None,
	sale_type=None,
	document_type="Invoice",
	current_shift=1,
	start=0,
	page_length=50,
):
	profile = resolve_pos_profile(pos_profile)
	if document_type == "Order":
		return _get_sales_order_history(
			profile,
			invoice=invoice,
			customer=customer,
			from_date=from_date,
			to_date=to_date,
			status=status,
			payment_mode=payment_mode,
			current_shift=current_shift,
			start=start,
			page_length=page_length,
		)
	if document_type == "Draft Order":
		return _get_sales_order_history(
			profile,
			invoice=invoice,
			customer=customer,
			from_date=from_date,
			to_date=to_date,
			status=status,
			payment_mode=payment_mode,
			current_shift=current_shift,
			start=start,
			page_length=page_length,
			draft_only=True,
		)
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


def get_invoice_details(pos_profile=None, invoice_name=None, invoice_doctype=None):
	profile = resolve_pos_profile(pos_profile)
	doctype = invoice_doctype or get_invoice_mode()
	if doctype not in (get_invoice_mode(), "Sales Order"):
		frappe.throw(_("Unsupported invoice document type"))
	require_read(doctype, invoice_name)
	doc = frappe.get_doc(doctype, invoice_name)
	profile_field = "vunapos_pos_profile" if doctype == "Sales Order" else "pos_profile"
	if (
		not doc.get("vunapos_invoice")
		or doc.company != profile.company
		or doc.get(profile_field) != profile.name
	):
		frappe.throw(_("Invoice is not available for this POS Profile"), frappe.PermissionError)

	returns = []
	if doctype != "Sales Order":
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
	can_edit = doc.docstatus == 0
	if can_edit:
		try:
			assert_pos_workflow_editable(doc, profile)
		except frappe.PermissionError:
			can_edit = False
	result["can_edit"] = can_edit
	if doctype == "Sales Order":
		order_total = flt(doc.get("rounded_total") or doc.get("grand_total"))
		result["posting_date"] = doc.get("transaction_date")
		result["due_date"] = doc.get("delivery_date")
		result["totals"]["paid_amount"] = flt(doc.get("advance_paid"))
		result["totals"]["outstanding_amount"] = max(order_total - flt(doc.get("advance_paid")), 0)
	result.update(
		{
			"currency": doc.currency,
			"posting_time": doc.get("posting_time"),
			"due_date": doc.get("due_date"),
			"status": _sales_order_status(doc) if doctype == "Sales Order" else _status(doc),
			"is_return": bool(doc.get("is_return")),
			"return_against": doc.get("return_against"),
			"pos_profile": doc.get(profile_field),
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
