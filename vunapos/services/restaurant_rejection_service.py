"""Reject prepared food without erasing production or pretending it was served.

An approved charge waiver is a native line discount, not a reduction in cooked
quantity. The eventual bill consumes the original food once. No refund, stock
return or journal is created here. Immutable action snapshots preserve the
original unit price and waived quantities, including across later cancellations.
"""

import frappe
from frappe import _
from frappe.utils import flt

from vunapos.services import kitchen_lifecycle_service as kitchen
from vunapos.services import kitchen_progress_service as progress
from vunapos.services import restaurant_cancellation_service as cancellation
from vunapos.services import restaurant_request_service as requests
from vunapos.services.kitchen_service import fail

ACTION = "Reject Items"
PRICE_FIELDS = ("mapped_additional_discount_amount", "is_free_item")
EPS = progress.EPSILON


def _context(ticket):
	if not set(frappe.get_roles()) & kitchen.MANAGERS:
		frappe.throw(
			_("A restaurant manager must approve rejected food and its charge."), frappe.PermissionError
		)
	if not all(
		frappe.get_meta(doctype).has_field("mapped_additional_discount_amount")
		for doctype in ("Sales Order Item", "Sales Invoice Item", "POS Invoice Item")
	):
		fail(
			"REJECTION_DISCOUNT_NOT_SUPPORTED",
			_(
				"Update ERPNext to a version with native mapped line discounts before recording charge waivers."
			),
		)
	doc = kitchen._ticket(ticket, lock=True)
	session = frappe.get_doc("Restaurant Session", doc.restaurant_session, for_update=True)
	order = frappe.get_doc("Sales Order", doc.sales_order, for_update=True)
	order.check_permission("write")
	if (
		doc.docstatus != 1
		or doc.status == "Cancelled"
		or (doc.restaurant, doc.branch, doc.company, doc.restaurant_session)
		!= (session.restaurant, session.branch, session.company, order.vunapos_restaurant_session)
	):
		fail("REJECTION_CONTEXT_CHANGED", _("The ticket no longer belongs to this open visit and order."))
	return doc, session, order


def waiver_history(order):
	"""First commercial snapshot + cumulative waived quantity per native SO row."""
	result = {}
	for event in frappe.qb.get_query(
		kitchen.ACTION,
		filters={"sales_order": order.name, "action": ACTION, "outcome": "Succeeded"},
		fields=["item_quantities"],
		order_by="creation asc, name asc",
		for_update=True,
	).run(as_dict=True):
		payload = requests.parsed(event.item_quantities) or {}
		for name, adjustment in payload.get("waivers", {}).items():
			if name not in result:
				result[name] = {"base": adjustment["base"], "qty": 0.0}
			result[name]["qty"] += flt(adjustment["qty"])
	return result


def _prices(row, base, waived):
	if waived < -EPS or waived > flt(row.qty) + EPS or flt(row.qty) <= 0:
		fail("REJECTION_CHARGE_EXCEEDED", _("The charge for this quantity has already been waived."))
	remaining = max(0, flt(row.qty) - waived)
	# Native mapped discounts carry nine decimal places per stock unit and round
	# once at line-total precision. Averaging the selling rate (e.g. 200 / 3)
	# instead would leave extra cents at ordinary currency precision.
	waived_amount = flt(base["net_unit_rate"]) * waived
	stock_qty = flt(row.qty) * flt(row.conversion_factor or 1)
	mapped = flt(flt(base["mapped_additional_discount_amount"]) + waived_amount / stock_qty, 9)
	expected = flt(
		flt(base["mapped_additional_discount_amount"]) * stock_qty + waived_amount,
		row.precision("net_amount"),
	)
	if flt(mapped * stock_qty, row.precision("net_amount")) != expected:
		fail(
			"REJECTION_DISCOUNT_PRECISION",
			_(
				"This quantity is too large to allocate the waiver exactly. Ask accounts to review the order before changing its charge."
			),
		)
	return {
		"mapped_additional_discount_amount": mapped,
		"is_free_item": 1 if remaining <= EPS else base["is_free_item"],
	}


def _bases(order):
	# Let ERPNext resolve inclusive and item-specific taxes, retaining its
	# unrounded exclusive amount. A rounded net unit rate loses a cent when,
	# for example, two out of four tax-inclusive meals are waived separately.
	copy = frappe.get_doc(order.as_dict())
	copy.discount_amount = 0
	copy.additional_discount_percentage = 0
	for row in copy.items:
		row.mapped_additional_discount_amount = 0
	copy.calculate_taxes_and_totals()
	result = {}
	for original, row in zip(order.items, copy.items, strict=True):
		amount = row.get("_unrounded_net_amount")
		if amount is None:
			amount = row.net_amount
		result[original.name] = {
			**{field: original.get(field) for field in PRICE_FIELDS},
			"net_unit_rate": flt(amount) / flt(row.qty)
			- flt(original.mapped_additional_discount_amount) * flt(original.conversion_factor or 1),
		}
	return result


