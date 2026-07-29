from decimal import Decimal, InvalidOperation

import frappe
from erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry import (
	get_payments,
	get_taxes,
	make_closing_entry_from_opening,
)
from frappe import _
from frappe.query_builder import DocType
from frappe.query_builder import functions as fn
from frappe.query_builder.custom import ConstantColumn
from frappe.utils import flt, now_datetime

from vunapos.services.profile_service import get_invoice_mode, get_pos_session, require_open_pos_session
from vunapos.utils.permissions import require_create, require_read


def _get_vunapos_invoices(opening_entry, period_end_date):
	doctype = get_invoice_mode()
	invoice = DocType(doctype)
	query = (
		frappe.qb.from_(invoice)
		.select(
			invoice.name,
			invoice.customer,
			invoice.posting_date,
			invoice.posting_time,
			invoice.grand_total,
			invoice.net_total,
			invoice.total_qty,
			invoice.total_taxes_and_charges,
			invoice.outstanding_amount,
			invoice.change_amount,
			invoice.account_for_change_amount,
			invoice.is_return,
			invoice.return_against,
			invoice.vunapos_credit_sale,
			ConstantColumn(doctype).as_("doctype"),
		)
		.where(
			(invoice.owner == opening_entry.user)
			& (invoice.docstatus == 1)
			& (invoice.pos_profile == opening_entry.pos_profile)
			& (invoice.vunapos_invoice == 1)
			& (invoice.vunapos_opening_entry == opening_entry.name)
			& fn.IfNull(invoice.vunapos_closing_entry, "").eq("")
			& (fn.Timestamp(invoice.posting_date, invoice.posting_time) >= opening_entry.period_start_date)
			& (fn.Timestamp(invoice.posting_date, invoice.posting_time) <= period_end_date)
		)
		.orderby(invoice.posting_date)
		.orderby(invoice.posting_time)
	)
	return query.run(as_dict=True)


def _get_vunapos_customer_payments(opening_entry, period_end_date):
	return frappe.get_list(
		"Payment Entry",
		filters={
			"docstatus": 1,
			"payment_type": "Receive",
			"vunapos_payment": 1,
			"vunapos_opening_entry": opening_entry.name,
			"vunapos_closing_entry": ["is", "not set"],
			"posting_date": ["<=", period_end_date.date()],
		},
		fields=[
			"name",
			"mode_of_payment",
			"received_amount",
			"vunapos_receipt_type",
			"vunapos_reconciled_opening_entry",
			"vunapos_reconciled_amount",
		],
		limit_page_length=100000,
	)


def _get_reconciled_customer_credits(opening_entry):
	return frappe.get_list(
		"Payment Entry",
		filters={
			"docstatus": 1,
			"vunapos_payment": 1,
			"vunapos_reconciled_opening_entry": opening_entry.name,
			"vunapos_reconciled_amount": [">", 0],
		},
		fields=["name", "vunapos_reconciled_amount"],
		limit_page_length=100000,
	)


