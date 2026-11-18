"""Profile-scoped stock requests and native two-leg transit receipts."""

import hashlib
import json
import math
from html import unescape
from urllib.parse import quote, urlencode

import frappe
from frappe import _
from frappe.model.workflow import (
	apply_workflow,
	get_transitions,
	get_workflow,
	get_workflow_name,
	has_approval_access,
)
from frappe.query_builder import Order
from frappe.query_builder.functions import Sum
from frappe.utils import cint, escape_html, flt, getdate, nowdate

from vunapos.services.profile_service import require_open_pos_session, resolve_pos_profile
from vunapos.utils.permissions import require_create, require_read


def fail(message):
	frappe.throw(_(message))


def profile_context(pos_profile, operation=None):
	profile = resolve_pos_profile(pos_profile)
	if operation and not cint(profile.get(operation)):
		fail("This stock operation is disabled in the POS Profile.")
	require_open_pos_session(profile.name)
	warehouse = frappe.get_doc("Warehouse", profile.warehouse)
	warehouse.check_permission("read")
	if warehouse.company != profile.company or warehouse.is_group or warehouse.disabled:
		fail("The POS Profile must use an enabled company warehouse, not a warehouse group.")
	return profile


def capabilities(pos_profile):
	profile = profile_context(pos_profile)
	return {
		"warehouse": profile.warehouse,
		"request_workflow": _request_workflow_name(profile),
		"can_view_requests": bool(
			(
				cint(profile.get("vunapos_allow_stock_requests"))
				or cint(profile.get("vunapos_allow_end_transit"))
			)
			and frappe.has_permission("Material Request", "read")
		),
		"can_request": bool(
			cint(profile.get("vunapos_allow_stock_requests"))
			and frappe.has_permission("Material Request", "create")
			and frappe.has_permission("Material Request", "read")
		),
		"can_receive": bool(
			cint(profile.get("vunapos_allow_end_transit"))
			and frappe.has_permission("Stock Entry", "read")
			and frappe.has_permission("Stock Entry", "create")
		),
	}


def _request_workflow_name(profile):
	if profile and any(
		row.get("transaction_doctype") == "Material Request" and cint(row.get("apply_workflow"))
		for row in profile.get("vunapos_workflow_configuration") or []
	):
		return get_workflow_name("Material Request") or None
	return None


def _request_read_context(pos_profile):
	profile = profile_context(pos_profile)
	if not (
		cint(profile.get("vunapos_allow_stock_requests")) or cint(profile.get("vunapos_allow_end_transit"))
	):
		fail("Stock operations are disabled in the POS Profile.")
	require_read("Material Request")
	return profile


def _date_filters(filters, field, from_date, to_date):
	try:
		if from_date:
			filters.append([field, ">=", str(getdate(from_date))])
		if to_date:
			filters.append([field, "<=", str(getdate(to_date))])
		if from_date and to_date and getdate(from_date) > getdate(to_date):
			fail("The start date cannot be after the end date.")
	except (ValueError, TypeError):
		fail("Enter valid filter dates.")


def list_requests(pos_profile, start=0, query=None, from_date=None, to_date=None, docstatus=None):
	profile = _request_read_context(pos_profile)
	query = str(query or "").strip()[:140]
	fields = ["name", "transaction_date", "schedule_date", "status", "docstatus", "per_ordered", "modified"]
	workflow_name = _request_workflow_name(profile)
	state_field = get_workflow("Material Request").workflow_state_field if workflow_name else None
	if state_field and state_field not in fields:
		fields.append(state_field)
	filters = [
		["Material Request", "company", "=", profile.company],
		["Material Request", "material_request_type", "=", "Material Transfer"],
		["Material Request Item", "warehouse", "=", profile.warehouse],
	]
	_date_filters(filters, "transaction_date", from_date, to_date)
	if docstatus not in (None, ""):
		if str(docstatus) not in ("0", "1", "2"):
			fail("Choose a valid document status.")
		filters.append(["Material Request", "docstatus", "=", cint(docstatus)])
	rows = frappe.get_list(
		"Material Request",
		filters=filters,
		or_filters=[["name", "like", f"%{query}%"]] if query else None,
		fields=fields,
		distinct=True,
		order_by="modified desc, name desc",
		start=max(0, cint(start)),
		limit_page_length=21,
	)
	for row in rows:
		row["display_status"] = row.get(state_field) if state_field and row.get(state_field) else row.status
		row["workflow_enabled"] = bool(state_field and row.get(state_field))
	return rows


def request_details(pos_profile, name):
	profile = _request_read_context(pos_profile)
	doc = frappe.get_doc("Material Request", name)
	doc.check_permission("read")
	rows = [row for row in doc.items if row.warehouse == profile.warehouse]
	if doc.company != profile.company or doc.material_request_type != "Material Transfer" or not rows:
		frappe.throw(_("This request does not target the POS Profile warehouse."), frappe.PermissionError)
	result = _stock_result(doc, profile)
	edit_error = _request_edit_error(profile, doc)
	if result.get("workflow") and (
		not cint(profile.get("vunapos_allow_stock_requests"))
		or not doc.get("vunapos_created_in_pos")
		or doc.get("vunapos_pos_profile") != profile.name
		or len(rows) != len(doc.items)
	):
		result["workflow"]["actions"] = []
	return {
		"can_edit": not edit_error,
		"edit_reason": edit_error,
		"can_submit": not edit_error
		and not get_workflow_name("Material Request")
		and bool(doc.has_permission("submit")),
		"result": result,
		"transaction_date": doc.transaction_date,
		"owner": doc.owner,
		"company": doc.company,
		"required_by": doc.schedule_date,
		"notes": unescape(frappe.utils.strip_html((doc.terms or "").replace("<br>", "\n"))),
		"items": [
			{
				"name": row.name,
				"item_code": row.item_code,
				"item_name": row.item_name,
				"qty": row.qty,
				"uom": row.uom,
				"stock_qty": row.stock_qty,
				"stock_uom": row.stock_uom,
			}
			for row in rows
		],
		"has_other_warehouses": len(rows) != len(doc.items),
		"transfers": frappe.get_list(
			"Stock Entry",
			filters=[
				["Stock Entry", "company", "=", profile.company],
				["Stock Entry", "docstatus", "=", 1],
				["Stock Entry", "add_to_transit", "=", 1],
				["Stock Entry Detail", "material_request_item", "in", [row.name for row in rows]],
			],
			fields=["name", "posting_date", "per_transferred"],
			distinct=True,
			order_by="posting_date desc, name desc",
			limit_page_length=20,
		)
		if cint(profile.get("vunapos_allow_end_transit"))
		and frappe.has_permission("Stock Entry", "read")
		and frappe.has_permission("Stock Entry", "create")
		else [],
	}


