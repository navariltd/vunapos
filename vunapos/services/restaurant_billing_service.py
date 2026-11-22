"""One native bill per restaurant visit, preserving submitted order row identity.

No public command accepts invoice items/rates. Kitchen stock is consumed only by
the native selling document; existing Sales Order reservations are credited, not
duplicated as new draft-invoice reservations.
"""

import hashlib
import json
from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime, nowdate, nowtime

from vunapos.services.kitchen_service import fail
from vunapos.services.profile_service import require_open_pos_session, resolve_pos_profile
from vunapos.services.restaurant_session_service import (
	KIOSK_AWAITING_PAYMENT,
	KIOSK_PAID,
	SESSION,
	_load,
	require_qr_order_accepted,
	session_to_dict,
)
from vunapos.setup.utils import CASHIER_ROLE

PRICE_FIELDS = (
	"qty",
	"uom",
	"stock_uom",
	"conversion_factor",
	"rate",
	"price_list_rate",
	"discount_percentage",
	"discount_amount",
	"mapped_additional_discount_amount",
	"item_tax_template",
	"item_tax_rate",
	"is_free_item",
)


def consolidated_reservation_sources(invoice):
	"""Native POS consolidation must consume only its own restaurant SREs."""
	result, parents = [], {}
	for row in invoice.items:
		if not row.get("pos_invoice") or not row.get("pos_invoice_item"):
			continue
		if row.pos_invoice not in parents:
			parents[row.pos_invoice] = frappe.get_doc("POS Invoice", row.pos_invoice, for_update=True)
		pos = parents[row.pos_invoice]
		if not pos.get("vunapos_restaurant_session"):
			continue
		source = next((part for part in pos.items if part.name == row.pos_invoice_item), None)
		if (
			pos.docstatus != 1
			or pos.is_return
			or pos.company != invoice.company
			or pos.customer != invoice.customer
			or pos.consolidated_invoice not in (None, "", invoice.name)
			or not source
			or (source.item_code, source.warehouse, source.uom) != (row.item_code, row.warehouse, row.uom)
			or abs(flt(source.stock_qty) - flt(row.stock_qty)) > 0.000001
		):
			fail(
				"CONSOLIDATION_SOURCE_MISMATCH",
				_("Consolidated stock rows must exactly match their submitted restaurant POS bills."),
			)
		order = frappe.db.get_value(
			"Sales Order",
			source.sales_order,
			["vunapos_restaurant_session", "company"],
			as_dict=True,
			for_update=True,
		)
		if (
			not order
			or order.vunapos_restaurant_session != pos.vunapos_restaurant_session
			or order.company != invoice.company
			or not frappe.db.exists(
				"Sales Order Item",
				{"name": source.so_detail, "parent": source.sales_order, "item_code": source.item_code},
			)
		):
			fail(
				"CONSOLIDATION_SOURCE_MISMATCH", _("The restaurant POS bill has invalid source order links.")
			)
		result.append((row, source.sales_order, source.so_detail))
	return result


def _orders(session, lock=False, unbilled=True, billing_invoice=None):
	# A kiosk order awaiting payment is reviewed and confirmed while still a draft.
	drafts = session.get("kiosk_status") == KIOSK_AWAITING_PAYMENT
	result = []
	for name in frappe.get_all(
		"Sales Order", filters={"vunapos_restaurant_session": session.name}, pluck="name", order_by="name"
	):
		doc = frappe.get_doc("Sales Order", name, for_update=lock)
		if doc.docstatus == 2:
			continue
		if (doc.docstatus != 1 and not (drafts and doc.docstatus == 0)) or doc.status == "Closed":
			fail(
				"SESSION_ORDER_NOT_BILLABLE",
				_("Order {0} is not submitted and open for billing.").format(name),
			)
		if unbilled and (
			flt(doc.per_billed)
			or (doc.get("vunapos_billing_invoice") and doc.vunapos_billing_invoice != billing_invoice)
		):
			fail(
				"SESSION_ORDER_ALREADY_BILLED",
				_("Order {0} was already billed outside this settlement. Review it in Desk.").format(name),
			)
		if (
			doc.customer != session.customer
			or doc.get("vunapos_restaurant") != session.restaurant
			or doc.get("vunapos_branch") != session.branch
			or doc.company != session.company
			or doc.currency != session.currency
		):
			fail(
				"SESSION_BILL_CONTEXT_MISMATCH",
				_("Order {0} has a different customer, company or currency.").format(name),
			)
		result.append(doc)
	if not result:
		fail("SESSION_NOTHING_TO_BILL", _("There are no placed, non-cancelled orders to bill."))
	return result


