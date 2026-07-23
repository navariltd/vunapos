from decimal import Decimal, InvalidOperation

import frappe
from erpnext.accounts.party import get_party_account
from frappe import _
from frappe.utils import flt, nowdate

from vunapos.services.profile_service import get_invoice_mode, require_open_pos_session, resolve_pos_profile
from vunapos.utils.permissions import require_create, require_read


def _amount(value, label):
	try:
		amount = Decimal(str(value))
	except (InvalidOperation, TypeError, ValueError):
		frappe.throw(_("{0} must be a valid amount").format(label))
	if not amount.is_finite() or amount <= 0:
		frappe.throw(_("{0} must be greater than zero").format(label))
	return flt(amount)


def _mode_account(profile, mode_of_payment):
	if mode_of_payment not in {row.mode_of_payment for row in profile.get("payments", [])}:
		frappe.throw(_("Mode of Payment {0} is not configured for this POS Profile").format(mode_of_payment))
	account = frappe.db.get_value(
		"Mode of Payment Account",
		{"parent": mode_of_payment, "company": profile.company},
		"default_account",
	)
	if not account:
		frappe.throw(
			_("Mode of Payment {0} has no default account for {1}").format(mode_of_payment, profile.company)
		)
	require_read("Account", account)
	return account


def receive_customer_payment(
	pos_profile=None,
	customer=None,
	amount=None,
	mode_of_payment=None,
	sales_invoice=None,
	allocated_amount=None,
	posting_date=None,
	reference_no=None,
	reference_date=None,
	remarks=None,
	idempotency_key=None,
):
	if not idempotency_key:
		frappe.throw(_("An idempotency key is required"))
	existing = frappe.db.get_value(
		"Payment Entry", {"vunapos_idempotency_key": idempotency_key, "docstatus": 1}, "name"
	)
	if existing:
		require_read("Payment Entry", existing)
		return payment_entry_to_dict(frappe.get_doc("Payment Entry", existing), duplicate=True)

	profile = resolve_pos_profile(pos_profile)
	opening_entry = require_open_pos_session(profile.name)
	require_create("Payment Entry")
	if not frappe.has_permission("Payment Entry", "submit"):
		frappe.throw(_("Not permitted to submit Payment Entry"), frappe.PermissionError)
	require_read("Customer", customer)
	if frappe.db.get_value("Customer", customer, "disabled"):
		frappe.throw(_("Customer {0} is disabled").format(customer))

	amount = _amount(amount, _("Payment amount"))
	allocation = 0
	invoice = None
	if sales_invoice:
		invoice_doctype = get_invoice_mode()
		require_read(invoice_doctype, sales_invoice)
		invoice = frappe.get_doc(invoice_doctype, sales_invoice)
		if invoice.docstatus != 1 or invoice.is_return:
			frappe.throw(_("Only submitted sales invoices can receive payments"))
		if invoice.customer != customer or invoice.company != profile.company:
			frappe.throw(_("Invoice does not belong to this customer and company"))
		if flt(invoice.outstanding_amount) <= 0:
			frappe.throw(_("Invoice {0} has no outstanding balance").format(invoice.name))
		allocation = _amount(
			allocated_amount if allocated_amount is not None else amount, _("Allocated amount")
		)
		if allocation > amount:
			frappe.throw(_("Allocated amount cannot exceed the payment amount"))
		if allocation > flt(invoice.outstanding_amount):
			frappe.throw(_("Allocated amount cannot exceed the invoice outstanding balance"))

	paid_to = _mode_account(profile, mode_of_payment)
	paid_from = get_party_account("Customer", customer, profile.company)
	if not paid_from:
		frappe.throw(_("No receivable account is configured for this customer"))
	require_read("Account", paid_from)
	company_currency = frappe.get_cached_value("Company", profile.company, "default_currency")
	party_currency = frappe.get_cached_value("Account", paid_from, "account_currency") or company_currency
	paid_to_currency = frappe.get_cached_value("Account", paid_to, "account_currency") or company_currency

	doc = frappe.new_doc("Payment Entry")
	doc.update(
		{
			"payment_type": "Receive",
			"company": profile.company,
			"posting_date": posting_date or nowdate(),
			"party_type": "Customer",
			"party": customer,
			"mode_of_payment": mode_of_payment,
			"paid_from": paid_from,
			"paid_to": paid_to,
			"paid_from_account_currency": party_currency,
			"paid_to_account_currency": paid_to_currency,
			"paid_amount": amount,
			"received_amount": amount,
			"source_exchange_rate": 1,
			"target_exchange_rate": 1,
			"reference_no": reference_no,
			"reference_date": reference_date if reference_no else None,
			"remarks": remarks or _("Customer payment received through VunaPOS"),
			"vunapos_payment": 1,
			"vunapos_idempotency_key": idempotency_key,
			"vunapos_opening_entry": opening_entry.name,
			"vunapos_session_cashier": frappe.session.user,
			"vunapos_receipt_type": "Outstanding Invoice Payment" if invoice else "Customer Advance",
		}
	)
	if invoice:
		doc.append(
			"references",
			{
				"reference_doctype": invoice.doctype,
				"reference_name": invoice.name,
				"due_date": invoice.due_date,
				"total_amount": invoice.grand_total,
				"outstanding_amount": invoice.outstanding_amount,
				"allocated_amount": allocation,
			},
		)
	# Payment Entry keeps these as transient controller attributes rather than
	# DocType fields. ERPNext's own get_payment_entry() initializes them before
	# set_missing_values()/validation, and manual construction must do the same.
	doc.setup_party_account_field()
	doc.set_missing_values()
	doc.set_amounts()
	doc.insert()
	doc.submit()
	return payment_entry_to_dict(doc)


