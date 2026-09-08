import frappe
from frappe import _
from frappe.utils import cstr

SUPPORTED_TRANSACTION_DOCTYPES = {"Sales Invoice", "POS Invoice", "Sales Order"}
DISALLOWED_FIELD_TYPES = {"Section Break", "Column Break", "Tab Break", "HTML", "Button"}


def _field_definition(row, doctype, fieldname, required=None, label=None):
	meta = frappe.get_meta(doctype)
	field = meta.get_field(fieldname)
	if not field or field.fieldtype in DISALLOWED_FIELD_TYPES or field.read_only:
		return None
	return {
		"doctype": doctype,
		"fieldname": fieldname,
		"label": label or row.get("label") or field.label or fieldname,
		"fieldtype": field.fieldtype,
		"options": field.options,
		"required": bool(row.get("required") if required is None else required),
		"placeholder": row.get("placeholder"),
		"help_text": row.get("help_text") or field.description,
		"order": int(row.get("order") or 0),
	}


def get_global_checkout_fields(profile=None):
	"""Return validated, safe checkout field definitions from POS Settings."""
	settings = frappe.get_single("POS Settings")
	result = []
	for row in settings.get("vunapos_checkout_fields", []):
		if not row.get("enabled"):
			continue
		doctype = row.get("target_doctype")
		fieldname = (row.get("fieldname") or "").strip()
		if doctype not in SUPPORTED_TRANSACTION_DOCTYPES or not fieldname:
			continue
		meta = frappe.get_meta(doctype)
		field = meta.get_field(fieldname)
		if not field or field.fieldtype in DISALLOWED_FIELD_TYPES or field.read_only:
			continue
		definition = _field_definition(row, doctype, fieldname)
		if definition:
			result.append(definition)
	if profile:
		overrides = {
			(row.get("target_doctype"), (row.get("fieldname") or "").strip()): row
			for row in profile.get("vunapos_checkout_fields", [])
		}
		for index, definition in enumerate(result):
			row = overrides.get((definition["doctype"], definition["fieldname"]))
			if not row:
				continue
			if not row.get("enabled"):
				result[index] = None
				continue
			result[index] = {
				**definition,
				"label": row.get("label") or definition["label"],
				"required": bool(row.get("required")),
				"order": int(row.get("order") or definition["order"] or 0),
			}
		result = [definition for definition in result if definition]
	return sorted(result, key=lambda value: (value["doctype"], value["order"], value["label"]))


def validate_global_checkout_fields(doc, method=None):
	for row in doc.get("vunapos_checkout_fields", []):
		doctype = row.get("target_doctype")
		fieldname = (row.get("fieldname") or "").strip()
		if not row.get("enabled"):
			continue
		if doctype not in SUPPORTED_TRANSACTION_DOCTYPES:
			frappe.throw(_("Checkout fields support Sales Invoice, POS Invoice, and Sales Order only."))
		field = frappe.get_meta(doctype).get_field(fieldname) if fieldname else None
		if not field:
			frappe.throw(_("Field {0} does not exist on {1}.").format(fieldname, doctype))
		if field.read_only or field.fieldtype in DISALLOWED_FIELD_TYPES:
			frappe.throw(_("Field {0} cannot be edited from VunaPOS.").format(fieldname))

	if doc.doctype == "POS Profile":
		registered = {
			(definition["doctype"], definition["fieldname"]) for definition in get_global_checkout_fields()
		}
		for row in doc.get("vunapos_checkout_fields", []):
			if not row.get("enabled"):
				continue
			doctype = row.get("target_doctype")
			fieldname = (row.get("fieldname") or "").strip()
			if (doctype, fieldname) not in registered:
				frappe.throw(
					_("Checkout field {0} must first be enabled in POS Settings.").format(
						fieldname or _("(unnamed)")
					)
				)


def apply_checkout_field_values(doc, values=None, profile=None):
	"""Apply whitelisted POS checkout values to a transaction document."""
	if isinstance(values, str):
		values = frappe.parse_json(values or "{}")
	if not values:
		values = {}
	if not isinstance(values, dict):
		frappe.throw(_("Checkout fields must be provided as an object."))
	definitions = {
		(row["doctype"], row["fieldname"]): row
		for row in get_global_checkout_fields(profile)
		if row["doctype"] == doc.doctype
	}
	unknown = sorted(set(values) - {fieldname for _, fieldname in definitions})
	if unknown:
		frappe.throw(_("Unsupported VunaPOS checkout field: {0}").format(", ".join(unknown)))
	for fieldname, value in values.items():
		definition = definitions[(doc.doctype, fieldname)]
		field = frappe.get_meta(doc.doctype).get_field(fieldname)
		if field.fieldtype in ("Data", "Small Text", "Long Text"):
			value = cstr(value).strip()
		if definition["required"] and value in (None, ""):
			frappe.throw(_("{0} is required before checkout.").format(definition["label"]))
		doc.set(fieldname, value)
	for definition in definitions.values():
		if definition["required"] and not doc.get(definition["fieldname"]):
			frappe.throw(_("{0} is required before checkout.").format(definition["label"]))
	return doc