def _require_kiosk_payment_confirmed(session):
	# A kiosk order awaiting payment is billed only by confirming its payment, and a
	# QR order only once staff accept it.
	require_qr_order_accepted(session)
	if session.get("kiosk_status") == KIOSK_AWAITING_PAYMENT:
		fail(
			"KIOSK_ORDER_AWAITING_PAYMENT",
			_("Use Confirm payment to bill this kiosk order. That also sends it to the kitchen."),
		)


def needs_preparation(orders):
	"""Whether any line goes to a kitchen station and so is made from its recipe."""
	return any(
		row.get("vunapos_kitchen_station") and not row.get("vunapos_parent_line_id")
		for order in orders
		for row in order.items
	)


def _fingerprint(orders):
	return hashlib.sha256(
		json.dumps(
			[
				[
					doc.name,
					doc.customer,
					doc.currency,
					doc.selling_price_list,
					[
						[row.name, row.item_code, row.warehouse, *[row.get(field) for field in PRICE_FIELDS]]
						for row in doc.items
					],
				]
				for doc in orders
			],
			default=str,
			sort_keys=True,
		).encode()
	).hexdigest()


def _review_fingerprint(orders, doc):
	# Tax settings, loyalty value and the billing date can change without any
	# Sales Order mutation. Require another review rather than a silent new total.
	return hashlib.sha256(
		json.dumps(
			{
				"orders": _fingerprint(orders),
				"billing_profile": doc.pos_profile,
				"complete_preparation_on_billing": cint(
					frappe.get_cached_value(
						"POS Profile", doc.pos_profile, "vunapos_complete_preparation_on_billing"
					)
				),
				"date": str(doc.posting_date),
				"total": flt(doc.grand_total),
				"rounded": flt(doc.rounded_total),
				"loyalty": flt(doc.get("loyalty_amount")),
				"taxes": [
					[
						row.account_head,
						row.charge_type,
						flt(row.rate),
						flt(row.tax_amount),
						cint(row.included_in_print_rate),
					]
					for row in doc.taxes
				],
			},
			sort_keys=True,
		).encode()
	).hexdigest()


def _pending_production(order_names):
	from vunapos.services.restaurant_remake_service import validate_output_balance
	from vunapos.services.restaurant_stop_service import resolutions

	stopped = resolutions(order_names)

	for name in frappe.get_all(
		"Kitchen Order Ticket",
		filters={
			"sales_order": ["in", order_names],
			"docstatus": 1,
			"remake_of": ["is", "set"],
			"status": ["!=", "Cancelled"],
		},
		pluck="name",
		order_by="name",
	):
		validate_output_balance(frappe.get_doc("Kitchen Order Ticket", name, for_update=True))
	active = set(frappe.get_all("Sales Order Item", filters={"parent": ["in", order_names]}, pluck="name"))
	pending = [
		row.name
		for row in frappe.get_all(
			"Work Order",
			filters={"sales_order": ["in", order_names]},
			fields=["name", "docstatus", "qty", "produced_qty", "sales_order_item"],
			order_by="name",
		)
		if row.sales_order_item in active
		and row.name not in stopped
		and (row.docstatus != 1 or flt(row.produced_qty) + 0.000001 < flt(row.qty))
	]
	# Do not settle a visit with Sent/Preparing tickets that could no longer
	# advance after billing. Desk production must still be marked ready in KDS.
	pending.extend(
		frappe.get_all(
			"Kitchen Order Ticket",
			filters={
				"sales_order": ["in", order_names],
				"docstatus": 1,
				"status": ["not in", ["Ready", "Served", "Completed", "Cancelled"]],
				# Production finished at billing; the kitchen finishes the ticket later.
				"production_completed_at_billing": 0,
			},
			pluck="name",
			order_by="name",
		)
	)
	return pending