def payment_entry_to_dict(doc, duplicate=False):
	return {
		"name": doc.name,
		"posting_date": doc.posting_date,
		"customer": doc.party,
		"mode_of_payment": doc.mode_of_payment,
		"paid_amount": flt(doc.paid_amount),
		"received_amount": flt(doc.received_amount),
		"unallocated_amount": flt(doc.unallocated_amount),
		"opening_entry": doc.get("vunapos_opening_entry"),
		"duplicate": duplicate,
		"references": [
			{
				"doctype": row.reference_doctype,
				"name": row.reference_name,
				"allocated_amount": flt(row.allocated_amount),
			}
			for row in doc.get("references", [])
		],
	}


def get_payment_history(
	pos_profile=None,
	customer=None,
	from_date=None,
	to_date=None,
	mode_of_payment=None,
	reference=None,
	status=None,
	cashier=None,
	limit=100,
):
	profile = resolve_pos_profile(pos_profile)
	filters = {"company": profile.company, "vunapos_payment": 1}
	if customer:
		filters["party"] = customer
	if from_date and to_date:
		filters["posting_date"] = ["between", [from_date, to_date]]
	elif from_date:
		filters["posting_date"] = [">=", from_date]
	elif to_date:
		filters["posting_date"] = ["<=", to_date]
	if mode_of_payment:
		filters["mode_of_payment"] = mode_of_payment
	if cashier:
		filters["vunapos_session_cashier"] = cashier
	filters["docstatus"] = 1 if status == "Submitted" else 2 if status == "Cancelled" else ["in", [1, 2]]
	if reference:
		filters["reference_no"] = ["like", f"%{reference}%"]
	rows = frappe.get_list(
		"Payment Entry",
		filters=filters,
		fields=[
			"name",
			"posting_date",
			"party as customer",
			"party_name as customer_name",
			"mode_of_payment",
			"received_amount",
			"unallocated_amount",
			"reference_no",
			"remarks",
			"docstatus",
			"vunapos_session_cashier as cashier",
			"vunapos_opening_entry as opening_entry",
			"vunapos_closing_entry as closing_entry",
			"vunapos_receipt_type as receipt_type",
		],
		order_by="posting_date desc, creation desc",
		limit_page_length=min(max(int(limit or 100), 1), 500),
	)
	if not rows:
		return {"payments": []}
	references = frappe.get_all(
		"Payment Entry Reference",
		filters={"parent": ["in", [row.name for row in rows]], "allocated_amount": [">", 0]},
		fields=["parent", "reference_doctype", "reference_name", "allocated_amount"],
		order_by="idx",
	)
	by_payment = {}
	for row in references:
		by_payment.setdefault(row.parent, []).append(row)
	return {
		"payments": [
			{
				**row,
				"status": "Cancelled" if row.docstatus == 2 else "Submitted",
				"allocated_amount": flt(row.received_amount) - flt(row.unallocated_amount),
				"references": by_payment.get(row.name, []),
			}
			for row in rows
		]
	}


def render_payment_receipt(payment_entry):
	require_read("Payment Entry", payment_entry)
	if not frappe.db.get_value("Payment Entry", payment_entry, "vunapos_payment"):
		frappe.throw(_("Payment Entry {0} is not a VunaPOS customer receipt").format(payment_entry))
	return {"name": payment_entry, "html": frappe.get_print("Payment Entry", payment_entry)}


def _reconciliation_doc(profile, customer, limit=100):
	require_read("Customer", customer)
	account = get_party_account("Customer", customer, profile.company)
	if not account:
		frappe.throw(_("No receivable account is configured for this customer"))
	require_read("Account", account)
	doc = frappe.new_doc("Payment Reconciliation")
	doc.update(
		{
			"company": profile.company,
			"party_type": "Customer",
			"party": customer,
			"receivable_payable_account": account,
			"payment_limit": limit,
			"invoice_limit": limit,
		}
	)
	return doc