def _item_filters(profile):
	filters = {"disabled": 0, "is_stock_item": 1, "is_sales_item": 1, "is_fixed_asset": 0, "has_variants": 0}
	groups = set()
	for row in profile.get("item_groups") or []:
		bounds = frappe.db.get_value("Item Group", row.item_group, ["lft", "rgt"], as_dict=True)
		if bounds:
			groups.update(
				frappe.get_all(
					"Item Group", filters={"lft": [">=", bounds.lft], "rgt": ["<=", bounds.rgt]}, pluck="name"
				)
			)
	if profile.get("item_groups"):
		filters["item_group"] = ["in", sorted(groups) or [""]]
	return filters


def catalogue(pos_profile, query=None, item_code=None):
	profile = profile_context(pos_profile, "vunapos_allow_stock_requests")
	_request_catalogue_permission()
	query = str(query or "").strip()[:140]
	filters = _item_filters(profile)
	if item_code:
		filters["name"] = item_code
	rows = frappe.get_list(
		"Item",
		filters=filters,
		or_filters=[["item_code", "like", f"%{query}%"], ["item_name", "like", f"%{query}%"]]
		if query
		else None,
		fields=["name", "item_code", "item_name", "image", "stock_uom", "sales_uom"],
		order_by="item_name asc",
		limit_page_length=60,
	)
	for row in rows:
		row["uoms"] = [{"uom": row.stock_uom, "conversion_factor": 1}]
		for unit in frappe.get_all(
			"UOM Conversion Detail",
			filters={"parent": row.name, "parenttype": "Item"},
			fields=["uom", "conversion_factor"],
		):
			if unit.uom != row.stock_uom:
				row["uoms"].append(unit)
		row["actual_qty"] = flt(
			frappe.db.get_value("Bin", {"item_code": row.name, "warehouse": profile.warehouse}, "actual_qty")
		)
	return rows


def scan_request_item(pos_profile, barcode):
	from erpnext.stock.utils import scan_barcode

	profile_context(pos_profile, "vunapos_allow_stock_requests")
	_request_catalogue_permission()
	barcode = str(barcode or "").strip()
	if not barcode or len(barcode) > 140:
		fail("Scan a valid item barcode or enter an item code.")
	resolved = scan_barcode(barcode)
	# Item codes typed into the search field can also be added with Enter.
	code = resolved.get("item_code") or barcode
	rows = catalogue(pos_profile, item_code=code)
	if not rows:
		fail("No allowed stock item matches this barcode or item code.")
	item = rows[0]
	uom = resolved.get("uom")
	if uom and not any(unit["uom"] == uom for unit in item.uoms):
		fail("The scanned barcode uses a UOM that is not configured on this item.")
	return {"item": item, "uom": uom}


def fingerprint(value):
	return hashlib.sha256(
		json.dumps(value, sort_keys=True, default=str, separators=(",", ":")).encode()
	).hexdigest()


def _save(doc, hold=False, profile=None):
	doc.insert()
	# A stock operation must not jump over a configured approval workflow.
	if (
		not hold
		and not get_workflow_name(doc.doctype)
		and frappe.has_permission(doc.doctype, "submit", doc=doc)
		and not (doc.doctype == "Stock Entry" and doc.get("inspection_required"))
	):
		if doc.doctype == "Stock Entry" and doc.get("outgoing_stock_entry"):
			doc.vunapos_received_in_pos = 1
		doc.submit()
	return _stock_result(doc, profile)


def _stock_result(doc, profile=None):
	result = {
		"name": doc.name,
		"doctype": doc.doctype,
		"docstatus": doc.docstatus,
		"status": doc.get("status"),
		"warehouse": doc.get("set_warehouse") or doc.get("to_warehouse"),
		"is_held": doc.docstatus == 0 and bool(doc.get("vunapos_stock_request_held")),
		"modified": str(doc.modified),
		"inspection_required": bool(doc.get("inspection_required")),
		"created_in_pos": bool(doc.get("vunapos_created_in_pos")),
		"received_in_pos": bool(doc.get("vunapos_received_in_pos")),
	}
	if doc.doctype == "Material Request" and not result["is_held"] and _request_workflow_name(profile):
		workflow = get_workflow(doc.doctype)
		result["workflow"] = {
			"name": workflow.name,
			"state": doc.get(workflow.workflow_state_field),
			"actions": [
				{"action": row.action, "next_state": row.next_state}
				for row in get_transitions(doc, workflow=workflow)
				if has_approval_access(frappe.session.user, doc, row)
			]
			if doc.docstatus == 0
			else [],
		}
	return result


def request_workflow_action(pos_profile, name, action, modified):
	profile = profile_context(pos_profile, "vunapos_allow_stock_requests")
	doc = frappe.get_doc("Material Request", name, for_update=True)
	doc.check_permission("read")
	if (
		doc.get("vunapos_pos_profile") != profile.name
		or doc.company != profile.company
		or doc.material_request_type != "Material Transfer"
		or any(row.warehouse != profile.warehouse for row in doc.items)
	):
		frappe.throw(_("This request does not belong to the selected POS Profile."), frappe.PermissionError)
	if not _request_workflow_name(profile) or doc.docstatus != 0 or doc.get("vunapos_stock_request_held"):
		fail("Workflow actions are not available for this request.")
	if str(doc.modified) != modified:
		fail("This request has changed. Reload it in Desk before choosing a workflow action.")
	if not action or not str(action).strip():
		fail("Choose a workflow action.")
	apply_workflow(doc, str(action).strip())
	return _stock_result(frappe.get_doc("Material Request", name), profile)


def _request_scope_error(profile, doc):
	if (
		not cint(profile.get("vunapos_allow_stock_requests"))
		or not doc.get("vunapos_created_in_pos")
		or doc.get("vunapos_pos_profile") != profile.name
		or doc.company != profile.company
		or doc.material_request_type != "Material Transfer"
		or not doc.items
		or any(row.warehouse != profile.warehouse for row in doc.items)
	):
		return _("Only POS requests belonging entirely to this POS Profile can be edited here.")
	if doc.get("vunapos_stock_request_held") and doc.owner != frappe.session.user:
		return _("This held request belongs to another user.")
	return None


def _request_catalogue_permission():
	require_read("Material Request")
	if not (
		frappe.has_permission("Material Request", "create")
		or frappe.has_permission("Material Request", "write")
	):
		frappe.throw(_("You cannot create or edit Material Requests."), frappe.PermissionError)


def _request_edit_error(profile, doc):
	if reason := _request_scope_error(profile, doc):
		return reason
	if doc.docstatus != 0:
		return _("Only draft Material Requests can be edited.")
	if not doc.has_permission("write"):
		return _("You do not have permission to edit this Material Request.")
	if get_workflow_name("Material Request"):
		workflow = get_workflow("Material Request")
		state = next(
			(
				row
				for row in workflow.get("states") or []
				if row.state == doc.get(workflow.workflow_state_field)
			),
			None,
		)
		if not state:
			return _(
				"This request has no valid workflow state. Ask your workflow administrator to review it."
			)
		if state.allow_edit and state.allow_edit != "All" and state.allow_edit not in frappe.get_roles():
			return _("You cannot edit this request in its current workflow state.")
	return None