def _can_complete_preparation(profile, order_names, pending):
	if (
		not cint(profile.get("vunapos_complete_preparation_on_billing"))
		or CASHIER_ROLE not in frappe.get_roles()
	):
		return False
	tickets = frappe.get_all(
		"Kitchen Order Ticket",
		filters={
			"sales_order": ["in", order_names],
			"docstatus": 1,
			"status": ["in", ["Sent", "Accepted", "Preparing"]],
		},
		pluck="name",
	)
	linked = frappe.get_all(
		"Kitchen Order Ticket Item", filters={"parent": ["in", tickets or [""]]}, pluck="work_order"
	)
	if not tickets or not set(pending) <= set(tickets) | set(linked):
		return False
	for name in tickets:
		ticket = frappe.get_doc("Kitchen Order Ticket", name)
		if not (
			frappe.has_permission(ticket.doctype, "read", doc=ticket)
			and frappe.has_permission("Kitchen Station", "read", doc=ticket.kitchen_station)
		):
			return False
	return True


def _profile(session, pos_profile, payment=False):
	from vunapos.services.floor_plan_service import require_restaurant_profile

	profile = resolve_pos_profile(pos_profile or session.pos_profile)
	if (
		require_restaurant_profile(profile.name) != session.restaurant
		or profile.company != session.company
		or profile.vunapos_branch != session.branch
		or profile.currency != session.currency
	):
		fail(
			"SESSION_BILL_CONTEXT_MISMATCH",
			_("Choose a billing profile in this Restaurant with the same company and currency."),
		)
	if payment:
		if CASHIER_ROLE not in frappe.get_roles():
			frappe.throw(_("Only a VunaPOS Cashier may settle a restaurant bill."), frappe.PermissionError)
		require_open_pos_session(profile.name)
	return profile


def recalculate_bill(doc):
	from vunapos.services.invoice_service import _apply_item_tax_inclusivity

	# Prices come from immutable submitted rounds, not today's Item Price.
	doc.ignore_pricing_rule = 1
	if hasattr(doc, "append_taxes_from_item_tax_template"):
		doc.append_taxes_from_item_tax_template()
	_apply_item_tax_inclusivity(doc)
	doc.calculate_taxes_and_totals()
	if hasattr(doc, "set_total_in_words"):
		doc.set_total_in_words()
	return doc


def _build(session, profile, orders, loyalty_points=None):
	from vunapos.services.invoice_service import _apply_loyalty_redemption, _build_invoice_doc, _get_item_row

	doc, _ = _build_invoice_doc(
		profile.name,
		customer=session.customer,
		service_type=session.service_type,
	)
	# This is a server-validated order snapshot, not a cashier price-list edit.
	doc.selling_price_list = session.selling_price_list
	doc.price_list_currency = orders[0].price_list_currency
	doc.vunapos_restaurant_session = session.name
	doc.vunapos_restaurant = session.restaurant
	doc.vunapos_branch = session.branch
	doc.vunapos_restaurant_table = next((row.table for row in session.tables if not row.released_at), None)
	doc.ignore_pricing_rule = 1
	for order in orders:
		for source in order.items:
			values = _get_item_row(
				source.item_code,
				source.qty,
				doc,
				profile,
				item_tax_template=source.item_tax_template,
				pricing_item={"uom": source.uom},
			)
			values.update(
				{field: source.get(field) for field in PRICE_FIELDS if source.meta.has_field(field)}
			)
			values.update(
				{"sales_order": order.name, "so_detail": source.name, "warehouse": source.warehouse}
			)
			row = doc.append("items", values)
			if row.meta.has_field("vunapos_item_note"):
				row.vunapos_item_note = source.get("vunapos_item_note")
	recalculate_bill(doc)
	_apply_loyalty_redemption(doc, loyalty_points)
	return doc


