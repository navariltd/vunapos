import frappe

from vunapos.services.checkout_field_service import get_global_checkout_fields
from vunapos.services.profile_service import get_bootstrap_data as get_bootstrap_data_service
from vunapos.services.profile_service import get_user_pos_profiles
from vunapos.services.workflow_service import apply_pos_workflow_action, get_pos_workflow_actions
from vunapos.utils.response import failure, success


@frappe.whitelist()
def get_bootstrap_data(pos_profile=None):
	try:
		return success(get_bootstrap_data_service(pos_profile=pos_profile))
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)


@frappe.whitelist()
def get_pos_profiles_for_user():
	try:
		return success(get_user_pos_profiles())
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)


@frappe.whitelist()
def search_checkout_link_options(doctype: str, fieldname: str, query: str | None = None):
	allowed = {(field["doctype"], field["fieldname"]): field for field in get_global_checkout_fields()}
	definition = allowed.get((doctype, fieldname))
	if not definition or definition.get("fieldtype") != "Link":
		return failure("Link field is not configured for VunaPOS", code="InvalidCheckoutField")
	linked_doctype = definition.get("options")
	if not linked_doctype or not frappe.has_permission(linked_doctype, "read"):
		return failure("Not permitted to search this Link field", code="PermissionError")
	text = (query or "").strip()
	meta = frappe.get_meta(linked_doctype)
	filters = {"disabled": 0} if meta.has_field("disabled") else {}
	rows = frappe.get_all(
		linked_doctype,
		filters=filters,
		or_filters=[{"name": ["like", f"%{text}%"]}] if text else None,
		fields=["name"],
		order_by="modified desc",
		limit_page_length=20,
	)
	return success([{"value": row.name, "label": row.name} for row in rows])


@frappe.whitelist(methods=["POST"])
def apply_workflow_action(
	doctype: str,
	docname: str,
	action: str,
	pos_profile: str | None = None,
):
	try:
		return success(apply_pos_workflow_action(doctype, docname, action, pos_profile))
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)


@frappe.whitelist()
def get_workflow_actions(doctype: str, docname: str, pos_profile: str | None = None):
	try:
		return success(get_pos_workflow_actions(doctype, docname, pos_profile))
	except Exception as exc:
		return failure(str(exc), code=exc.__class__.__name__)