def request_draft(pos_profile, name):
	profile = profile_context(pos_profile, "vunapos_allow_stock_requests")
	doc = frappe.get_doc("Material Request", name)
	doc.check_permission("read")
	if reason := _request_edit_error(profile, doc):
		frappe.throw(reason, frappe.PermissionError)
	return _draft_request_data(doc)


def submit_request(pos_profile, name, modified):
	profile = profile_context(pos_profile, "vunapos_allow_stock_requests")
	doc = frappe.get_doc("Material Request", name, for_update=True)
	doc.check_permission("read")
	if reason := _request_scope_error(profile, doc):
		frappe.throw(reason, frappe.PermissionError)
	if doc.docstatus == 1:
		return _stock_result(doc, profile)
	if reason := _request_edit_error(profile, doc):
		frappe.throw(reason, frappe.PermissionError)
	if get_workflow_name("Material Request"):
		fail("This request has an active workflow. Use its permitted workflow action instead of Submit.")
	if not modified or str(doc.modified) != str(modified):
		fail("This request changed. Refresh and review it before submitting.")
	doc.check_permission("submit")
	doc.vunapos_stock_request_held = 0
	doc.submit()
	return _stock_result(doc, profile)


def create_request(
	pos_profile, items, required_by, request_key, notes=None, hold=False, draft_name=None, draft_modified=None
):
	profile = profile_context(pos_profile, "vunapos_allow_stock_requests")
	hold = bool(cint(hold))
	if not draft_name:
		require_create("Material Request")
	require_read("Material Request")
	if not isinstance(request_key, str) or not request_key.strip() or len(request_key) > 140:
		fail("A request key is required. Reopen the request and try again.")
	try:
		date = getdate(required_by)
	except (ValueError, TypeError):
		fail("Enter a valid required-by date.")
	if not required_by or date < getdate(nowdate()):
		fail("Required-by date cannot be before today.")
	items = frappe.parse_json(items) if isinstance(items, str) else items
	if not isinstance(items, list) or not items or len(items) > 100:
		fail("Request between 1 and 100 item rows.")
	if not isinstance(notes or "", str) or len(notes or "") > 1000:
		fail("Request notes cannot exceed 1,000 characters.")
	rows = []
	allowed = _item_filters(profile)
	for row in items:
		if not isinstance(row, dict) or isinstance(row.get("qty"), bool):
			fail("Enter valid item quantities.")
		try:
			qty = float(row.get("qty"))
		except (TypeError, ValueError):
			fail("Enter valid item quantities.")
		if not math.isfinite(qty) or qty <= 0:
			fail("Requested quantity must be greater than zero and finite.")
		codes = frappe.get_list(
			"Item",
			filters={**allowed, "name": row.get("item_code")},
			fields=["name", "stock_uom"],
			limit_page_length=1,
		)
		if not codes:
			fail("Choose stock items allowed by this POS Profile.")
		item = codes[0]
		uom = row.get("uom") or item.stock_uom
		factor = (
			1
			if uom == item.stock_uom
			else frappe.db.get_value(
				"UOM Conversion Detail",
				{"parent": item.name, "parenttype": "Item", "uom": uom},
				"conversion_factor",
			)
		)
		if not factor or flt(factor) <= 0:
			fail("Choose a UOM configured on the requested item.")
		rows.append(
			{
				"item_code": item.name,
				"qty": qty,
				"uom": uom,
				"stock_uom": item.stock_uom,
				"conversion_factor": factor,
				"warehouse": profile.warehouse,
				"schedule_date": date,
			}
		)
	stamp = fingerprint({"rows": rows, "notes": notes or "", "required_by": date})
	key = fingerprint([frappe.session.user, profile.name, request_key])
	# Serialize retries, then use a current read rather than an old DB snapshot.
	frappe.db.get_value("POS Profile", profile.name, "name", for_update=True)
	if draft_name:
		doc = frappe.get_doc("Material Request", draft_name, for_update=True)
		doc.check_permission("read")
		if reason := _request_scope_error(profile, doc):
			frappe.throw(reason, frappe.PermissionError)
		if doc.docstatus != 0:
			if doc.vunapos_stock_request_fingerprint == stamp and not hold and doc.docstatus != 2:
				return _stock_result(doc, profile)
			fail("This request is no longer a draft. Reload it before continuing.")
		if reason := _request_edit_error(profile, doc):
			frappe.throw(reason, frappe.PermissionError)
		doc.check_permission("write")
		if str(doc.modified) != str(draft_modified):
			# A lost hold response can be retried, but stale edits cannot overwrite another terminal.
			if (
				bool(doc.vunapos_stock_request_held) == hold
				and doc.vunapos_stock_request_fingerprint == stamp
			):
				return _stock_result(doc, profile)
			fail("This request changed in another window. Reload it before continuing.")
		doc.set("items", rows)
		doc.schedule_date = date
		doc.terms = escape_html(notes or "").replace("\n", "<br>")
		doc.vunapos_stock_request_fingerprint = stamp
		doc.vunapos_stock_request_held = hold
		doc.save()
		if (
			not hold
			and not get_workflow_name(doc.doctype)
			and frappe.has_permission(doc.doctype, "submit", doc=doc)
		):
			doc.submit()
		return _stock_result(doc, profile)
	existing = frappe.db.get_value(
		"Material Request",
		{"vunapos_stock_request_key": key},
		["name", "vunapos_stock_request_fingerprint"],
		as_dict=True,
		for_update=True,
	)
	if existing:
		if existing.vunapos_stock_request_fingerprint != stamp:
			frappe.throw(
				_(
					"Request {0} was already saved with different items. Review it in Desk before creating another."
				).format(existing.name)
			)
		doc = frappe.get_doc("Material Request", existing.name, for_update=True)
		doc.check_permission("read")
		if doc.docstatus == 2:
			frappe.throw(
				_("Request {0} was cancelled. Start a new request instead of retrying it.").format(doc.name)
			)
		return _stock_result(doc, profile)
	doc = frappe.get_doc(
		{
			"doctype": "Material Request",
			"material_request_type": "Material Transfer",
			"company": profile.company,
			"transaction_date": nowdate(),
			"schedule_date": date,
			"set_warehouse": profile.warehouse,
			"items": rows,
			"terms": escape_html(notes or "").replace("\n", "<br>"),
			"vunapos_stock_request_key": key,
			"vunapos_created_in_pos": 1,
			"vunapos_stock_request_fingerprint": stamp,
			"vunapos_pos_profile": profile.name,
			"vunapos_stock_request_held": hold,
		}
	)
	return _save(doc, hold=hold, profile=profile)