def preview(session, pos_profile=None, loyalty_points=None):
	from vunapos.dto.invoice import invoice_to_dict

	session = _load(session)
	profile = _profile(session, pos_profile)
	if session.status == "Settling" and session.billing_invoice:
		invoice = frappe.get_doc(session.billing_doctype, session.billing_invoice)
		invoice.check_permission("read")
		return {
			"session": session_to_dict(session),
			"invoice": invoice_to_dict(invoice),
			"fingerprint": session.billing_fingerprint,
			"account_reference": invoice.name,
		}
	if session.status != "Open":
		fail("SESSION_NOT_OPEN", _("Only an open visit can be billed."))
	require_qr_order_accepted(session)
	orders = _orders(session)
	bill = _build(session, profile, orders, loyalty_points)
	if session.get("kiosk_status") == KIOSK_AWAITING_PAYMENT:
		# Confirming submits the drafts, so their tickets and Work Orders do not exist yet.
		# It always completes their preparation, whatever this till's setting.
		return {
			"session": session_to_dict(session),
			"invoice": invoice_to_dict(bill),
			"fingerprint": _review_fingerprint(orders, bill),
			"account_reference": orders[0].name,
			"gateway_links": _recover_payments(session, profile, orders),
			"can_checkout": True,
			"will_complete_preparation": needs_preparation(orders),
			"checkout_block_reason": None,
		}
	pending = _pending_production([order.name for order in orders])
	auto_complete = bool(
		pending and _can_complete_preparation(profile, [order.name for order in orders], pending)
	)
	return {
		"session": session_to_dict(session),
		"invoice": invoice_to_dict(bill),
		"fingerprint": _review_fingerprint(orders, bill),
		"account_reference": orders[0].name,
		"gateway_links": _recover_payments(session, profile, orders),
		"can_checkout": not pending or auto_complete,
		"will_complete_preparation": bool(pending and auto_complete),
		"can_record_walkout": bool(
			set(frappe.get_roles()) & {"System Manager", "VunaPOS Restaurant Manager"}
			and CASHIER_ROLE in frappe.get_roles()
		),
		"checkout_block_reason": _("Complete kitchen production before taking payment: {0}").format(
			", ".join(pending)
		)
		if pending and not auto_complete
		else None,
	}


def render_bill(session, pos_profile, fingerprint):
	"""Render an unpaid bill from placed rounds without saving an invoice or payment."""
	from vunapos.services.print_service import resolve_print_format

	session = _load(session)
	session.check_permission("print")
	profile = _profile(session, pos_profile)
	if session.status != "Open":
		fail("SESSION_NOT_OPEN", _("Only an open visit can print an unpaid bill."))
	require_qr_order_accepted(session)
	orders = _orders(session)
	bill = _build(session, profile, orders)
	if not fingerprint or fingerprint != _review_fingerprint(orders, bill):
		fail("SESSION_BILL_CHANGED", _("The bill changed. Refresh the bill before printing it."))
	print_format = resolve_print_format(bill.doctype, profile.get("print_format"))
	# Give the unsaved snapshot a printable visit reference, not an invoice number.
	# It remains docstatus 0 and is never inserted or submitted.
	bill.name = session.name
	previous = frappe.flags.get("ignore_print_permissions")
	try:
		# The session's read/print permissions and profile access were checked
		# above. Waiters can print this snapshot without invoice permissions.
		frappe.flags.ignore_print_permissions = True
		html = frappe.get_print(
			bill.doctype,
			doc=bill,
			print_format=print_format,
			settings={"allow_print_for_draft": 1},
		)
	finally:
		frappe.flags.ignore_print_permissions = previous
	return {"html": html, "session": session.name, "fingerprint": fingerprint, "print_format": print_format}


def _recover_payments(session, profile, orders):
	from vunapos.services.restaurant_payment_service import recover

	return recover(session, profile)


