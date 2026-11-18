from functools import wraps
from uuid import uuid4

import frappe

from vunapos.services import inspection_service, stock_service
from vunapos.utils.response import failure, success


def endpoint(fn):
	@wraps(fn)
	def wrapped(*args, **kwargs):
		savepoint = "pos_stock_" + uuid4().hex
		frappe.db.savepoint(savepoint)
		try:
			return success(fn(*args, **kwargs))
		except Exception as exc:
			frappe.db.rollback(save_point=savepoint)
			return failure(
				frappe.utils.strip_html(str(exc)) or "You do not have permission for this stock action.",
				code=exc.__class__.__name__,
			)

	return wrapped


@frappe.whitelist()
@endpoint
def capabilities(pos_profile: str):
	return stock_service.capabilities(pos_profile)


@frappe.whitelist()
@endpoint
def catalogue(pos_profile: str, query: str | None = None):
	return stock_service.catalogue(pos_profile, query)


@frappe.whitelist()
@endpoint
def list_requests(
	pos_profile: str,
	start: int = 0,
	query: str | None = None,
	from_date: str | None = None,
	to_date: str | None = None,
	docstatus: str | None = None,
):
	return stock_service.list_requests(pos_profile, start, query, from_date, to_date, docstatus)


@frappe.whitelist()
@endpoint
def request_details(pos_profile: str, name: str):
	return stock_service.request_details(pos_profile, name)


@frappe.whitelist()
@endpoint
def request_draft(pos_profile: str, name: str):
	return stock_service.request_draft(pos_profile, name)


@frappe.whitelist(methods=["POST"])
@endpoint
def submit_request(pos_profile: str, name: str, modified: str):
	return stock_service.submit_request(pos_profile, name, modified)


@frappe.whitelist()
@endpoint
def scan_request_item(pos_profile: str, barcode: str):
	return stock_service.scan_request_item(pos_profile, barcode)


@frappe.whitelist(methods=["POST"])
@endpoint
def create_request(
	pos_profile: str,
	items: list | str,
	required_by: str,
	request_key: str,
	notes: str | None = None,
	hold: bool = False,
	draft_name: str | None = None,
	draft_modified: str | None = None,
):
	return stock_service.create_request(
		pos_profile, items, required_by, request_key, notes, hold, draft_name, draft_modified
	)


@frappe.whitelist()
@endpoint
def held_requests(pos_profile: str):
	return stock_service.held_requests(pos_profile)


@frappe.whitelist(methods=["POST"])
@endpoint
def request_workflow_action(pos_profile: str, name: str, action: str, modified: str):
	return stock_service.request_workflow_action(pos_profile, name, action, modified)


@frappe.whitelist()
@endpoint
def held_request(pos_profile: str, name: str):
	return stock_service.held_request(pos_profile, name)


@frappe.whitelist()
@endpoint
def list_transit(
	pos_profile: str,
	start: int = 0,
	query: str | None = None,
	from_date: str | None = None,
	to_date: str | None = None,
	progress: str | None = None,
	transit_warehouse: str | None = None,
):
	return stock_service.list_transit(
		pos_profile, start, query, from_date, to_date, progress, transit_warehouse
	)


@frappe.whitelist()
@endpoint
def stock_entry_details(pos_profile: str, stock_entry: str):
	return stock_service.stock_entry_details(pos_profile, stock_entry)


@frappe.whitelist()
@endpoint
def receipt_details(pos_profile: str, stock_entry: str, receipt: str):
	return stock_service.receipt_details(pos_profile, stock_entry, receipt)


@frappe.whitelist()
@endpoint
def inspection_context(pos_profile: str, stock_entry: str, receipt: str, row_name: str):
	return stock_service.inspection_context(pos_profile, stock_entry, receipt, row_name)


@frappe.whitelist()
@endpoint
def inspection_details(pos_profile: str, stock_entry: str, receipt: str, row_name: str):
	return inspection_service.details(pos_profile, stock_entry, receipt, row_name)


@frappe.whitelist()
@endpoint
def inspection_templates(
	pos_profile: str, stock_entry: str, receipt: str, row_name: str, query: str | None = None
):
	return inspection_service.templates(pos_profile, stock_entry, receipt, row_name, query)


@frappe.whitelist()
@endpoint
def inspection_template_details(
	pos_profile: str, stock_entry: str, receipt: str, row_name: str, template: str
):
	return inspection_service.template_details(pos_profile, stock_entry, receipt, row_name, template)


@frappe.whitelist()
@endpoint
def inspection_parameters(
	pos_profile: str, stock_entry: str, receipt: str, row_name: str, query: str | None = None
):
	return inspection_service.parameters(pos_profile, stock_entry, receipt, row_name, query)


@frappe.whitelist(methods=["POST"])
@endpoint
def save_inspection(pos_profile: str, stock_entry: str, receipt: str, row_name: str, payload: dict | str):
	return inspection_service.save(pos_profile, stock_entry, receipt, row_name, payload)


@frappe.whitelist()
@endpoint
def preview_inspection(pos_profile: str, stock_entry: str, receipt: str, row_name: str, payload: dict | str):
	return inspection_service.preview(pos_profile, stock_entry, receipt, row_name, payload)


@frappe.whitelist(methods=["POST"])
@endpoint
def complete_receipt(
	pos_profile: str, stock_entry: str, receipt: str, review: str, action: str | None = None
):
	return stock_service.complete_receipt(pos_profile, stock_entry, receipt, review, action)


@frappe.whitelist()
@endpoint
def transit_details(pos_profile: str, stock_entry: str):
	return stock_service.transit_details(pos_profile, stock_entry)


@frappe.whitelist(methods=["POST"])
@endpoint
def end_transit(
	pos_profile: str,
	stock_entry: str,
	review: str,
	quantities: list | str | None = None,
	request_key: str | None = None,
):
	return stock_service.end_transit(pos_profile, stock_entry, review, quantities, request_key)