def held_requests(pos_profile):
	profile = profile_context(pos_profile, "vunapos_allow_stock_requests")
	return frappe.get_list(
		"Material Request",
		filters={
			"owner": frappe.session.user,
			"vunapos_pos_profile": profile.name,
			"vunapos_stock_request_held": 1,
			"docstatus": 0,
		},
		fields=["name", "schedule_date", "modified"],
		order_by="modified desc",
		limit_page_length=100,
	)


def held_request(pos_profile, name):
	profile = profile_context(pos_profile, "vunapos_allow_stock_requests")
	doc = frappe.get_doc("Material Request", name)
	doc.check_permission("read")
	if (
		doc.owner != frappe.session.user
		or doc.vunapos_pos_profile != profile.name
		or doc.docstatus != 0
		or not doc.get("vunapos_stock_request_held")
	):
		fail("This held request is not available for this user and POS Profile.")
	if reason := _request_edit_error(profile, doc):
		frappe.throw(reason, frappe.PermissionError)
	return _draft_request_data(doc)


def _draft_request_data(doc):
	lines = []
	for row in doc.items:
		item = frappe.get_doc("Item", row.item_code)
		item.check_permission("read")
		units = [{"uom": item.stock_uom, "conversion_factor": 1}]
		units.extend(
			{"uom": unit.uom, "conversion_factor": unit.conversion_factor}
			for unit in item.uoms
			if unit.uom != item.stock_uom
		)
		lines.append(
			{
				"item": {
					"item_code": item.name,
					"item_name": item.item_name,
					"stock_uom": item.stock_uom,
					"sales_uom": item.sales_uom,
					"uoms": units,
					"actual_qty": 0,
				},
				"qty": row.qty,
				"uom": row.uom,
			}
		)
	return {
		"workflow": get_workflow_name("Material Request") or None,
		"submitAllowed": not get_workflow_name("Material Request") and bool(doc.has_permission("submit")),
		"name": doc.name,
		"modified": str(doc.modified),
		"lines": lines,
		"requiredBy": str(doc.schedule_date),
		"notes": unescape(frappe.utils.strip_html((doc.terms or "").replace("<br>", "\n"))),
	}


def _eligible_rows(source, profile):
	if (
		source.company != profile.company
		or source.docstatus != 1
		or source.purpose != "Material Transfer"
		or not source.add_to_transit
	):
		fail("Choose a submitted material transfer that is in transit for this company.")
	rows = []
	for row in source.items:
		if not row.material_request or not row.material_request_item:
			continue
		target = frappe.db.get_value(
			"Material Request Item",
			row.material_request_item,
			["parent", "warehouse", "item_code"],
			as_dict=True,
			for_update=True,
		)
		if not target or target.warehouse != profile.warehouse:
			continue
		request = frappe.get_doc("Material Request", target.parent, for_update=True)
		request.check_permission("read")
		if (
			target.parent != row.material_request
			or target.item_code != row.item_code
			or request.company != profile.company
			or request.docstatus != 1
			or request.material_request_type != "Material Transfer"
		):
			fail("This transfer's Material Request references need review in Desk.")
		remaining = flt(row.transfer_qty) - flt(row.transferred_qty)
		if remaining > 0:
			rows.append(
				{
					"source_row": row.name,
					"item_code": row.item_code,
					"item_name": row.item_name,
					"stock_qty": remaining,
					"stock_uom": row.stock_uom,
					"uom": row.uom,
					"conversion_factor": row.conversion_factor,
					"material_request": row.material_request,
					"source_warehouse": row.t_warehouse,
					"warehouse": target.warehouse,
				}
			)
	return rows


def transit_details(pos_profile, stock_entry):
	profile = profile_context(pos_profile, "vunapos_allow_end_transit")
	source = frappe.get_doc("Stock Entry", stock_entry, for_update=True)
	source.check_permission("read")
	rows = _eligible_rows(source, profile)
	if not rows:
		fail("No outstanding transit rows target this POS Profile warehouse.")
	return {
		"name": source.name,
		"posting_date": source.posting_date,
		"warehouse": profile.warehouse,
		"items": rows,
		"fingerprint": fingerprint(rows),
	}


def list_transit(
	pos_profile, start=0, query=None, from_date=None, to_date=None, progress=None, transit_warehouse=None
):
	profile = profile_context(pos_profile, "vunapos_allow_end_transit")
	require_read("Stock Entry")
	if progress not in (None, "", "unreceived", "partial", "received"):
		fail("Choose a valid receipt status.")
	entry, row, request = (
		frappe.qb.DocType(name) for name in ("Stock Entry", "Stock Entry Detail", "Material Request Item")
	)
	scoped = (
		frappe.qb.from_(entry)
		.join(row)
		.on(row.parent == entry.name)
		.join(request)
		.on((request.name == row.material_request_item) & (request.parent == row.material_request))
		.select(
			entry.name, Sum(row.transfer_qty).as_("sent_qty"), Sum(row.transferred_qty).as_("received_qty")
		)
		.where(
			(entry.docstatus == 1)
			& (entry.company == profile.company)
			& (entry.purpose == "Material Transfer")
			& (entry.add_to_transit == 1)
			& (request.warehouse == profile.warehouse)
		)
		.groupby(entry.name)
		.orderby(entry.name)
		.run(as_dict=True)
	)
	completed = [value.name for value in scoped if flt(value.received_qty) >= flt(value.sent_qty)]
	# Completion history is POS-scoped, but incoming transfers can originate in Desk.
	# Use permission-filtered receipts for this warehouse, not a parent-wide progress percentage.
	pos_received = (
		{
			value.outgoing_stock_entry
			for value in frappe.get_list(
				"Stock Entry",
				filters=[
					["Stock Entry", "outgoing_stock_entry", "in", completed],
					["Stock Entry", "docstatus", "=", 1],
					["Stock Entry", "company", "=", profile.company],
					["Stock Entry Detail", "t_warehouse", "=", profile.warehouse],
				],
				fields=["outgoing_stock_entry"],
				or_filters={"vunapos_created_in_pos": 1, "vunapos_received_in_pos": 1},
				distinct=True,
				limit_page_length=0,
			)
		}
		if completed
		else set()
	)
	statuses = {
		value.name: "Received"
		if flt(value.received_qty) >= flt(value.sent_qty)
		else "Partially received"
		if flt(value.received_qty) > 0
		else "Awaiting receipt"
		for value in scoped
		if flt(value.received_qty) < flt(value.sent_qty) or value.name in pos_received
	}
	wanted_status = {
		"unreceived": "Awaiting receipt",
		"partial": "Partially received",
		"received": "Received",
	}.get(progress)
	names = [name for name, status in statuses.items() if not wanted_status or status == wanted_status]
	filters = [["name", "in", names or [""]]]
	_date_filters(filters, "posting_date", from_date, to_date)
	if query:
		filters.append(["name", "like", f"%{str(query).strip()[:140]}%"])
	if transit_warehouse:
		filters.append(["to_warehouse", "like", f"%{str(transit_warehouse).strip()[:140]}%"])
	rows = frappe.get_list(
		"Stock Entry",
		filters=filters,
		fields=["name", "posting_date", "from_warehouse", "to_warehouse", "per_transferred"],
		order_by="posting_date desc, name desc",
		start=max(0, cint(start)),
		limit_page_length=21,
	)
	for value in rows:
		value["receipt_status"] = statuses[value.name]
	return rows