def validate_billing_invoice(doc, method=None):
	if not doc.get("vunapos_restaurant_session") or doc.get("is_return"):
		return
	session = _load(doc.vunapos_restaurant_session, for_update=True)
	if session.billing_invoice and (
		session.billing_invoice != doc.name or session.billing_doctype != doc.doctype
	):
		fail("SESSION_ALREADY_BILLED", _("This visit already has a billing document."))
	if session.status not in ("Open", "Settling") and doc.docstatus != 1:
		fail("SESSION_NOT_OPEN", _("This visit cannot receive another bill."))
	orders = _orders(session, lock=True, unbilled=doc.docstatus != 1, billing_invoice=doc.name)
	expected = {row.name: (order, row) for order in orders for row in order.items}
	if doc.customer != session.customer or doc.company != session.company or doc.currency != session.currency:
		fail(
			"SESSION_BILL_CONTEXT_MISMATCH",
			_("The bill must retain the visit's customer, company and currency."),
		)
	if session.billing_profile and doc.pos_profile != session.billing_profile:
		fail("SESSION_BILL_CONTEXT_MISMATCH", _("The billing profile cannot be changed after checkout."))
	seen = set()
	for row in doc.items:
		pair = expected.get(row.get("so_detail"))
		if not pair or row.so_detail in seen:
			fail(
				"SESSION_BILL_LINES_CHANGED", _("The bill must contain each placed order line exactly once.")
			)
		order, source = pair
		if (
			row.sales_order != order.name
			or row.item_code != source.item_code
			or row.warehouse != source.warehouse
		):
			fail("SESSION_BILL_LINES_CHANGED", _("Billing order/warehouse links cannot be changed."))
		for field in (
			"qty",
			"rate",
			"conversion_factor",
			"discount_percentage",
			"discount_amount",
			"mapped_additional_discount_amount",
			"is_free_item",
		):
			precision = 0.000000001 if field == "mapped_additional_discount_amount" else 0.000001
			if abs(flt(row.get(field)) - flt(source.get(field))) > precision:
				fail(
					"SESSION_BILL_LINES_CHANGED",
					_("Bill quantity and price for {0} must match its placed order.").format(
						source.item_name
					),
				)
		if row.uom != source.uom:
			fail("SESSION_BILL_LINES_CHANGED", _("The bill must retain each placed line's selling UOM."))
		seen.add(row.so_detail)
	if seen != set(expected):
		fail("SESSION_BILL_LINES_CHANGED", _("The bill must include all non-cancelled rounds."))
	return session, orders


def _pending_pos_stock_not_reserved(doc, code, warehouse):
	"""Count unmerged POS commitments not already deducted as other orders' SREs.

	POS Invoice defers stock issue until consolidation. Its source SRE can still
	be live, so subtracting both would count the same stock twice. Never offset
	a pending sale using SREs already credited to the current bill.
	"""
	from frappe.query_builder.functions import Sum

	invoice = frappe.qb.DocType("POS Invoice")
	conditions = (invoice.docstatus == 1) & (
		invoice.consolidated_invoice.isnull() | (invoice.consolidated_invoice == "")
	)
	if doc.doctype == "POS Invoice" and doc.get("name"):
		conditions &= invoice.name != doc.name
	item = frappe.qb.DocType("POS Invoice Item")
	rows = (
		frappe.qb.from_(invoice)
		.inner_join(item)
		.on(item.parent == invoice.name)
		.select(item.sales_order, item.so_detail, Sum(item.stock_qty).as_("qty"))
		.where(conditions & (item.docstatus == 1) & (item.item_code == code) & (item.warehouse == warehouse))
		.groupby(item.sales_order, item.so_detail)
		.run(as_dict=True)
	)
	credited = {row.so_detail for row in doc.items if row.get("so_detail")}
	reserved = defaultdict(float)
	details = {row.so_detail for row in rows if row.so_detail and row.so_detail not in credited}
	if details:
		for row in frappe.get_all(
			"Stock Reservation Entry",
			filters={
				"voucher_type": "Sales Order",
				"voucher_detail_no": ["in", sorted(details)],
				"item_code": code,
				"warehouse": warehouse,
				"docstatus": 1,
			},
			fields=["voucher_no", "voucher_detail_no", "reserved_qty", "delivered_qty"],
		):
			reserved[(row.voucher_no, row.voucher_detail_no)] += max(
				0, flt(row.reserved_qty) - flt(row.delivered_qty)
			)
	pending = sum(
		flt(row.qty) - min(max(0, flt(row.qty)), reserved[(row.sales_order, row.so_detail)]) for row in rows
	)
	# Other tills can sell bundles even though restaurant rounds do not support
	# them. Their pending packed components also consume this warehouse's stock.
	packed = frappe.qb.DocType("Packed Item")
	packed_qty = (
		frappe.qb.from_(invoice)
		.inner_join(packed)
		.on(packed.parent == invoice.name)
		.select(Sum(packed.qty))
		.where(
			conditions
			& (packed.docstatus == 1)
			& (packed.parenttype == "POS Invoice")
			& (packed.item_code == code)
			& (packed.warehouse == warehouse)
		)
		.run()
	)
	return pending + flt(packed_qty[0][0] if packed_qty else 0)