def _populate_vunapos_invoices(closing_entry, opening_entry):
	invoices = _get_vunapos_invoices(opening_entry, closing_entry.period_end_date)
	closing_entry.set("sales_invoices", [])
	closing_entry.set("pos_invoices", [])
	closing_entry.set("payment_reconciliation", [])
	closing_entry.set("taxes", [])
	closing_entry.grand_total = 0
	closing_entry.net_total = 0
	closing_entry.total_quantity = 0
	closing_entry.total_taxes_and_charges = 0

	# Keep the invoices on ERPNext's native closing-entry child tables. The
	# VunaPOS controller extension accepts our own origin marker for Sales Invoice
	# rows without changing is_created_using_pos.
	invoice_mode = get_invoice_mode()
	if invoice_mode == "POS Invoice":
		for row in invoices:
			closing_entry.append(
				"pos_invoices",
				{
					"pos_invoice": row.name,
					"posting_date": row.posting_date,
					"grand_total": row.grand_total,
					"customer": row.customer,
					"is_return": row.is_return,
					"return_against": row.return_against,
				},
			)
	else:
		for row in invoices:
			closing_entry.append(
				"sales_invoices",
				{
					"sales_invoice": row.name,
					"posting_date": row.posting_date,
					"grand_total": row.grand_total,
					"customer": row.customer,
					"is_return": row.is_return,
					"return_against": row.return_against,
				},
			)

	for row in invoices:
		closing_entry.grand_total += flt(row.grand_total)
		closing_entry.net_total += flt(row.net_total)
		closing_entry.total_quantity += flt(row.total_qty)
		closing_entry.total_taxes_and_charges += flt(row.total_taxes_and_charges)

	for payment in get_payments(invoices):
		closing_entry.append(
			"payment_reconciliation",
			{
				"mode_of_payment": payment.mode_of_payment,
				"opening_amount": 0,
				"expected_amount": payment.amount,
			},
		)
	customer_payments = _get_vunapos_customer_payments(opening_entry, closing_entry.period_end_date)
	reconciliation = {row.mode_of_payment: row for row in closing_entry.get("payment_reconciliation", [])}
	for payment in customer_payments:
		row = reconciliation.get(payment.mode_of_payment)
		if not row:
			row = closing_entry.append(
				"payment_reconciliation",
				{"mode_of_payment": payment.mode_of_payment, "opening_amount": 0, "expected_amount": 0},
			)
			reconciliation[payment.mode_of_payment] = row
		row.expected_amount = flt(row.expected_amount) + flt(payment.received_amount)
	for tax in get_taxes(invoices):
		closing_entry.append("taxes", {"account_head": tax.account_head, "amount": tax.tax_amount})

	closing_entry.flags.vunapos_invoices = invoices
	closing_entry.flags.vunapos_customer_payments = customer_payments
	closing_entry.flags.vunapos_reconciled_customer_credits = _get_reconciled_customer_credits(opening_entry)


def _prepare_closing_entry(pos_profile):
	opening_entry = require_open_pos_session(pos_profile)
	require_read("POS Opening Entry", opening_entry.name)
	closing_entry = make_closing_entry_from_opening(opening_entry)
	_populate_vunapos_invoices(closing_entry, opening_entry)

	payments = {row.mode_of_payment: row for row in closing_entry.get("payment_reconciliation", [])}
	for opening_row in opening_entry.get("balance_details", []):
		row = payments.get(opening_row.mode_of_payment)
		if not row:
			row = closing_entry.append(
				"payment_reconciliation",
				{
					"mode_of_payment": opening_row.mode_of_payment,
					"opening_amount": 0,
					"expected_amount": 0,
				},
			)
			payments[opening_row.mode_of_payment] = row
		row.opening_amount = flt(opening_row.opening_amount)
		row.expected_amount = flt(row.expected_amount) + flt(opening_row.opening_amount)

	for row in closing_entry.get("payment_reconciliation", []):
		row.closing_amount = flt(row.expected_amount)
		row.difference = 0

	return closing_entry


