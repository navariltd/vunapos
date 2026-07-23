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