def _mixed_receipts(names, warehouse):
	if not names:
		return set()
	return {
		row.parent
		for row in frappe.get_all(
			"Stock Entry Detail",
			filters={"parent": ["in", names], "parenttype": "Stock Entry"},
			fields=["parent", "t_warehouse"],
		)
		if row.t_warehouse != warehouse
	}


def stock_entry_details(pos_profile, stock_entry):
	profile = profile_context(pos_profile, "vunapos_allow_end_transit")
	doc = frappe.get_doc("Stock Entry", stock_entry)
	doc.check_permission("read")
	if (
		doc.company != profile.company
		or doc.docstatus != 1
		or doc.purpose != "Material Transfer"
		or not doc.add_to_transit
	):
		fail("Choose a submitted in-transit transfer for this company.")
	items = []
	for row in doc.items:
		if not row.material_request_item or not row.material_request:
			continue
		target = frappe.db.get_value(
			"Material Request Item",
			row.material_request_item,
			["parent", "warehouse", "item_code"],
			as_dict=True,
		)
		if not target or target.warehouse != profile.warehouse:
			continue
		request = frappe.get_doc("Material Request", target.parent)
		request.check_permission("read")
		if (
			target.parent != row.material_request
			or target.item_code != row.item_code
			or request.company != profile.company
			or request.material_request_type != "Material Transfer"
		):
			fail("This transfer's Material Request references need review in Desk.")
		items.append(
			{
				"name": row.name,
				"item_code": row.item_code,
				"item_name": row.item_name,
				"qty": row.qty,
				"uom": row.uom,
				"conversion_factor": row.conversion_factor,
				"partial_tracking_restricted": _partial_tracking_restricted(row),
				"tracking": _remaining_tracking(row),
				"whole_uom": bool(frappe.get_cached_value("UOM", row.uom, "must_be_whole_number")),
				"whole_stock_uom": bool(
					frappe.get_cached_value("UOM", row.stock_uom, "must_be_whole_number")
				),
				"qty_precision": row.precision("qty"),
				"stock_precision": row.precision("transfer_qty"),
				"stock_qty": flt(row.transfer_qty),
				"stock_uom": row.stock_uom,
				"received_qty": flt(row.transferred_qty),
				"remaining_qty": max(0, flt(row.transfer_qty) - flt(row.transferred_qty)),
				"material_request": row.material_request,
				"source_warehouse": row.s_warehouse,
				"transit_warehouse": row.t_warehouse,
				"batch_no": row.get("batch_no"),
				"serial_no": row.get("serial_no"),
			}
		)
	if not items:
		frappe.throw(_("This transfer does not target the POS Profile warehouse."), frappe.PermissionError)
	pending = _eligible_rows(doc, profile)
	receipts = frappe.get_list(
		"Stock Entry",
		filters=[
			["Stock Entry", "outgoing_stock_entry", "=", doc.name],
			["Stock Entry", "docstatus", "<", 2],
			["Stock Entry Detail", "t_warehouse", "=", profile.warehouse],
		],
		fields=["name", "posting_date", "docstatus"],
		distinct=True,
		order_by="creation desc",
		limit_page_length=20,
	)
	mixed = _mixed_receipts([row.name for row in receipts], profile.warehouse)
	for row in receipts:
		row["has_other_warehouses"] = row.name in mixed
	return {
		"name": doc.name,
		"posting_date": doc.posting_date,
		"company": doc.company,
		"owner": doc.owner,
		"warehouse": profile.warehouse,
		"from_warehouse": doc.from_warehouse,
		"to_warehouse": doc.to_warehouse,
		"remarks": unescape(frappe.utils.strip_html(doc.remarks or "")),
		"items": items,
		"fingerprint": fingerprint(pending) if pending else None,
		"status": "Received"
		if not pending
		else "Partially received"
		if any(row["received_qty"] for row in items)
		else "Awaiting receipt",
		"receipts": receipts,
		"has_other_warehouses": len(items) != len(doc.items),
	}


def _receipt_context(pos_profile, stock_entry, receipt, lock=False):
	profile = profile_context(pos_profile, "vunapos_allow_end_transit")
	source = frappe.get_doc("Stock Entry", stock_entry, for_update=lock)
	source.check_permission("read")
	pending = _eligible_rows(source, profile)
	doc = frappe.get_doc("Stock Entry", receipt, for_update=lock)
	doc.check_permission("read")
	if (
		doc.company != profile.company
		or doc.purpose != "Material Transfer"
		or doc.add_to_transit
		or doc.outgoing_stock_entry != source.name
		or doc.docstatus not in (0, 1)
		or not doc.items
		or not any(row.t_warehouse == profile.warehouse for row in doc.items)
	):
		frappe.throw(
			_("This receipt does not belong to this transfer and POS Profile warehouse."),
			frappe.PermissionError,
		)
	return profile, source, doc, pending


def _receipt_blocker(profile, source, doc, pending):
	by_row = {row["source_row"]: row for row in pending}
	source_rows = {row.name: row for row in source.items}
	totals = {}
	for part in doc.items:
		if part.t_warehouse != profile.warehouse:
			return _("This receipt includes other warehouses. Review it in Desk before submitting.")
		original = source_rows.get(part.ste_detail)
		if (
			not original
			or part.item_code != original.item_code
			or part.s_warehouse != original.t_warehouse
			# ERPNext's receipt mapper may leave these no-copy fields blank;
			# ste_detail is the authoritative link back to the dispatch row.
			or (part.material_request and part.material_request != original.material_request)
			or (part.material_request_item and part.material_request_item != original.material_request_item)
			or part.stock_uom != original.stock_uom
		):
			return _("Receipt source rows or warehouse references have changed. Review this draft in Desk.")
		qty = flt(part.qty) * flt(part.conversion_factor)
		if not math.isfinite(qty) or qty <= 0 or flt(part.conversion_factor) <= 0:
			return _("Receipt quantities and UOM conversion factors must be positive.")
		totals[part.ste_detail] = totals.get(part.ste_detail, 0) + qty
		current = by_row.get(part.ste_detail)
		if not current or flt(totals[part.ste_detail], part.precision("transfer_qty")) > flt(
			current["stock_qty"], part.precision("transfer_qty")
		):
			return _("This draft requests more stock than remains in transit. Review its quantities in Desk.")
	return None