def validate_billing_stock(doc):
	from erpnext.stock.doctype.stock_reservation_entry.stock_reservation_entry import (
		get_sre_reserved_qty_for_item_and_warehouse,
	)
	from erpnext.stock.utils import get_or_make_bin, get_stock_balance

	from vunapos.services.invoice_service import _set_row_batch_allocations, _set_row_serial_allocations

	pending = _pending_production(list({row.sales_order for row in doc.items}))
	if pending:
		fail(
			"SESSION_FINISHED_STOCK_REQUIRED",
			_("Complete production and mark the kitchen tickets ready before billing: {0}").format(
				", ".join(pending)
			),
		)

	from vunapos.services.restaurant_stop_service import resolutions

	stopped = resolutions(list({row.sales_order for row in doc.items}))
	for name in frappe.get_all(
		"Work Order",
		filters={"sales_order": ["in", list({row.sales_order for row in doc.items})]},
		pluck="name",
		order_by="name",
	):
		wo = frappe.get_doc("Work Order", name, for_update=True)
		if wo.sales_order_item not in {row.so_detail for row in doc.items}:
			continue
		if wo.name in stopped:
			needed = sum(
				flt(row.qty) * flt(row.conversion_factor)
				for row in doc.items
				if row.so_detail == wo.sales_order_item
			)
			if needed > flt(wo.produced_qty) + 0.000001:
				fail(
					"SESSION_FINISHED_STOCK_REQUIRED",
					_("Stopped preparation did not produce enough food for this bill."),
				)
			continue
		if wo.docstatus != 1 or flt(wo.produced_qty) + 0.000001 < flt(wo.qty):
			fail(
				"SESSION_FINISHED_STOCK_REQUIRED",
				_(
					"Complete Work Order {0} before billing this visit. Existing finished stock does not replace its reserved kitchen production."
				).format(wo.name),
			)

	demand = defaultdict(float)
	for row in doc.items:
		if not frappe.get_cached_value("Item", row.item_code, "is_stock_item"):
			continue
		demand[(row.item_code, row.warehouse)] += flt(row.qty) * flt(row.conversion_factor)
	for (code, warehouse), qty in sorted(demand.items()):
		frappe.db.get_value("Bin", get_or_make_bin(code, warehouse), "name", for_update=True)
		own = sum(
			flt(row.reserved_qty) - flt(row.delivered_qty)
			for row in frappe.get_all(
				"Stock Reservation Entry",
				filters={
					"voucher_type": "Sales Order",
					"voucher_detail_no": ["in", [row.so_detail for row in doc.items]],
					"item_code": code,
					"warehouse": warehouse,
					"docstatus": 1,
				},
				fields=["reserved_qty", "delivered_qty"],
			)
		)
		available = (
			flt(get_stock_balance(code, warehouse))
			- flt(get_sre_reserved_qty_for_item_and_warehouse(code, warehouse))
			+ own
			- _pending_pos_stock_not_reserved(doc, code, warehouse)
		)
		if qty > available + 0.000001:
			fail(
				"SESSION_FINISHED_STOCK_REQUIRED",
				_(
					"Cannot bill {0}: the visit needs {1} stock units, but only {2} are available including its own reservations. Complete kitchen production first."
				).format(code, qty, available),
			)
	for row in doc.items:
		flags = frappe.get_cached_value(
			"Item", row.item_code, ["has_batch_no", "has_serial_no"], as_dict=True
		)
		if not flags or not (flags.has_batch_no or flags.has_serial_no):
			continue
		entries = []
		for name in frappe.get_all(
			"Stock Reservation Entry",
			filters={
				"voucher_type": "Sales Order",
				"voucher_detail_no": row.so_detail,
				"warehouse": row.warehouse,
				"docstatus": 1,
			},
			pluck="name",
			order_by="name",
		):
			sre = frappe.get_doc("Stock Reservation Entry", name)
			entries.extend(
				{
					"batch_no": entry.batch_no,
					"serial_no": entry.serial_no,
					"qty": flt(entry.qty) - flt(entry.delivered_qty),
				}
				for entry in sre.sb_entries
				if flt(entry.qty) > flt(entry.delivered_qty)
			)
		if abs(sum(entry["qty"] for entry in entries) - flt(row.qty) * flt(row.conversion_factor)) > 0.000001:
			fail(
				"SESSION_TRACKING_RESERVATION_REQUIRED",
				_("Reserve exact batches/serials against order line {0} before billing {1}.").format(
					row.so_detail, row.item_name
				),
			)
		if flags.has_serial_no:
			_set_row_serial_allocations(row, entries)
		else:
			batches = defaultdict(float)
			for entry in entries:
				batches[entry["batch_no"]] += entry["qty"]
			allocations = [{"batch_no": batch, "qty": qty} for batch, qty in batches.items()]
			_set_row_batch_allocations(row, allocations)
			row.batch_no = allocations[0]["batch_no"] if len(allocations) == 1 else None


