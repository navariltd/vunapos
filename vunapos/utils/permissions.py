import frappe
from frappe import _


def require_read(doctype, name=None):
	if not frappe.has_permission(doctype, "read", doc=name):
		frappe.throw(_("Not permitted to read {0}").format(doctype), frappe.PermissionError)


def require_write(doctype, name=None):
	if not frappe.has_permission(doctype, "write", doc=name):
		frappe.throw(_("Not permitted to write {0}").format(doctype), frappe.PermissionError)


def require_create(doctype):
	if not frappe.has_permission(doctype, "create"):
		frappe.throw(_("Not permitted to create {0}").format(doctype), frappe.PermissionError)