def _native_candidates(profile, customer, limit=100):
	doc = _reconciliation_doc(profile, customer, min(max(int(limit or 100), 1), 500))
	doc.get_nonreconciled_payment_entries()
	doc.get_invoice_entries()
	invoice_doctype = get_invoice_mode()
	payments = [
		row
		for row in doc.get("payments")
		if row.reference_type == "Payment Entry"
		and frappe.has_permission("Payment Entry", "read", doc=row.reference_name)
	]
	invoices = [
		row
		for row in doc.get("invoices")
		if row.invoice_type == invoice_doctype
		and frappe.has_permission(invoice_doctype, "read", doc=row.invoice_number)
	]
	return doc, payments, invoices


def get_reconciliation_candidates(pos_profile=None, customer=None, limit=100):
	profile = resolve_pos_profile(pos_profile)
	if not customer:
		return {"payments": [], "invoices": []}
	_, payments, invoices = _native_candidates(profile, customer, limit)
	return {
		"payments": [
			{
				"name": row.reference_name,
				"posting_date": row.posting_date,
				"amount": flt(row.amount),
				"currency": row.currency,
				"remarks": row.remarks,
			}
			for row in payments
		],
		"invoices": [
			{
				"name": row.invoice_number,
				"posting_date": row.invoice_date,
				"amount": flt(row.amount),
				"outstanding_amount": flt(row.outstanding_amount),
				"currency": row.currency,
			}
			for row in invoices
		],
	}


def allocate_customer_payments(pos_profile=None, customer=None, payment_entries=None, invoices=None):
	profile = resolve_pos_profile(pos_profile)
	if not payment_entries or not invoices:
		frappe.throw(_("Select at least one payment and one invoice"))
	doc, payments, invoice_rows = _native_candidates(profile, customer)
	selected_payments = [row for row in payments if row.reference_name in set(payment_entries)]
	selected_invoices = [row for row in invoice_rows if row.invoice_number in set(invoices)]
	if len(selected_payments) != len(set(payment_entries)) or len(selected_invoices) != len(set(invoices)):
		frappe.throw(_("One or more selected entries are no longer available for reconciliation"))
	doc.set("payments", selected_payments)
	doc.set("invoices", selected_invoices)
	doc.allocate_entries(
		frappe._dict(
			{
				"payments": [row.as_dict() for row in selected_payments],
				"invoices": [row.as_dict() for row in selected_invoices],
			}
		)
	)
	return {
		"allocations": [
			{
				"payment_entry": row.reference_name,
				"invoice": row.invoice_number,
				"allocated_amount": flt(row.allocated_amount),
				"currency": row.currency,
			}
			for row in doc.get("allocation")
		]
	}


def reconcile_customer_payment(pos_profile=None, customer=None, payment_entries=None, invoices=None):
	profile = resolve_pos_profile(pos_profile)
	opening_entry = require_open_pos_session(profile.name)
	for name in payment_entries or []:
		require_read("Payment Entry", name)
		if not frappe.has_permission("Payment Entry", "write", doc=name):
			frappe.throw(
				_("Not permitted to reconcile Payment Entry {0}").format(name), frappe.PermissionError
			)
		frappe.get_doc("Payment Entry", name, for_update=True)
	for name in invoices or []:
		require_read(get_invoice_mode(), name)
		frappe.get_doc(get_invoice_mode(), name, for_update=True)
	preview = allocate_customer_payments(profile.name, customer, payment_entries, invoices)
	doc, payments, invoice_rows = _native_candidates(profile, customer)
	doc.set("payments", [row for row in payments if row.reference_name in set(payment_entries)])
	doc.set("invoices", [row for row in invoice_rows if row.invoice_number in set(invoices)])
	doc.allocate_entries(
		frappe._dict(
			{
				"payments": [row.as_dict() for row in doc.payments],
				"invoices": [row.as_dict() for row in doc.invoices],
			}
		)
	)
	doc.reconcile()
	audit = ", ".join(
		f"{row['payment_entry']} -> {row['invoice']}: {row['allocated_amount']}"
		for row in preview["allocations"]
	)
	for name in payment_entries:
		amount = sum(
			row["allocated_amount"] for row in preview["allocations"] if row["payment_entry"] == name
		)
		previous_opening, previous_amount = frappe.db.get_value(
			"Payment Entry",
			name,
			["vunapos_reconciled_opening_entry", "vunapos_reconciled_amount"],
		)
		frappe.db.set_value(
			"Payment Entry",
			name,
			{
				"vunapos_reconciled_opening_entry": opening_entry.name,
				"vunapos_reconciled_amount": flt(previous_amount) + amount
				if previous_opening == opening_entry.name
				else amount,
			},
			update_modified=False,
		)
		frappe.get_doc("Payment Entry", name).add_comment(
			"Info", _("Reconciled in VunaPOS by {0}: {1}").format(frappe.session.user, audit)
		)
	return {
		"allocations": preview["allocations"],
		"allocated_amount": sum(row["allocated_amount"] for row in preview["allocations"]),
	}