def checkout(session, pos_profile, fingerprint, payments=None, *, _walkout_reason=None, **options):
	from vunapos.dto.invoice import invoice_to_dict
	from vunapos.services.gateway_payment_service import consume_gateway_payment_links
	from vunapos.services.invoice_service import (
		_materialize_batch_bundles,
		_prepare_invoice_for_checkout,
		_stamp_validated_session,
	)
	from vunapos.services.workflow_service import workflow_enabled_for
	from vunapos.utils.permissions import require_create

	if _walkout_reason is not None:
		from vunapos.services.restaurant_walkout_service import require_manager

		_walkout_reason = require_manager(_walkout_reason)
	session = _load(session, for_update=True)
	profile = _profile(session, pos_profile, payment=True)
	if session.billing_invoice:
		if _walkout_reason is not None and session.get("walkout_reason") != _walkout_reason:
			fail("WALKOUT_BILL_EXISTS", _("This visit already has a bill. Review its original incident."))
		doc = frappe.get_doc(session.billing_doctype, session.billing_invoice)
		doc.check_permission("read")
		if doc.docstatus == 2:
			fail(
				"SESSION_BILL_CANCELLED",
				_(
					"This visit's bill was cancelled. A manager must review the original bill and any payment before further correction."
				),
			)
		return {"session": session_to_dict(session), "invoice": invoice_to_dict(doc)}
	if session.status != "Open":
		fail("SESSION_NOT_OPEN", _("This visit cannot be billed."))
	_require_kiosk_payment_confirmed(session)
	orders = _orders(session, lock=True)
	doc = _build(session, profile, orders, options.get("loyalty_points"))
	if not fingerprint or fingerprint != _review_fingerprint(orders, doc):
		fail(
			"SESSION_BILL_CHANGED",
			_("The orders changed since this bill was reviewed. Refresh the bill before taking payment."),
		)
	require_create(doc.doctype)
	from vunapos.services.restaurant_payment_service import validate_checkout

	if _walkout_reason is not None:
		from vunapos.services.gateway_payment_service import SUCCESSFUL_LINK_STATUSES
		from vunapos.services.restaurant_payment_service import links
		from vunapos.services.restaurant_walkout_service import APPROVAL

		payments = []
		for link in links(session):
			if link.status not in SUCCESSFUL_LINK_STATUSES:
				fail(
					"WALKOUT_PAYMENT_UNCONFIRMED",
					_("Resolve the pending gateway payment before recording a walkout."),
				)
			payments.append(
				{
					"mode_of_payment": link.mode_of_payment,
					"amount": link.amount,
					"gateway_payment_link": link.name,
				}
			)
		precision = doc.precision("grand_total") or 2
		if (
			flt(
				(doc.rounded_total or doc.grand_total) - sum(flt(row["amount"]) for row in payments),
				precision,
			)
			<= 0
		):
			fail("WALKOUT_NOT_UNPAID", _("This bill has no unpaid balance. Review its payments instead."))
		doc.flags.restaurant_walkout_approval = APPROVAL
		options.update(is_credit_sale=True, due_date=nowdate())
	validate_checkout(session, profile, payments)
	# A kiosk order paid at the counter is billed as it reaches the kitchen, so its
	# preparation is always completed here. For waiter orders the till decides.
	kiosk = session.get("kiosk_status") == KIOSK_PAID
	if kiosk or cint(profile.get("vunapos_complete_preparation_on_billing")):
		from vunapos.services.kitchen_lifecycle_service import complete_for_billing

		for name in frappe.get_all(
			"Kitchen Order Ticket",
			filters={
				"sales_order": ["in", [order.name for order in orders]],
				"docstatus": 1,
				"status": ["in", ["Sent", "Accepted", "Preparing"]],
				"production_completed_at_billing": 0,
			},
			pluck="name",
			order_by="name",
		):
			complete_for_billing(name, profile, kiosk=kiosk)
		# The bill was priced before manufacture. Its stock issue must be posted
		# after the new finished-goods receipts, not at that earlier preview time.
		if str(doc.posting_date) != nowdate():
			fail("SESSION_BILL_CHANGED", _("The billing date changed. Refresh the bill before proceeding."))
		doc.posting_time = nowtime()
	validate_billing_stock(doc)
	_stamp_validated_session(doc, require_open_pos_session(profile.name))
	doc.vunapos_idempotency_key = "restaurant-session-" + hashlib.sha256(session.name.encode()).hexdigest()
	doc.insert()
	_materialize_batch_bundles(doc)
	_prepare_invoice_for_checkout(
		doc, payments=payments, idempotency_key=doc.vunapos_idempotency_key, **options
	)
	# Workflow drafts retain their table and bill identity until native submission.
	session.billing_doctype, session.billing_invoice = doc.doctype, doc.name
	session.billing_profile, session.billing_fingerprint = profile.name, fingerprint
	if _walkout_reason is not None:
		session.walkout_reason = _walkout_reason
		session.walkout_by = frappe.session.user
		session.walkout_at = now_datetime()
	session.status = "Settling"
	session.flags.restaurant_session_write = True
	session.save(ignore_permissions=True)
	for order in orders:
		order.db_set(
			{
				"vunapos_billing_doctype": doc.doctype,
				"vunapos_billing_invoice": doc.name,
				"vunapos_billed_by": frappe.session.user,
				"vunapos_billed_at": now_datetime(),
			}
		)
	consume_gateway_payment_links(doc.flags.get("vunapos_gateway_payment_links", []), doc)
	if not workflow_enabled_for(profile, doc.doctype):
		doc.submit()
	session.reload()
	return {"session": session_to_dict(session), "invoice": invoice_to_dict(doc)}


