"""Receipt-row quality inspections for POS staff, using ERPNext's native controller."""

import math

import frappe
from frappe.model.workflow import (
	apply_workflow,
	get_transitions,
	get_workflow,
	get_workflow_name,
	has_approval_access,
)
from frappe.utils import cint

from vunapos.services.stock_service import _inspection_for_row, _receipt_context, fail


def _context(pos_profile, stock_entry, receipt, row_name, lock=False):
	profile, source, doc, _ = _receipt_context(pos_profile, stock_entry, receipt, lock=lock)
	row = next((r for r in doc.items if r.name == row_name and r.t_warehouse == profile.warehouse), None)
	if not row:
		fail("Choose an item on this receipt.")
	state = _inspection_for_row(profile, source, doc, row)
	# Query without permission filtering to prevent duplicates of an inspection the user cannot read.
	names = frappe.get_all(
		"Quality Inspection",
		filters={
			"reference_type": "Stock Entry",
			"reference_name": doc.name,
			"child_row_reference": row.name,
			"item_code": row.item_code,
			"docstatus": ["<", 2],
		},
		pluck="name",
	)
	if row.get("quality_inspection") and row.quality_inspection not in names:
		names.append(row.quality_inspection)
	if len(names) > 1:
		fail("Multiple inspections exist for this receipt item. Ask your quality manager to review them.")
	if names:
		inspection = frappe.get_doc("Quality Inspection", names[0], for_update=lock)
		inspection.check_permission("read")
		if (
			inspection.reference_type != "Stock Entry"
			or inspection.reference_name != doc.name
			or inspection.item_code != row.item_code
			or inspection.child_row_reference != row.name
		):
			fail("The linked inspection does not match this receipt item.")
	else:
		if not state["create_url"]:
			frappe.throw("You cannot create an inspection for this receipt item.", frappe.PermissionError)
		inspection = frappe.new_doc("Quality Inspection")
		inspection.update(state["defaults"])
		inspection.inspected_by = frappe.session.user
		inspection.get_item_specification_details()
		# The template's default Accepted statuses are not actual inspection results.
		for reading in inspection.readings:
			reading.status = ""
		inspection.status = ""
	return doc, inspection


def _state(receipt, doc):
	workflow = None
	if get_workflow_name("Quality Inspection"):
		definition = get_workflow("Quality Inspection")
		workflow = {
			"state": doc.get(definition.workflow_state_field),
			"actions": [
				{"action": r.action, "next_state": r.next_state}
				for r in get_transitions(doc, workflow=definition)
				if has_approval_access(frappe.session.user, doc, r)
			]
			if not doc.is_new() and doc.docstatus == 0 and receipt.docstatus == 0
			else [],
		}
	editable = receipt.docstatus == 0 and doc.docstatus == 0
	return {
		"name": None if doc.is_new() else doc.name,
		"modified": str(doc.modified) if not doc.is_new() else None,
		"docstatus": doc.docstatus,
		"item_name": frappe.get_cached_value("Item", doc.item_code, "item_name"),
		"template": doc.quality_inspection_template,
		"sample_size": doc.sample_size or 1,
		"remarks": doc.remarks or "",
		"status": doc.status or "Rejected",
		"manual_inspection": bool(doc.manual_inspection),
		"overall_manual": bool(doc.manual_inspection),
		"can_write": editable and bool(doc.has_permission("create" if doc.is_new() else "write")),
		"can_submit": editable and not workflow and bool(doc.has_permission("submit")),
		"can_create_parameter": bool(
			frappe.has_permission("Quality Inspection Parameter", "create")
			and frappe.has_permission("Quality Inspection Parameter", "read")
		),
		"workflow": workflow,
		"readings": [
			{
				"name": r.name if not doc.is_new() else None,
				**{
					key: r.get(key)
					for key in (
						"specification",
						"numeric",
						"manual_inspection",
						"min_value",
						"max_value",
						"value",
						"formula_based_criteria",
						"acceptance_formula",
						"reading_value",
						"status",
					)
				},
				"values": [r.get(f"reading_{i}") or "" for i in range(1, 11)],
				"status": r.status or "Rejected",
			}
			for r in doc.readings
		],
	}


def details(pos_profile, stock_entry, receipt, row_name):
	return _state(*_context(pos_profile, stock_entry, receipt, row_name))


def templates(pos_profile, stock_entry, receipt, row_name, query=None):
	receipt_doc, doc = _context(pos_profile, stock_entry, receipt, row_name)
	_require_editable(receipt_doc, doc)
	return frappe.get_list(
		"Quality Inspection Template",
		filters={"name": ["like", "%" + str(query or "")[:140] + "%"]},
		fields=["name"],
		order_by="name asc",
		limit_page_length=20,
	)


