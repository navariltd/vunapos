"""Retrospective waste of billed food: reclassify cost, never issue stock twice.

This is not a refund, production reversal or replacement command. It requires
verified invoice stock and accounting entries; deferred POS postings cannot be
guessed from a BOM estimate. The session lock serializes waste with billing and
other kitchen commands. Native accounting validation remains authoritative.
"""

from math import isfinite

import frappe
from frappe import _
from frappe.utils import flt, nowdate

from vunapos.services import kitchen_lifecycle_service as kitchen
from vunapos.services import kitchen_progress_service as progress
from vunapos.services import restaurant_request_service as requests
from vunapos.services.kitchen_service import fail

ACTION = "Record Waste"
EPSILON = 0.000001


def _has_returns(invoice):
	return bool(
		frappe.qb.get_query(
			invoice.doctype,
			filters={"return_against": invoice.name, "docstatus": ["!=", 2]},
			fields=["name"],
			for_update=True,
		).run()
	)


def _context(ticket):
	if not set(frappe.get_roles()) & kitchen.MANAGERS:
		frappe.throw(_("A restaurant manager must approve and record waste."), frappe.PermissionError)
	doc = kitchen._ticket(ticket, lock=True)
	if doc.docstatus != 1 or doc.status == "Cancelled":
		fail("WASTE_TICKET_NOT_ACTIVE", _("Use a submitted, non-cancelled preparation ticket."))
	session = frappe.get_doc("Restaurant Session", doc.restaurant_session, for_update=True)
	if session.billing_doctype not in ("Sales Invoice", "POS Invoice") or not session.billing_invoice:
		fail(
			"WASTE_BILL_FIRST",
			_("Bill this visit first. Recording chargeable waste must not issue its stock twice."),
		)
	invoice = frappe.get_doc(session.billing_doctype, session.billing_invoice, for_update=True)
	invoice.check_permission("read")
	if (
		invoice.docstatus != 1
		or invoice.is_return
		or invoice.company != doc.company
		or invoice.get("vunapos_restaurant_session") != session.name
		or (session.restaurant, session.branch) != (doc.restaurant, doc.branch)
	):
		fail("WASTE_BILL_NOT_POSTED", _("Waste requires this visit's submitted, original bill."))
	if _has_returns(invoice):
		fail(
			"WASTE_RETURN_REVIEW_REQUIRED",
			_("This bill has a return. Ask accounts to reconcile its waste and returned stock first."),
		)
	profile = frappe.get_doc("POS Profile", doc.pos_profile)
	account = profile.get("vunapos_waste_expense_account")
	account_doc = frappe.get_doc("Account", account) if account else None
	currency = frappe.get_cached_value("Company", doc.company, "default_currency")
	if not account_doc or (
		account_doc.company != doc.company
		or account_doc.is_group
		or account_doc.disabled
		or account_doc.root_type != "Expense"
		or account_doc.account_currency != currency
	):
		fail(
			"WASTE_ACCOUNT_REQUIRED",
			_(
				"Set an enabled company-currency expense ledger as Waste Expense Account on POS Profile {0}."
			).format(profile.name),
		)
	return doc, invoice, account


def _history(doc):
	used = {}
	bases = {}
	for event in frappe.qb.get_query(
		kitchen.ACTION,
		filters={"kitchen_ticket": doc.name, "action": ACTION, "outcome": "Succeeded"},
		fields=["item_quantities"],
		order_by="name",
		for_update=True,
	).run(as_dict=True):
		payload = requests.parsed(event.item_quantities) or {}
		journal = payload.get("journal_entry")
		if journal and frappe.db.get_value("Journal Entry", journal, "docstatus", for_update=True) != 1:
			fail(
				"WASTE_ACCOUNTING_CHANGED",
				_(
					"A previous waste journal was cancelled or changed. Ask accounts to reconcile it before recording more waste."
				),
			)
		for line, qty in payload.get("deltas", {}).items():
			used[line] = used.get(line, 0) + flt(qty)
			if line in payload.get("basis", {}):
				bases[line] = payload["basis"][line]
	return used, bases