def on_submit(doc, method=None):
	if not doc.get("vunapos_restaurant_session") or doc.get("is_return"):
		return
	session = frappe.get_doc(SESSION, doc.vunapos_restaurant_session, for_update=True)
	if session.billing_invoice != doc.name or session.billing_doctype != doc.doctype:
		fail("SESSION_BILL_CONTEXT_MISMATCH", _("This is not the visit's settlement document."))
	if session.status == "Settled":
		return
	# Native Sales Invoice submission already consumed stock/reservations. Do not
	# manufacture, issue ingredients, or create another reservation here.
	session.status = "Settled"
	session.closed_at = now_datetime()
	# A paid kiosk order keeps its table until staff clear it as the guests leave.
	for row in session.tables if session.get("kiosk_status") != KIOSK_PAID else []:
		if not row.released_at:
			row.released_at = session.closed_at
	session.flags.restaurant_session_write = True
	session.save(ignore_permissions=True)


def before_submit(doc, method=None):
	if not doc.get("vunapos_restaurant_session") or doc.get("is_return"):
		return
	session = _load(doc.vunapos_restaurant_session, for_update=True)
	_require_kiosk_payment_confirmed(session)
	_orders(session, lock=True, billing_invoice=doc.name)
	validate_billing_stock(doc)
