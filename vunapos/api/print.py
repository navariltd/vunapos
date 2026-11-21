import frappe

from vunapos.services.print_service import render_invoice as render_invoice_service
from vunapos.services.print_service import render_kitchen_ticket as render_kitchen_ticket_service
from vunapos.utils.response import failure, success


@frappe.whitelist()
def render_invoice(invoice_doctype, invoice_name, print_format=None):
	try:
		return success(
			render_invoice_service(
				invoice_doctype=invoice_doctype,
				invoice_name=invoice_name,
				print_format=print_format,
			)
		)
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)


@frappe.whitelist()
def render_kitchen_ticket(ticket, action=None):
	try:
		return success(render_kitchen_ticket_service(ticket, action=action))
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)
