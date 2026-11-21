import math

import frappe
from frappe import _

from vunapos.services.invoice_service import SUPPORTED_INVOICE_DOCTYPES, SUPPORTED_ORDER_DOCTYPES
from vunapos.utils.permissions import require_read

# Print formats VunaPOS prints only when asked for by name, never as a doctype's default.
KIOSK_ORDER_SLIP = "Kiosk Order Slip"
NAMED_ONLY_PRINT_FORMATS = (KIOSK_ORDER_SLIP,)


def resolve_print_format(invoice_doctype, print_format=None):
	if print_format:
		return print_format

	default_format = frappe.db.get_value(
		"Print Format",
		{
			"doc_type": invoice_doctype,
			"disabled": 0,
			"standard": "Yes",
			"name": ["not in", NAMED_ONLY_PRINT_FORMATS],
		},
		"name",
		order_by="modified desc",
	)
	return default_format or "Standard"


def render_invoice(invoice_doctype, invoice_name, print_format=None):
	if invoice_doctype not in (*SUPPORTED_INVOICE_DOCTYPES, *SUPPORTED_ORDER_DOCTYPES):
		frappe.throw(_("Unsupported invoice doctype: {0}").format(invoice_doctype))
	require_read(invoice_doctype, invoice_name)
	resolved_print_format = resolve_print_format(invoice_doctype, print_format)
	html = frappe.get_print(invoice_doctype, invoice_name, print_format=resolved_print_format)
	return {
		"invoice_doctype": invoice_doctype,
		"invoice_name": invoice_name,
		"print_format": resolved_print_format,
		"html": html,
	}


def render_kitchen_ticket(ticket, action=None, delivery=False):
	from vunapos.services.kitchen_service import STATION, TICKET
	from vunapos.services.restaurant_service import require_restaurant_access

	doc = frappe.get_doc(TICKET, ticket)
	require_restaurant_access(doc.restaurant, branch=doc.branch)
	doc.check_permission("read")
	frappe.get_doc(STATION, doc.kitchen_station).check_permission("read")
	doc.check_permission("print")
	if doc.docstatus != 1:
		frappe.throw(_("Only submitted kitchen tickets can be printed."))
	if action:
		event = frappe.get_doc("Kitchen Ticket Action", action)
		event.check_permission("read")
		if (
			event.kitchen_ticket != doc.name
			or event.kitchen_station != doc.kitchen_station
			or event.restaurant != doc.restaurant
			or event.branch != doc.branch
			or event.outcome != "Succeeded"
			or event.action
			not in (
				"Cancel Items",
				"Stop Preparation",
				"Cancel Order",
				"Cancel Remake",
				"Update preparation notes",
			)
		):
			frappe.throw(_("Choose a successful cancellation belonging to this ticket."))
		if event.action == "Cancel Remake" and (not doc.get("remake_of") or event.to_status != "Cancelled"):
			frappe.throw(_("Choose the cancelled replacement ticket event."))
		lines = []
		if event.action == "Update preparation notes":
			payload = frappe.parse_json(event.item_quantities or "{}")
			row = next((row for row in doc.items if row.line_id == payload.get("line_id")), None)
			if row is None or not isinstance(payload.get("after"), str):
				frappe.throw(_("Invalid preparation correction."))
			lines = [
				frappe._dict(
					item_name=row.item_name, before=payload.get("before", ""), after=payload["after"]
				)
			]
		elif event.action not in ("Cancel Order", "Cancel Remake"):
			payload = frappe.parse_json(event.item_quantities or "{}")
			deltas = payload.get("deltas") if isinstance(payload, dict) else None
			if not isinstance(deltas, dict) or not deltas:
				frappe.throw(_("This cancellation has no printable item quantities."))
			items = {row.line_id: row for row in doc.items}
			for line_id, value in deltas.items():
				row = items.get(line_id)
				try:
					qty = float(value)
				except (TypeError, ValueError):
					qty = float("nan")
				if row is None or not math.isfinite(qty) or qty <= 0 or qty > row.qty:
					frappe.throw(_("This cancellation contains invalid item quantities."))
				lines.append(frappe._dict(item_name=row.item_name, qty=qty, uom=row.uom))
		# Render-only context: never save the ticket or replay the cancellation command.
		doc.print_action = frappe._dict(
			name=event.name,
			action=event.action,
			occurred_at=event.occurred_at,
			actor=event.actor,
			reason=event.reason,
			lines=lines,
		)
	doc.print_delivery = frappe._dict(delivery) if isinstance(delivery, dict) else bool(delivery)
	# Fail closed instead of silently falling back to a generic document layout.
	print_format = frappe.get_doc("Print Format", "Kitchen Order Ticket")
	if print_format.disabled or print_format.doc_type != TICKET or print_format.raw_printing:
		frappe.throw(_("The Kitchen Order Ticket print format is not available."))
	return {
		"ticket": doc.name,
		"print_format": print_format.name,
		"html": frappe.get_print(TICKET, doc.name, print_format=print_format.name, doc=doc, no_letterhead=1),
	}
