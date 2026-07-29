import frappe


def _value(doc, fieldname, default=None):
	return getattr(doc, fieldname, default) if hasattr(doc, fieldname) else doc.get(fieldname, default)


def _date_value(doc, fieldname):
	value = _value(doc, fieldname)
	return str(value) if value else None


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


def _serial_allocations(row):
	if getattr(row, "_serial_allocations", None):
		return row._serial_allocations
	if not row.get("serial_and_batch_bundle"):
		return []
	try:
		bundle = frappe.get_doc("Serial and Batch Bundle", row.serial_and_batch_bundle)
	except frappe.DoesNotExistError:
		return []
	return [
		{"serial_no": entry.serial_no, "batch_no": entry.get("batch_no")}
		for entry in bundle.get("entries", [])
		if entry.get("serial_no")
	]


def invoice_to_dict(doc):
	item_tracking = {
		row.item_code: frappe.get_cached_value(
			"Item",
			row.item_code,
			["is_stock_item", "allow_negative_stock", "has_batch_no", "has_serial_no"],
			as_dict=True,
		)
		for row in doc.get("items", [])
	}
	uom_map = {
		row.item_code: [
			{"uom": frappe.get_cached_value("Item", row.item_code, "stock_uom"), "conversion_factor": 1.0},
			*[
				{"uom": uom.uom, "conversion_factor": uom.conversion_factor}
				for uom in frappe.get_cached_doc("Item", row.item_code).get("uoms", [])
			],
		]
		for row in doc.get("items", [])
	}
	return {
		"doctype": doc.doctype,
		"name": doc.name,
		"docstatus": doc.docstatus,
		"modified": _value(doc, "modified"),
		"is_held": bool(_value(doc, "vunapos_held", 0)),
		"is_credit_sale": bool(_value(doc, "vunapos_credit_sale", 0)),
		"customer": _value(doc, "customer"),
		"customer_name": _value(doc, "customer_name"),
		"posting_date": _value(doc, "posting_date"),
		"due_date": _date_value(doc, "due_date"),
		"items": [
			{
				"row_name": row.name,
				"item_code": row.item_code,
				"item_name": row.item_name,
				"description": row.description,
				"qty": row.qty,
				"uom": row.uom,
				"stock_uom": row.get("stock_uom"),
				"conversion_factor": row.get("conversion_factor"),
				"uoms": uom_map.get(row.item_code, []),
				"rate": row.rate,
				"price_list_rate": row.get("price_list_rate"),
				"discount_percentage": row.get("discount_percentage"),
				"discount_amount": row.get("discount_amount"),
				"amount": row.amount,
				"warehouse": row.get("warehouse"),
				"actual_qty": row.get("actual_qty"),
				"is_stock_item": (item_tracking.get(row.item_code) or {}).get("is_stock_item"),
				"allow_negative_stock": (item_tracking.get(row.item_code) or {}).get("allow_negative_stock"),
				"has_batch_no": (item_tracking.get(row.item_code) or {}).get("has_batch_no"),
				"has_serial_no": (item_tracking.get(row.item_code) or {}).get("has_serial_no"),
				"batch_no": row.get("batch_no"),
				"serial_and_batch_bundle": row.get("serial_and_batch_bundle"),
				"batch_allocations": _batch_allocations(row),
				"serial_allocations": _serial_allocations(row),
				"item_tax_template": row.get("item_tax_template"),
				"pricing_rules": row.get("pricing_rules"),
				"item_note": row.get("vunapos_item_note"),
				"pricing_override_audit": row.get("vunapos_pricing_override"),
				"pricing_override_by": row.get("vunapos_pricing_override_by"),
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