def _require_editable(receipt, doc):
	if receipt.docstatus != 0 or doc.docstatus != 0:
		fail("Only draft inspections on draft receipts can be changed.")
	doc.check_permission("create" if doc.is_new() else "write")


def _load_template(doc, template):
	if not isinstance(template, str) or not template.strip():
		fail("Select an existing Quality Inspection Template.")
	definition = frappe.get_doc("Quality Inspection Template", template)
	definition.check_permission("read")
	doc.quality_inspection_template = definition.name
	doc.get_item_specification_details()
	for reading in doc.readings:
		reading.status = ""
	doc.status = ""


def template_details(pos_profile, stock_entry, receipt, row_name, template):
	receipt_doc, doc = _context(pos_profile, stock_entry, receipt, row_name)
	_require_editable(receipt_doc, doc)
	_load_template(doc, template)
	return _state(receipt_doc, doc)


def parameters(pos_profile, stock_entry, receipt, row_name, query=None):
	receipt_doc, doc = _context(pos_profile, stock_entry, receipt, row_name)
	if receipt_doc.docstatus != 0 or doc.docstatus != 0:
		fail("Parameters can only be added to draft inspections.")
	doc.check_permission("create" if doc.is_new() else "write")
	return frappe.get_list(
		"Quality Inspection Parameter",
		filters={"name": ["like", "%" + str(query or "")[:140] + "%"]},
		fields=["name"],
		order_by="name asc",
		limit_page_length=20,
	)


def _append_parameters(doc, readings, preview=False):
	base_count = len(doc.readings)
	if not isinstance(readings, list) or not base_count <= len(readings) <= base_count + 50:
		fail("Keep the existing checks and add no more than 50 parameters at a time.")
	for original, entered in zip(doc.readings, readings[:base_count], strict=True):
		if not isinstance(entered, dict) or (
			entered.get("specification", original.specification) != original.specification
			or (entered.get("name") and entered["name"] != original.name)
		):
			fail("Existing inspection checks cannot be replaced or reordered. Reopen the inspection.")
	known = {r.specification for r in doc.readings}
	for entered in readings[base_count:]:
		if not isinstance(entered, dict) or entered.get("name"):
			fail("Add a new parameter without replacing an existing inspection check.")
		name = str(entered.get("specification") or "").strip()
		if not name or len(name) > 140:
			fail("Enter a parameter name of up to 140 characters.")
		if name in known:
			fail("This parameter is already included in the inspection.")
		if cint(entered.get("create_parameter")) and not frappe.db.exists(
			"Quality Inspection Parameter", name
		):
			parameter = frappe.get_doc({"doctype": "Quality Inspection Parameter", "parameter": name})
			if preview:
				parameter.check_permission("create")
				parameter.name = name
			else:
				parameter.insert()
		else:
			parameter = frappe.get_doc("Quality Inspection Parameter", name)
		parameter.check_permission("read")
		values = {
			"specification": parameter.name,
			"parameter_group": parameter.parameter_group,
			"manual_inspection": cint(bool(cint(entered.get("manual_inspection")))),
			"numeric": cint(bool(cint(entered.get("numeric")))),
			"status": "",
		}
		if not values["manual_inspection"]:
			if values["numeric"]:
				try:
					minimum, maximum = float(entered.get("min_value")), float(entered.get("max_value"))
				except (ValueError, TypeError):
					fail("Enter a valid minimum and maximum for the new parameter.")
				if not math.isfinite(minimum) or not math.isfinite(maximum) or minimum > maximum:
					fail("The minimum must not exceed the maximum; both must be finite numbers.")
				values.update(min_value=minimum, max_value=maximum)
			else:
				value = str(entered.get("value") or "").strip()
				if not value or len(value) > 140:
					fail("Enter an Acceptance Criteria Value of up to 140 characters for the new parameter.")
				values["value"] = value
		doc.append("readings", values)
		known.add(parameter.name)


