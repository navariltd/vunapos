import frappe


def _value(doc, fieldname, default=None):
	return getattr(doc, fieldname, default) if hasattr(doc, fieldname) else doc.get(fieldname, default)


def _batch_allocations(row):
	if getattr(row, "_batch_allocations", None):
		return row._batch_allocations
	if row.get("serial_and_batch_bundle"):
		allocations = []
		for entry in frappe.get_doc("Serial and Batch Bundle", row.get("serial_and_batch_bundle")).get(
			"entries", []
		):
			if entry.get("batch_no"):
				allocations.append(
					{
						"batch_no": entry.batch_no,
						"qty": abs(entry.qty),
						"expiry_date": frappe.db.get_value("Batch", entry.batch_no, "expiry_date"),
						"available_qty": None,
					}
				)
		return allocations
	if row.get("batch_no"):
		return [
			{
				"batch_no": row.get("batch_no"),
				"qty": row.get("qty"),
				"expiry_date": frappe.db.get_value("Batch", row.get("batch_no"), "expiry_date"),
				"available_qty": None,
			}
		]
	return []


def invoice_to_dict(doc):
	return {
		"doctype": doc.doctype,
		"name": doc.name,
		"docstatus": doc.docstatus,
		"modified": _value(doc, "modified"),
		"is_held": bool(_value(doc, "vunapos_held", 0)),
		"customer": _value(doc, "customer"),
		"customer_name": _value(doc, "customer_name"),
		"posting_date": _value(doc, "posting_date"),
		"items": [
			{
				"row_name": row.name,
				"item_code": row.item_code,
				"item_name": row.item_name,
				"description": row.description,
				"qty": row.qty,
				"uom": row.uom,
				"rate": row.rate,
				"amount": row.amount,
				"batch_no": row.get("batch_no"),
				"serial_and_batch_bundle": row.get("serial_and_batch_bundle"),
				"batch_allocations": _batch_allocations(row),
			}
			for row in doc.get("items", [])
		],
		"taxes": [
			{
				"row_name": row.name,
				"account_head": row.get("account_head"),
				"description": row.get("description"),
				"charge_type": row.get("charge_type"),
				"rate": row.get("rate"),
				"tax_amount": row.get("tax_amount"),
				"total": row.get("total"),
				"included_in_print_rate": row.get("included_in_print_rate"),
			}
			for row in doc.get("taxes", [])
		],
		"payments": [
			{
				"row_name": row.name,
				"mode_of_payment": row.get("mode_of_payment"),
				"amount": row.get("amount"),
				"default": row.get("default"),
			}
			for row in doc.get("payments", [])
		],
		"totals": {
			"net_total": _value(doc, "net_total"),
			"total_taxes_and_charges": _value(doc, "total_taxes_and_charges"),
			"grand_total": _value(doc, "grand_total"),
			"rounded_total": _value(doc, "rounded_total"),
			"paid_amount": _value(doc, "paid_amount"),
			"outstanding_amount": _value(doc, "outstanding_amount"),
			"change_amount": _value(doc, "change_amount"),
		},
	}
