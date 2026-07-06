import frappe
from frappe import _

from vunapos.services.invoice_service import SUPPORTED_INVOICE_DOCTYPES
from vunapos.utils.permissions import require_read


def resolve_print_format(invoice_doctype, print_format=None):
	if print_format:
		return print_format

	default_format = frappe.db.get_value(
		"Print Format",
		{"doc_type": invoice_doctype, "disabled": 0, "standard": "Yes"},
		"name",
		order_by="modified desc",
	)
	return default_format or "Standard"


def render_invoice(invoice_doctype, invoice_name, print_format=None):
	if invoice_doctype not in SUPPORTED_INVOICE_DOCTYPES:
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