def _cost(invoice, source, account):
	# Require the invoice's actual stock issue, not recipe/standard-rate estimates.
	ledger = frappe.get_all(
		"Stock Ledger Entry",
		filters={
			"voucher_type": invoice.doctype,
			"voucher_no": invoice.name,
			"voucher_detail_no": source.name,
			"is_cancelled": 0,
		},
		fields=["actual_qty", "stock_value_difference"],
		order_by="name",
	)
	issued = -sum(flt(row.actual_qty) for row in ledger)
	cost = -sum(flt(row.stock_value_difference) for row in ledger)
	if abs(issued - flt(source.stock_qty)) > EPSILON or issued <= 0 or cost < 0:
		fail(
			"WASTE_STOCK_NOT_POSTED",
			_(
				"Stock issue for {0} is not fully posted on this bill. Complete or reconcile its ERPNext stock posting first."
			).format(source.item_name),
		)
	if cost <= EPSILON:
		fail(
			"WASTE_COST_NOT_POSTED",
			_(
				"No positive posted stock cost was found for {0}. Ask accounts to check valuation before recording waste."
			).format(source.item_name),
		)
	if not source.expense_account or not source.cost_center:
		fail(
			"WASTE_COST_NOT_POSTED", _("The billed item needs its original expense account and cost center.")
		)
	if source.expense_account == account:
		fail(
			"WASTE_ACCOUNT_ALREADY_USED",
			_("Choose a separate waste expense account, not the item's original cost-of-sales account."),
		)
	posted = frappe.get_all(
		"GL Entry",
		filters={
			"voucher_type": invoice.doctype,
			"voucher_no": invoice.name,
			"account": source.expense_account,
			"cost_center": source.cost_center,
			"is_cancelled": 0,
		},
		fields=["debit", "credit"],
		order_by="name",
	)
	# Native stock GL entries may be merged and have no item-level reference.
	# Reconcile the entire expense-account/cost-center bucket instead of
	# pretending a missing voucher_detail_no means its cost was never posted.
	peers = [
		row.name
		for row in invoice.items
		if row.expense_account == source.expense_account and row.cost_center == source.cost_center
	]
	bucket = frappe.get_all(
		"Stock Ledger Entry",
		filters={
			"voucher_type": invoice.doctype,
			"voucher_no": invoice.name,
			"voucher_detail_no": ["in", peers],
			"is_cancelled": 0,
		},
		fields=["stock_value_difference"],
	)
	posted_cost = -sum(flt(row.stock_value_difference) for row in bucket)
	if abs(sum(flt(row.debit) - flt(row.credit) for row in posted) - posted_cost) > 0.011:
		fail(
			"WASTE_COST_NOT_POSTED",
			_(
				"The stock cost for {0} has no matching posted cost-of-sales entry. Ask accounts to reconcile this bill first."
			).format(source.item_name),
		)
	account_doc = frappe.get_cached_doc("Account", source.expense_account)
	if account_doc.account_currency != frappe.get_cached_value(
		"Company", invoice.company, "default_currency"
	):
		fail(
			"WASTE_CURRENCY_REVIEW_REQUIRED",
			_(
				"Foreign-currency cost accounts require an accounting review before waste can be reclassified."
			),
		)
	return cost / flt(source.qty)