def _closing_summary(closing_entry):
	vunapos_invoices = closing_entry.flags.get("vunapos_invoices") or []
	customer_payments = closing_entry.flags.get("vunapos_customer_payments") or []
	sale_collections = sum(flt(row.amount) for row in get_payments(vunapos_invoices))
	invoice_receipts = sum(
		flt(row.received_amount)
		for row in customer_payments
		if row.vunapos_receipt_type == "Outstanding Invoice Payment"
	)
	advances = sum(
		flt(row.received_amount)
		for row in customer_payments
		if row.vunapos_receipt_type != "Outstanding Invoice Payment"
	)
	reconciled_credits = sum(
		flt(row.vunapos_reconciled_amount)
		for row in (closing_entry.flags.get("vunapos_reconciled_customer_credits") or [])
	)
	return {
		"opening_entry": closing_entry.pos_opening_entry,
		"pos_profile": closing_entry.pos_profile,
		"cashier": closing_entry.user,
		"period_start_date": closing_entry.period_start_date,
		"period_end_date": closing_entry.period_end_date,
		"invoice_count": len(vunapos_invoices),
		"invoices": [
			{
				"name": row.name,
				"doctype": row.doctype,
				"posting_date": row.posting_date,
				"posting_time": row.posting_time,
				"customer": row.customer,
				"grand_total": flt(row.grand_total),
				"is_return": bool(row.is_return),
			}
			for row in vunapos_invoices
		],
		"net_total": flt(closing_entry.net_total),
		"total_taxes_and_charges": flt(closing_entry.total_taxes_and_charges),
		"grand_total": flt(closing_entry.grand_total),
		"total_quantity": flt(closing_entry.total_quantity),
		"payment_activity": {
			"sales_collected": sale_collections,
			"outstanding_invoice_payments": invoice_receipts,
			"customer_advances": advances,
			"reconciled_existing_credits": reconciled_credits,
			"cash_received": sale_collections + invoice_receipts + advances,
			"credit_sales": sum(
				flt(row.grand_total)
				for row in vunapos_invoices
				if row.get("vunapos_credit_sale") and not row.is_return
			),
			"credit_outstanding": sum(
				max(flt(row.outstanding_amount), 0)
				for row in vunapos_invoices
				if row.get("vunapos_credit_sale") and not row.is_return
			),
		},
		"payments": [
			{
				"mode_of_payment": row.mode_of_payment,
				"opening_amount": flt(row.opening_amount),
				"expected_amount": flt(row.expected_amount),
				"closing_amount": flt(row.closing_amount),
				"difference": flt(row.difference),
			}
			for row in closing_entry.get("payment_reconciliation", [])
		],
	}


def get_closing_preview(pos_profile):
	return _closing_summary(_prepare_closing_entry(pos_profile))


def _validate_closing_balances(closing_entry, closing_balances):
	if not isinstance(closing_balances, list):
		frappe.throw(_("Closing balances must be a list"))

	expected_modes = {row.mode_of_payment for row in closing_entry.get("payment_reconciliation", [])}
	provided = {}
	for row in closing_balances:
		if not isinstance(row, dict):
			frappe.throw(_("Each closing balance must be an object"))
		mode = row.get("mode_of_payment")
		if not mode or mode not in expected_modes:
			frappe.throw(_("Payment mode {0} is not part of this POS session").format(mode or "(blank)"))
		if mode in provided:
			frappe.throw(_("Duplicate closing balance for payment mode {0}").format(mode))
		try:
			amount = Decimal(str(row.get("closing_amount")))
		except (InvalidOperation, TypeError, ValueError):
			frappe.throw(_("Invalid closing amount for payment mode {0}").format(mode))
		if not amount.is_finite() or amount < 0:
			frappe.throw(_("Closing amount must be zero or greater for payment mode {0}").format(mode))
		provided[mode] = flt(amount)

	missing = expected_modes - provided.keys()
	if missing:
		frappe.throw(_("Closing balances are missing for: {0}").format(", ".join(sorted(missing))))
	return provided


def close_pos_session(pos_profile, closing_balances):
	require_create("POS Closing Entry")
	if not frappe.has_permission("POS Closing Entry", "submit"):
		frappe.throw(_("Not permitted to submit POS Closing Entry"), frappe.PermissionError)

	closing_entry = _prepare_closing_entry(pos_profile)
	provided = _validate_closing_balances(closing_entry, closing_balances)
	for row in closing_entry.get("payment_reconciliation", []):
		row.closing_amount = provided[row.mode_of_payment]
		row.difference = flt(row.closing_amount) - flt(row.expected_amount)

	closing_entry.period_end_date = now_datetime()
	closing_entry.insert()
	closing_entry.submit()
	invoices = closing_entry.flags.get("vunapos_invoices") or []
	for invoice in invoices:
		frappe.db.set_value(
			get_invoice_mode(),
			invoice.name,
			"vunapos_closing_entry",
			closing_entry.name,
			update_modified=False,
		)
	for payment in closing_entry.flags.get("vunapos_customer_payments") or []:
		frappe.db.set_value(
			"Payment Entry", payment.name, "vunapos_closing_entry", closing_entry.name, update_modified=False
		)

	result = _closing_summary(closing_entry)
	result.update(
		{
			"name": closing_entry.name,
			"status": closing_entry.status,
			"session": get_pos_session(frappe.session.user, pos_profile, now_datetime()),
		}
	)
	return result