def save(pos_profile, stock_entry, receipt, row_name, payload):
	payload = frappe.parse_json(payload) if isinstance(payload, str) else payload
	if not isinstance(payload, dict):
		fail("Enter the inspection readings before saving.")
	receipt_doc, doc = _context(pos_profile, stock_entry, receipt, row_name, lock=True)
	if receipt_doc.docstatus != 0:
		fail("This receipt is no longer a draft. Refresh before continuing.")
	if not doc.is_new() and not payload.get("name"):
		# A retried create must recover the original inspection, not create or overwrite it.
		return _state(receipt_doc, doc)
	if payload.get("name") and (
		doc.is_new() or payload["name"] != doc.name or payload.get("modified") != str(doc.modified)
	):
		fail("This inspection changed. Reopen it and review the latest readings.")
	if doc.docstatus != 0:
		fail("Only draft inspections can be changed.")
	state = _state(receipt_doc, doc)
	if payload.get("action"):
		if not state["workflow"] or payload["action"] not in [
			r["action"] for r in state["workflow"]["actions"]
		]:
			frappe.throw("You cannot perform this inspection action.", frappe.PermissionError)
		apply_workflow(doc, payload["action"])
		return _state(receipt_doc, frappe.get_doc("Quality Inspection", doc.name))
	doc.check_permission("create" if doc.is_new() else "write")
	try:
		sample = float(payload.get("sample_size", 0))
	except (ValueError, TypeError):
		sample = 0
	if not math.isfinite(sample) or sample <= 0:
		fail("Sample size must be greater than zero.")
	doc.sample_size = sample
	doc.remarks = str(payload.get("remarks") or "")[:10000]
	_apply_checks(doc, payload)
	if cint(payload.get("submit")):
		if state["workflow"]:
			fail("Save the inspection, then choose its next workflow action.")
		doc.check_permission("submit")
	doc.insert() if doc.is_new() else doc.save()
	if cint(payload.get("submit")):
		doc.submit()
	return _state(receipt_doc, doc)


def _apply_checks(doc, payload, preview=False):
	if payload.get("template") != doc.quality_inspection_template and payload.get("template"):
		_load_template(doc, payload["template"])
	if "manual_inspection" in payload:
		doc.manual_inspection = cint(bool(cint(payload["manual_inspection"])))
	readings = payload.get("readings")
	_append_parameters(doc, readings, preview=preview)
	for reading, entered in zip(doc.readings, readings, strict=True):
		if not isinstance(entered, dict):
			fail("Enter a result for each inspection check.")
		if reading.numeric:
			values = entered.get("values")
			if reading.manual_inspection and values is None:
				values = [""] * 10
			if not isinstance(values, list) or len(values) != 10:
				fail("Enter up to ten readings for each inspection check.")
			values = [str(v).strip()[:140] if v is not None else "" for v in values]
			if not any(values) and not reading.manual_inspection and not preview:
				fail(f"Enter at least one reading for {reading.specification}.")
			for i, value in enumerate(values, 1):
				reading.set(f"reading_{i}", value)
		else:
			value = str(entered.get("reading_value") or "").strip()[:140]
			if not value and not reading.manual_inspection and not preview:
				fail(f"Enter the observed value for {reading.specification}.")
			reading.reading_value = value
		if reading.manual_inspection:
			reading.status = _result(entered.get("status") or ("Rejected" if preview else None))
	if doc.manual_inspection or not doc.readings:
		doc.status = _result(payload.get("status") or ("Rejected" if preview else None))


def preview(pos_profile, stock_entry, receipt, row_name, payload):
	"""Calculate native results without saving an inspection or parameter master."""
	payload = frappe.parse_json(payload) if isinstance(payload, str) else payload
	if not isinstance(payload, dict):
		fail("Enter the inspection readings.")
	receipt_doc, doc = _context(pos_profile, stock_entry, receipt, row_name)
	_require_editable(receipt_doc, doc)
	if not doc.is_new() and (payload.get("name") != doc.name or payload.get("modified") != str(doc.modified)):
		fail("This inspection changed. Reopen it before entering more readings.")
	_apply_checks(doc, payload, preview=True)
	doc.validate_reading_number_format()
	for reading in doc.readings:
		if reading.manual_inspection:
			continue
		has_reading = (
			any(reading.get(f"reading_{i}") for i in range(1, 11))
			if reading.numeric
			else bool(reading.reading_value)
		)
		if not has_reading:
			reading.status = "Rejected"
		elif reading.formula_based_criteria:
			doc.set_status_based_on_acceptance_formula(reading)
		else:
			doc.set_status_based_on_acceptance_values(reading)
	if doc.readings and not doc.manual_inspection:
		doc.status = "Accepted" if all(r.status == "Accepted" for r in doc.readings) else "Rejected"
	return {"status": doc.status or "Rejected", "readings": [r.status for r in doc.readings]}


def _result(value):
	if value not in ("Accepted", "Rejected"):
		fail("Choose Accepted or Rejected for the manual inspection result.")
	return value