def _quote(doc, invoice, account):
	from erpnext.accounts.doctype.accounting_dimension.accounting_dimension import get_accounting_dimensions

	states = progress.load([doc], for_update=True)[doc.name]
	used, bases = _history(doc)
	by_source = {row.so_detail: row for row in invoice.items if row.sales_order == doc.sales_order}
	posting = invoice
	if invoice.doctype == "POS Invoice" and invoice.get("consolidated_invoice"):
		posting = frappe.get_doc("Sales Invoice", invoice.consolidated_invoice, for_update=True)
		posting.check_permission("read")
		if posting.docstatus != 1 or posting.is_return or posting.company != invoice.company:
			fail(
				"WASTE_BILL_NOT_POSTED",
				_("The consolidated bill must be submitted and belong to this company."),
			)
		if _has_returns(posting):
			fail(
				"WASTE_RETURN_REVIEW_REQUIRED",
				_("The consolidated bill has a return. Ask accounts to reconcile it first."),
			)
	posted_by_pos_item = {
		row.pos_invoice_item: row for row in posting.items if row.get("pos_invoice") == invoice.name
	}
	dimensions = get_accounting_dimensions()
	lines = []
	for row in doc.items:
		if row.parent_line_id:
			continue
		source = by_source.get(row.sales_order_item)
		maximum = max(
			0,
			min(
				flt(source.qty) if source else 0,
				states[row.line_id]["served_qty"] - states[row.line_id].get("rejected_served_qty", 0),
			)
			- used.get(row.line_id, 0),
		)
		components = []
		if maximum > EPSILON:
			for part in doc.items:
				if part.line_id != row.line_id and part.parent_line_id != row.line_id:
					continue
				billed = by_source.get(part.sales_order_item)
				if not billed:
					fail(
						"WASTE_BILL_CHANGED",
						_("A preparation item is missing from the original bill. Review its source links."),
					)
				if not frappe.get_cached_value("Item", part.item_code, "is_stock_item"):
					continue
				posted = posted_by_pos_item.get(billed.name) if posting != invoice else billed
				if (
					not posted
					or posted.item_code != billed.item_code
					or abs(flt(posted.qty) - flt(billed.qty)) > EPSILON
				):
					fail(
						"WASTE_BILL_CHANGED",
						_("The consolidated item no longer matches its original POS bill."),
					)
				components.append(
					{
						"invoice_item": billed.name,
						"item_name": billed.item_name,
						"unit_cost": _cost(posting, posted, account) * flt(part.qty) / flt(row.qty),
						"expense_account": posted.expense_account,
						"cost_center": posted.cost_center,
						"project": posted.get("project") or posting.get("project"),
						"dimensions": {
							field: posted.get(field) or posting.get(field) for field in dimensions
						},
						"precision": posted.precision("base_net_amount") or 2,
					}
				)
		if components and row.line_id in bases and components != bases[row.line_id]:
			fail(
				"WASTE_COST_CHANGED",
				_(
					"This bill's posted cost or accounting context changed after waste was recorded. Ask accounts to reconcile its waste journals first."
				),
			)
		lines.append(
			{
				"line_id": row.line_id,
				"item_name": row.item_name,
				"uom": row.uom,
				"qty": flt(row.qty),
				"max_qty": maximum,
				"recorded_qty": used.get(row.line_id, 0),
				"unit_cost": sum(component["unit_cost"] for component in components),
				"components": components,
			}
		)
	quote = {
		"ticket": doc.name,
		"invoice_doctype": invoice.doctype,
		"invoice": invoice.name,
		"waste_account": account,
		"currency": frappe.get_cached_value("Company", doc.company, "default_currency"),
		"lines": lines,
		"invoice_modified": str(invoice.modified),
		"posting_invoice": posting.name,
		"posting_modified": str(posting.modified),
	}
	quote["fingerprint"] = requests.fingerprint(quote)
	return quote


def preview(ticket):
	return _quote(*_context(ticket))


def validate_service_correction(doc, quantities, states):
	used, _bases = _history(doc)
	if any(
		states[line]["served_qty"] - qty + EPSILON < used.get(line, 0) for line, qty in quantities.items()
	):
		fail(
			"WASTE_SERVICE_CORRECTION_REQUIRED",
			_(
				"Food already recorded as served waste cannot be moved back to ready-to-serve. Ask a manager to reconcile the waste record first."
			),
		)