def _inspection_for_row(profile, source, doc, row):
	from erpnext.controllers.stock_controller import (
		QI_INCOMING_PURPOSES,
		is_inspection_exempt_secondary_row,
		stock_entry_row_requires_inspection,
	)

	required = bool(
		doc.inspection_required
		and stock_entry_row_requires_inspection(doc.purpose, row)
		and not is_inspection_exempt_secondary_row(doc, row)
	)
	name = row.get("quality_inspection")
	blocked = False
	message = None
	qi = (
		frappe.db.get_value(
			"Quality Inspection",
			name,
			["name", "docstatus", "status", "reference_type", "reference_name", "item_code"],
			as_dict=True,
		)
		if name
		else None
	)
	if required:
		if not qi:
			blocked = True
			message = _(
				"Quality Inspection is required for {0} before this receipt can be submitted."
			).format(row.item_name)
		elif (
			qi.reference_type != "Stock Entry"
			or qi.reference_name != doc.name
			or qi.item_code != row.item_code
		):
			blocked = True
			message = _("The inspection for {0} does not match this receipt and item.").format(row.item_name)
		elif (
			qi.docstatus != 1
			and frappe.db.get_single_value("Stock Settings", "action_if_quality_inspection_is_not_submitted")
			== "Stop"
		):
			blocked = True
			message = _("Submit the Quality Inspection for {0} before submitting this receipt.").format(
				row.item_name
			)
		elif (
			qi.status != "Accepted"
			and frappe.db.get_single_value("Stock Settings", "action_if_quality_inspection_is_rejected")
			== "Stop"
		):
			blocked = True
			message = _(
				"The Quality Inspection for {0} must be accepted before this receipt can be submitted."
			).format(row.item_name)
	can_read = bool(qi and frappe.has_permission("Quality Inspection", "read", doc=qi.name))
	if not qi and frappe.has_permission("Quality Inspection", "read"):
		existing = frappe.get_list(
			"Quality Inspection",
			filters={
				"reference_type": "Stock Entry",
				"reference_name": doc.name,
				"child_row_reference": row.name,
				"item_code": row.item_code,
				"docstatus": ["<", 2],
			},
			fields=["name", "docstatus", "status"],
			order_by="modified desc",
			limit_page_length=1,
		)
		if existing:
			qi = existing[0]
			can_read = True
	defaults = {
		"reference_type": "Stock Entry",
		"reference_name": doc.name,
		"child_row_reference": row.name,
		"item_code": row.item_code,
		"company": doc.company,
		"inspection_type": "Incoming" if doc.purpose in QI_INCOMING_PURPOSES else "Outgoing",
		"quality_inspection_template": frappe.get_cached_value(
			"Item", row.item_code, "quality_inspection_template"
		)
		or "",
	}
	if row.get("batch_no"):
		defaults["batch_no"] = row.batch_no
	can_create = (
		required
		and doc.docstatus == 0
		and not qi
		and bool(
			frappe.has_permission("Quality Inspection", "create")
			and frappe.has_permission("Quality Inspection", "read")
		)
	)
	return {
		"required": required,
		"blocked": blocked,
		"message": message,
		"name": qi.name if can_read else None,
		"status": ("Submitted" if qi.docstatus == 1 else "Cancelled" if qi.docstatus == 2 else "Draft")
		+ (f" · {qi.status}" if qi.get("status") else "")
		if can_read
		else "Inspection linked (restricted)"
		if qi
		else "Required"
		if required
		else "Not required",
		"view_url": f"/desk/quality-inspection/{quote(qi.name, safe='')}" if can_read else None,
		"create_url": "/desk/quality-inspection/new?"
		+ urlencode(
			{
				**defaults,
				"vunapos_profile": profile.name,
				"vunapos_source": source.name,
				"vunapos_receipt": doc.name,
				"vunapos_row": row.name,
			}
		)
		if can_create
		else None,
		"defaults": defaults,
	}


def inspection_context(pos_profile, stock_entry, receipt, row_name):
	profile, source, doc, _pending = _receipt_context(pos_profile, stock_entry, receipt)
	row = next(
		(part for part in doc.items if part.name == row_name and part.t_warehouse == profile.warehouse), None
	)
	if not row or doc.docstatus != 0:
		fail("Choose an item on this draft receipt.")
	state = _inspection_for_row(profile, source, doc, row)
	if state["view_url"]:
		return {"name": state["name"], "url": state["view_url"]}
	if not state["create_url"]:
		frappe.throw(
			_("You cannot create a Quality Inspection for this receipt item."), frappe.PermissionError
		)
	return {"defaults": state["defaults"]}


def _receipt_state(profile, source, doc, pending):
	blocker = _receipt_blocker(profile, source, doc, pending) if doc.docstatus == 0 else None
	inspections = {
		row.name: _inspection_for_row(profile, source, doc, row)
		for row in doc.items
		if row.t_warehouse == profile.warehouse
	}
	inspection_messages = [
		value["message"] for value in inspections.values() if value["blocked"] and value["message"]
	]
	workflow = None
	if get_workflow_name("Stock Entry"):
		definition = get_workflow("Stock Entry")
		workflow = {
			"name": definition.name,
			"state": doc.get(definition.workflow_state_field),
			"actions": [
				{"action": row.action, "next_state": row.next_state}
				for row in get_transitions(doc, workflow=definition)
				if has_approval_access(frappe.session.user, doc, row)
				and not (
					inspection_messages
					and any(
						state.state == row.next_state and cint(state.doc_status) == 1
						for state in definition.get("states") or []
					)
				)
			]
			if doc.docstatus == 0 and not blocker
			else [],
		}
	return {
		"name": doc.name,
		"source": source.name,
		"posting_date": doc.posting_date,
		"docstatus": doc.docstatus,
		"company": doc.company,
		"owner": doc.owner,
		"warehouse": profile.warehouse,
		"workflow": workflow,
		"can_submit": doc.docstatus == 0
		and not blocker
		and not workflow
		and not inspection_messages
		and bool(frappe.has_permission("Stock Entry", "submit", doc=doc)),
		"blocking_reason": blocker,
		"inspection_messages": inspection_messages if doc.docstatus == 0 else [],
		"review": fingerprint([str(doc.modified), pending]),
		"items": [
			{
				"name": part.name,
				"item_code": part.item_code,
				"item_name": part.item_name,
				"qty": part.qty,
				"uom": part.uom,
				"stock_qty": flt(part.qty) * flt(part.conversion_factor),
				"stock_uom": part.stock_uom,
				"source_warehouse": part.s_warehouse,
				"warehouse": part.t_warehouse,
				"batch_no": part.get("batch_no"),
				"serial_no": part.get("serial_no"),
				"inspection": {
					key: value for key, value in inspections[part.name].items() if key != "defaults"
				},
			}
			for part in doc.items
			if part.t_warehouse == profile.warehouse
		],
		"has_other_warehouses": any(part.t_warehouse != profile.warehouse for part in doc.items),
	}


def receipt_details(pos_profile, stock_entry, receipt):
	return _receipt_state(*_receipt_context(pos_profile, stock_entry, receipt))


