import frappe
from frappe.model.workflow import apply_workflow, get_transitions, get_workflow
from frappe.utils import cstr

SUPPORTED_WORKFLOW_DOCTYPES = ("Sales Invoice", "POS Invoice", "Sales Order")


def workflow_enabled_for(profile, doctype):
	return bool(get_pos_workflow_metadata(profile)["workflows"].get(doctype))


def assert_pos_workflow_editable(doc, profile):
	"""Apply ERPNext Workflow state's allow_edit rule to POS draft editing."""
	if not workflow_enabled_for(profile, doc.doctype):
		return
	workflow = get_workflow(doc.doctype)
	state = doc.get(workflow.workflow_state_field)
	state_row = next((row for row in workflow.states if row.state == state), None)
	if not state_row:
		frappe.throw("The transaction has no valid workflow state.")
	allowed = state_row.allow_edit
	if allowed and allowed != "All" and allowed not in frappe.get_roles():
		frappe.throw(
			"You are not allowed to edit this transaction in its current workflow state.",
			frappe.PermissionError,
		)


def apply_pos_workflow_action(
	doctype: str,
	docname: str,
	action: str,
	pos_profile: str | None = None,
):
	if doctype not in SUPPORTED_WORKFLOW_DOCTYPES:
		frappe.throw("This transaction type is not supported by VunaPOS.")
	doc = frappe.get_doc(doctype, docname)
	profile = frappe.get_doc("POS Profile", pos_profile or doc.get("pos_profile"))
	if doc.get("pos_profile") and doc.get("pos_profile") != profile.name:
		frappe.throw("This transaction does not belong to the selected POS Profile.")
	if not workflow_enabled_for(profile, doctype):
		frappe.throw("Workflow actions are not enabled for this POS Profile.")
	if doc.docstatus != 0:
		frappe.throw("Only draft transactions can receive a POS workflow action.")
	if not cstr(action).strip():
		frappe.throw("A workflow action is required.")
	result = apply_workflow(doc, cstr(action).strip())
	return {
		"doctype": result.doctype,
		"name": result.name,
		"docstatus": result.docstatus,
		"workflow_state": result.get("workflow_state"),
	}


def get_pos_workflow_actions(doctype: str, docname: str, pos_profile: str | None = None):
	"""Return native permission- and condition-aware actions for a POS draft."""
	if doctype not in SUPPORTED_WORKFLOW_DOCTYPES:
		frappe.throw("This transaction type is not supported by VunaPOS.")
	doc = frappe.get_doc(doctype, docname)
	profile = frappe.get_doc("POS Profile", pos_profile or doc.get("pos_profile"))
	if doc.get("pos_profile") and doc.get("pos_profile") != profile.name:
		frappe.throw("This transaction does not belong to the selected POS Profile.")
	if not workflow_enabled_for(profile, doctype) or doc.docstatus != 0:
		return []
	return [
		{"action": transition.get("action"), "next_state": transition.get("next_state")}
		for transition in get_transitions(doc)
		if transition.get("action") and transition.get("next_state")
	]


def get_pos_workflow_metadata(profile):
	"""Return active workflow metadata for the transaction types used by this profile."""
	configured = {
		row.get("transaction_doctype")
		for row in profile.get("vunapos_workflow_configuration", [])
		if row.get("apply_workflow")
	}
	if not configured:
		return {"enabled": False, "workflows": {}}

	workflows = {}
	for doctype in SUPPORTED_WORKFLOW_DOCTYPES:
		if doctype not in configured:
			continue
		workflow = frappe.db.get_value(
			"Workflow",
			{"document_type": doctype, "is_active": 1},
			["name", "workflow_state_field"],
			as_dict=True,
			order_by="modified desc",
		)
		if not workflow:
			continue
		doc = frappe.get_cached_doc("Workflow", workflow.name)
		workflows[doctype] = {
			"name": doc.name,
			"state_field": doc.workflow_state_field or "workflow_state",
			"states": [{"state": row.state, "docstatus": row.doc_status} for row in doc.states if row.state],
			"transitions": [
				{
					"state": row.state,
					"action": row.action,
					"next_state": row.next_state,
					"allowed": row.allowed,
				}
				for row in doc.transitions
				if row.action and row.next_state
			],
		}
	return {"enabled": True, "workflows": workflows}