def record(ticket, quantities, request_key, fingerprint, reason):
	doc, invoice, account = _context(ticket)
	key = kitchen._request_key(request_key)
	if not isinstance(reason, str) or not reason.strip() or len(reason) > 500:
		fail("WASTE_REASON_REQUIRED", _("Enter a waste reason of up to 500 characters."))
	selected = requests.parsed(quantities)
	payload = {"ticket": ticket, "quantities": selected, "fingerprint": fingerprint, "reason": reason.strip()}
	command_fingerprint = requests.fingerprint(payload)
	if kitchen._replay(
		doc, ACTION, key, reason=reason.strip(), request_fingerprint=command_fingerprint, quantified=True
	):
		return kitchen.ticket_detail(doc.name)
	quote = _quote(doc, invoice, account)
	if fingerprint != quote["fingerprint"]:
		fail(
			"WASTE_REVIEW_CHANGED",
			_("The bill or recorded waste changed. Review the latest quantities before confirming."),
		)
	if not isinstance(selected, dict) or not selected:
		fail("WASTE_QUANTITY_REQUIRED", _("Choose at least one served quantity to record as waste."))
	by_line = {row["line_id"]: row for row in quote["lines"]}
	accounts = []
	for line, quantity in selected.items():
		row = by_line.get(line)
		if (
			isinstance(quantity, bool)
			or not isinstance(quantity, (int, float))
			or not isfinite(quantity)
			or not row
			or quantity <= 0
			or quantity > row["max_qty"] + EPSILON
			or abs(quantity - round(quantity, 6)) > EPSILON
		):
			fail(
				"WASTE_QUANTITY_INVALID",
				_(
					"Use positive quantities no greater than the served, billed quantity not already recorded as waste."
				),
			)
		from vunapos.services.restaurant_stock_service import validate_quantity_unit

		validate_quantity_unit(quantity, row["uom"], row["item_name"])
		for component in row["components"]:
			# Cumulative rounding allocates the last cent once across partial
			# records instead of losing or duplicating it on every small request.
			amount = flt(
				(quantity + row["recorded_qty"]) * component["unit_cost"], component["precision"]
			) - flt(row["recorded_qty"] * component["unit_cost"], component["precision"])
			if amount <= 0:
				fail(
					"WASTE_COST_TOO_SMALL",
					_("The selected quantity rounds to zero cost. Ask accounts to review it."),
				)
			common = {
				"cost_center": component["cost_center"],
				"project": component["project"],
				**component["dimensions"],
			}
			accounts.extend(
				[
					{**common, "account": account, "debit_in_account_currency": amount},
					{**common, "account": component["expense_account"], "credit_in_account_currency": amount},
				]
			)
	if not accounts:
		fail("WASTE_STOCK_ITEM_REQUIRED", _("No posted stock cost is available for these items."))
	journal = frappe.get_doc(
		{
			"doctype": "Journal Entry",
			"voucher_type": "Journal Entry",
			"company": doc.company,
			"posting_date": nowdate(),
			"user_remark": _("Restaurant waste for {0}, ticket {1}: {2}").format(
				invoice.name, doc.name, reason.strip()
			),
			"accounts": accounts,
		}
	)
	journal.insert(ignore_permissions=True)
	journal.flags.ignore_permissions = True
	journal.submit()
	kitchen._record(
		doc,
		ACTION,
		key,
		doc.status,
		reason=reason.strip(),
		approved_by=frappe.session.user,
		quantities={
			"deltas": selected,
			"journal_entry": journal.name,
			"invoice_doctype": invoice.doctype,
			"invoice": invoice.name,
			"waste_account": account,
			"cost": flt(journal.total_debit),
			"basis": {line: by_line[line]["components"] for line in selected},
		},
		request_fingerprint=command_fingerprint,
		accounting={
			"billing_doctype": invoice.doctype,
			"billing_invoice": invoice.name,
			"posting_invoice": quote["posting_invoice"]
			if invoice.doctype == "Sales Invoice" or invoice.get("consolidated_invoice")
			else None,
			"journal_entry": journal.name,
		},
	)
	kitchen._publish(doc)
	return kitchen.ticket_detail(doc.name)


def protect_waste_accounting(doc, method=None):
	"""Accounts must reverse a waste reclassification before reversing its cost."""
	name = doc.get("return_against") if method == "validate" else doc.name
	if not name:
		return
	frappe.db.get_value(doc.doctype, name, "name", for_update=True)
	# Use a locking read: a just-completed waste request must not be missed by
	# a return/cancellation transaction that started before its commit.
	filters = (
		{"posting_invoice": name}
		if doc.doctype == "Sales Invoice"
		else {"billing_doctype": doc.doctype, "billing_invoice": name}
	)
	rows = frappe.qb.get_query(
		kitchen.ACTION,
		filters={**filters, "action": ACTION, "outcome": "Succeeded"},
		fields=["journal_entry"],
		for_update=True,
	).run(as_dict=True)
	if any(
		row.journal_entry
		and frappe.db.get_value("Journal Entry", row.journal_entry, "docstatus", for_update=True) == 1
		for row in rows
	):
		fail(
			"WASTE_ACCOUNTING_REVERSAL_REQUIRED",
			_(
				"This bill has recorded waste. Ask accounts to reverse its waste journal before cancelling or returning the bill."
			),
		)