def reapply_waivers(order, history=None):
	"""Keep an absolute waiver intact when unprepared quantities are cancelled."""
	history = waiver_history(order) if history is None else history
	prices = {}
	for row in order.items:
		if row.name in history:
			entry = history[row.name]
			prices[row.name] = _prices(row, entry["base"], entry["qty"])
			row.update(prices[row.name])
	return {"order": order.name, "prices": prices}


def _quote(doc, session, order):
	states = progress.load([doc], for_update=True)[doc.name]
	quote = {
		"ticket": doc.name,
		"modified": str(doc.modified),
		"order_modified": str(order.modified),
		"session_modified": str(session.modified),
		"lines": [
			{
				"line_id": row.line_id,
				"item_name": row.item_name,
				"uom": row.uom,
				"max_qty": progress.remaining(states[row.line_id], ACTION),
			}
			for row in doc.items
			if not row.parent_line_id
		],
	}
	quote["fingerprint"] = requests.fingerprint(quote)
	return quote


def preview(ticket):
	doc, session, order = _context(ticket)
	cancellation._open(session, order)
	return _quote(doc, session, order)


def reject(ticket, quantities, request_key, fingerprint, reason, charge):
	doc, session, order = _context(ticket)
	key = kitchen._request_key(request_key)
	if not isinstance(reason, str) or not reason.strip() or len(reason) > 500:
		fail("REJECTION_REASON_REQUIRED", _("Enter a rejection reason of up to 500 characters."))
	if charge not in ("Keep charge", "Remove charge"):
		fail("REJECTION_CHARGE_REQUIRED", _("Choose whether to keep or remove the charge."))
	payload = {
		"quantities": requests.parsed(quantities),
		"fingerprint": fingerprint,
		"reason": reason.strip(),
		"charge": charge,
	}
	stamp = requests.fingerprint(payload)
	if kitchen._replay(doc, ACTION, key, reason.strip(), stamp, quantified=True):
		return kitchen.ticket_detail(doc.name)
	# Replays remain recoverable after checkout; new commands cannot change a bill.
	cancellation._open(session, order)
	if _quote(doc, session, order)["fingerprint"] != fingerprint:
		fail(
			"REJECTION_REVIEW_CHANGED",
			_("The order or kitchen progress changed. Review the latest quantities."),
		)
	if quantities is None:
		fail("REJECTION_QUANTITY_REQUIRED", _("Choose the rejected dishes and quantities."))
	states = progress.load([doc], for_update=True)[doc.name]
	selected = progress.selection(doc, ACTION, quantities, states)
	history = waiver_history(order)
	waivers = {}
	if charge == "Remove charge":
		by_source = {row.name: row for row in order.items}
		bases = _bases(order)
		for row in doc.items:
			parent = row.parent_line_id or row.line_id
			if parent not in selected:
				continue
			source = by_source.get(row.sales_order_item)
			if not source or source.item_code != row.item_code or source.uom != row.uom:
				fail("REJECTION_SOURCE_CHANGED", _("A prepared item no longer matches its source order."))
			parent_qty = next(part.qty for part in doc.items if part.line_id == parent)
			qty = flt(selected[parent] * flt(row.qty) / flt(parent_qty), 6)
			entry = history.setdefault(
				source.name,
				{
					"base": bases[source.name],
					"qty": 0.0,
				},
			)
			entry["qty"] += qty
			waivers[source.name] = {"qty": qty, "base": entry["base"]}
		old = frappe.flags.get("vunapos_restaurant_charge_adjustment")
		try:
			frappe.flags.vunapos_restaurant_charge_adjustment = reapply_waivers(order, history)
			order.flags.ignore_validate_update_after_submit = True
			order.ignore_pricing_rule = 1
			order.calculate_taxes_and_totals()
			order.set_total_in_words()
			order.set_payment_schedule()
			order.save()
		finally:
			frappe.flags.vunapos_restaurant_charge_adjustment = old
	baseline = {
		row.line_id: {field: states[row.line_id][field] for field in progress.FIELDS.values()}
		for row in doc.items
		if not row.parent_line_id
	}
	retired = {line: min(qty, progress.remaining(states[line], "Serve")) for line, qty in selected.items()}
	previous = doc.status
	for line, qty in selected.items():
		states[line]["rejected_qty"] += qty
		states[line]["rejected_served_qty"] += qty - retired[line]
		states[line]["retired_qty"] += retired[line]
	doc.db_set("status", progress.status_for(doc.items, states))
	kitchen._record(
		doc,
		ACTION,
		key,
		previous,
		reason=reason.strip(),
		approved_by=frappe.session.user,
		quantities={
			"deltas": selected,
			"before": baseline,
			"retired": retired,
			"charge": charge,
			"waivers": waivers,
		},
		request_fingerprint=stamp,
	)
	kitchen._publish(doc)
	return kitchen.ticket_detail(doc.name)