def complete_receipt(pos_profile, stock_entry, receipt, review, action=None):
	profile, source, doc, pending = _receipt_context(pos_profile, stock_entry, receipt, lock=True)
	if doc.docstatus == 1:
		return _stock_result(doc)
	state = _receipt_state(profile, source, doc, pending)
	if not review or review != state["review"]:
		fail("This receipt or its remaining stock changed. Refresh and review it before continuing.")
	if state["blocking_reason"]:
		frappe.throw(state["blocking_reason"])
	if state["workflow"]:
		if not action or not str(action).strip():
			fail("Choose a permitted workflow action for this receipt.")
		apply_workflow(doc, str(action).strip())
	else:
		if action:
			fail("This receipt no longer has an active workflow. Refresh before submitting.")
		doc.check_permission("submit")
		doc.submit()
	completed = frappe.get_doc("Stock Entry", doc.name)
	if completed.docstatus == 1 and not completed.get("vunapos_received_in_pos"):
		# A native Desk draft completed here is now a POS-tracked receipt too.
		# Set only origin metadata after the native submit/workflow action succeeds.
		completed.db_set("vunapos_received_in_pos", 1, update_modified=False)
	return _stock_result(completed)


def _remaining_tracking(row):
	if not (row.get("serial_and_batch_bundle") or row.get("batch_no") or row.get("serial_no")):
		return []
	entries = {}

	def collect(bundle, batch, serial, qty, sign):
		if bundle:
			parts = frappe.get_all(
				"Serial and Batch Entry", filters={"parent": bundle}, fields=["batch_no", "serial_no", "qty"]
			)
		elif serial:
			parts = [
				frappe._dict(batch_no=batch, serial_no=value, qty=1)
				for value in str(serial).splitlines()
				if value.strip()
			]
		elif batch:
			parts = [frappe._dict(batch_no=batch, serial_no=None, qty=qty)]
		else:
			parts = []
		for part in parts:
			key = (part.batch_no or None, part.serial_no or None)
			entries[key] = entries.get(key, 0) + sign * abs(flt(part.qty))

	collect(
		row.get("serial_and_batch_bundle"), row.get("batch_no"), row.get("serial_no"), row.transfer_qty, 1
	)
	for receipt in frappe.get_all(
		"Stock Entry Detail",
		filters={"ste_detail": row.name, "docstatus": 1},
		fields=["serial_and_batch_bundle", "batch_no", "serial_no", "transfer_qty"],
	):
		collect(
			receipt.serial_and_batch_bundle, receipt.batch_no, receipt.serial_no, receipt.transfer_qty, -1
		)
	return [
		{"batch_no": key[0], "serial_no": key[1], "qty": qty}
		for key, qty in entries.items()
		if qty > 0.000000001
	]


def _partial_tracking_restricted(row):
	tracking = _remaining_tracking(row)
	return bool(
		any(part["serial_no"] for part in tracking) or len({part["batch_no"] for part in tracking}) > 1
	)


def _selected_tracking(tracking, selection, stock_qty, precision):
	if not isinstance(selection, list) or len(selection) > len(tracking):
		fail("Choose valid batches or serial numbers from this transfer.")
	available = {(row["batch_no"], row["serial_no"]): row["qty"] for row in tracking}
	chosen = {}
	for row in selection:
		if not isinstance(row, dict):
			fail("Choose valid batches or serial numbers from this transfer.")
		batch, serial = row.get("batch_no") or None, row.get("serial_no") or None
		if (batch is not None and not isinstance(batch, str)) or (
			serial is not None and not isinstance(serial, str)
		):
			fail("Choose valid batches or serial numbers from this transfer.")
		key = (batch, serial)
		try:
			qty = float(row.get("qty"))
		except (TypeError, ValueError):
			fail("Enter a positive quantity for each selected batch or serial number.")
		if (
			isinstance(row.get("qty"), bool)
			or not math.isfinite(qty)
			or qty <= 0
			or qty != flt(qty, precision)
			or key not in available
			or key in chosen
			or flt(qty, precision) > flt(available[key], precision)
			or (serial and qty != 1)
		):
			fail(
				"Selected batches or serial numbers exceed this transfer's remaining quantities or are invalid."
			)
		chosen[key] = qty
	if flt(sum(chosen.values()), precision) != flt(stock_qty, precision):
		fail("Selected batch or serial quantities must match the accepted quantity in stock UOM.")
	return [{"batch_no": batch, "serial_no": serial, "qty": qty} for (batch, serial), qty in chosen.items()]


def _apply_receipt_tracking(part, original, stock_qty, selection=None):
	tracking = _remaining_tracking(original)
	if not tracking:
		if selection:
			fail("This transfer row has no remaining batch or serial allocations.")
		return
	available = sum(value["qty"] for value in tracking)
	if flt(available, part.precision("transfer_qty")) < flt(stock_qty, part.precision("transfer_qty")):
		fail("The source batch or serial quantities have changed. Refresh this transfer before receiving.")
	restricted = (
		any(value["serial_no"] for value in tracking) or len({value["batch_no"] for value in tracking}) > 1
	)
	if selection is not None:
		tracking = _selected_tracking(tracking, selection, stock_qty, part.precision("transfer_qty"))
	elif restricted and flt(stock_qty, part.precision("transfer_qty")) != flt(
		available, part.precision("transfer_qty")
	):
		frappe.throw(
			_("Partial receipt of {0} requires choosing its exact batches or serial numbers.").format(
				original.item_name
			)
		)
	elif not restricted:
		tracking = [{**tracking[0], "qty": stock_qty}]
	if part.serial_and_batch_bundle:
		bundle = frappe.get_doc("Serial and Batch Bundle", part.serial_and_batch_bundle)
		if bundle.docstatus != 0 or bundle.name == original.serial_and_batch_bundle or bundle.voucher_no:
			fail("The receipt tracking bundle needs review in Desk.")
		base = {(row.batch_no or None, row.serial_no or None): row.as_dict() for row in bundle.entries}
		bundle.set(
			"entries",
			[
				{
					**base[(value["batch_no"], value["serial_no"])],
					"name": None,
					"qty": -value["qty"],
					"is_outward": 1,
				}
				for value in tracking
			],
		)
		bundle.set_incoming_rate()
		bundle.calculate_qty_and_amount()
		bundle.save()
	else:
		part.serial_no = "\n".join(value["serial_no"] for value in tracking if value["serial_no"]) or None
		part.batch_no = (
			tracking[0]["batch_no"] if len({value["batch_no"] for value in tracking}) == 1 else None
		)


def _accepted_quantities(value):
	if value is None:
		return None
	value = frappe.parse_json(value) if isinstance(value, str) else value
	if not isinstance(value, list) or not value or len(value) > 1000:
		fail("Enter accepted quantities for the transfer items.")
	quantities = {}
	for part in value:
		if (
			not isinstance(part, dict)
			or not isinstance(part.get("source_row"), str)
			or isinstance(part.get("qty"), bool)
		):
			fail("Enter valid accepted quantities.")
		try:
			qty = float(part.get("qty"))
		except (TypeError, ValueError):
			fail("Enter valid accepted quantities.")
		if not math.isfinite(qty) or qty < 0 or part["source_row"] in quantities:
			fail("Accepted quantities must be non-negative, finite, and listed only once per row.")
		uom = part.get("uom")
		if uom is not None and not isinstance(uom, str):
			fail("Choose a valid receipt UOM.")
		allocation = part.get("allocations")
		if allocation is not None and (not isinstance(allocation, list) or len(allocation) > 10000):
			fail("Choose valid batch or serial allocations.")
		if qty == 0 and allocation:
			fail("An item with zero accepted quantity cannot have batch or serial allocations.")
		quantities[part["source_row"]] = {"qty": qty, "uom": uom}
		if allocation is not None:
			quantities[part["source_row"]]["allocations"] = allocation
	if not any(value["qty"] for value in quantities.values()):
		fail("Accept a quantity greater than zero for at least one item.")
	return quantities


def end_transit(pos_profile, stock_entry, review, quantities=None, request_key=None):
	from erpnext.stock.doctype.stock_entry.stock_entry import make_stock_in_entry

	profile = profile_context(pos_profile, "vunapos_allow_end_transit")
	require_create("Stock Entry")
	source = frappe.get_doc("Stock Entry", stock_entry, for_update=True)
	source.check_permission("read")
	accepted = _accepted_quantities(quantities)
	stamp = fingerprint([review, accepted])
	if request_key is not None and (
		not isinstance(request_key, str) or not request_key.strip() or len(request_key) > 140
	):
		fail("A valid receipt retry key is required.")
	key = fingerprint([frappe.session.user, profile.name, stock_entry, request_key or stamp])
	existing = frappe.db.get_value(
		"Stock Entry",
		{"vunapos_stock_receipt_key": key},
		["name", "vunapos_stock_receipt_fingerprint"],
		as_dict=True,
		for_update=True,
	)
	if existing:
		doc = frappe.get_doc("Stock Entry", existing.name, for_update=True)
		doc.check_permission("read")
		if existing.vunapos_stock_receipt_fingerprint != stamp:
			fail(
				"This receipt was already saved with different quantities. Refresh before creating another receipt."
			)
		if doc.docstatus == 2:
			fail("This receipt was cancelled. Reopen the receiving form to start a new receipt.")
		return _stock_result(doc)
	rows = _eligible_rows(source, profile)
	# Reuse a pending workflow draft, or the receipt when an unknown response is retried.
	receipt, detail = frappe.qb.DocType("Stock Entry"), frappe.qb.DocType("Stock Entry Detail")
	previous = (
		frappe.qb.from_(receipt)
		.join(detail)
		.on(detail.parent == receipt.name)
		.select(receipt.name, receipt.docstatus)
		.distinct()
		.where(
			(receipt.outgoing_stock_entry == source.name)
			& (receipt.docstatus < 2)
			& (detail.t_warehouse == profile.warehouse)
		)
		.orderby(receipt.creation, order=Order.desc)
		.for_update()
		.run(as_dict=True)
	)
	# A mixed-warehouse draft remains a Desk operation. Do not adopt it,
	# mutate it, or let it prevent a separate receipt for this warehouse.
	mixed = _mixed_receipts([value.name for value in previous], profile.warehouse)
	previous = [value for value in previous if value.docstatus != 0 or value.name not in mixed]
	drafts = [value for value in previous if value.docstatus == 0]
	if rows and len(drafts) > 1:
		fail(
			"Multiple draft receipts exist. Open and review the receipt you want to complete instead of creating another."
		)
	if drafts:
		previous = drafts
	if previous and (not rows or previous[0].docstatus == 0):
		doc = frappe.get_doc("Stock Entry", previous[0].name, for_update=True)
		doc.check_permission("read")
		return {
			"name": doc.name,
			"doctype": doc.doctype,
			"docstatus": doc.docstatus,
			"warehouse": profile.warehouse,
		}
	if not rows:
		fail("No outstanding transit rows target this POS Profile warehouse.")
	if not review or review != fingerprint(rows):
		fail("This transfer changed. Refresh its quantities before receiving it.")
	by_row = {row["source_row"]: row for row in rows}
	if accepted is not None and any(name not in by_row for name in accepted):
		fail("Accepted quantities include a row that is no longer available for this warehouse.")
	wanted = {
		row["source_row"]: accepted.get(row["source_row"], {"qty": 0})
		if accepted is not None
		else {"qty": row["stock_qty"] / flt(row["conversion_factor"]), "uom": row["uom"]}
		for row in rows
	}
	selected_rows = [row for row in rows if wanted[row["source_row"]]["qty"] > 0]
	selected = frappe.flags.get("selected_children")
	try:
		frappe.flags.selected_children = {"items": [row["source_row"] for row in selected_rows]}
		doc = make_stock_in_entry(source.name)
	finally:
		frappe.flags.selected_children = selected
	if len(doc.items) != len(selected_rows):
		fail("This transfer changed. Refresh its quantities before receiving it.")
	for part in doc.items:
		current = by_row.get(part.ste_detail)
		if (
			not current
			or part.t_warehouse != profile.warehouse
			or flt(flt(part.qty) * flt(part.conversion_factor), part.precision("transfer_qty"))
			!= flt(current["stock_qty"], part.precision("transfer_qty"))
		):
			fail("This transfer changed. Refresh its quantities before receiving it.")
		choice = wanted[part.ste_detail]
		qty = choice["qty"]
		uom = choice.get("uom") or part.uom
		if uom not in (part.uom, part.stock_uom):
			fail("Choose the transfer UOM or stock UOM for accepted quantities.")
		if uom == part.stock_uom:
			part.uom = part.stock_uom
			part.conversion_factor = 1
		stock_qty = flt(qty * flt(part.conversion_factor), part.precision("transfer_qty"))
		if (
			flt(qty, part.precision("qty")) != qty
			or stock_qty <= 0
			or stock_qty > flt(current["stock_qty"], part.precision("transfer_qty"))
		):
			frappe.throw(
				_("Accepted quantity for {0} exceeds the remaining stock or the supported precision.").format(
					part.item_name
				)
			)
		for uom, value in ((part.uom, qty), (part.stock_uom, stock_qty)):
			if frappe.get_cached_value("UOM", uom, "must_be_whole_number") and value != math.floor(value):
				frappe.throw(
					_("Accepted quantity for {0} must be a whole number in {1}.").format(part.item_name, uom)
				)
		part.qty = qty
		part.transfer_qty = stock_qty
		original = next(row for row in source.items if row.name == part.ste_detail)
		_apply_receipt_tracking(part, original, stock_qty, choice.get("allocations"))
	doc.to_warehouse = profile.warehouse
	doc.vunapos_created_in_pos = 1
	doc.vunapos_stock_receipt_key = key
	doc.vunapos_stock_receipt_fingerprint = stamp
	return _save(doc)
