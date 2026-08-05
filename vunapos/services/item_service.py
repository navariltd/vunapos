import frappe
from erpnext.accounts.doctype.pricing_rule.pricing_rule import apply_pricing_rule
from erpnext.accounts.utils import get_currency_precision
from erpnext.stock.doctype.stock_reservation_entry.stock_reservation_entry import (
	get_sre_reserved_qty_for_item_and_warehouse,
)
from erpnext.stock.get_item_details import get_item_details
from erpnext.stock.utils import get_stock_balance
from frappe import _
from frappe.utils import cint, flt, today
from pypika import Order

from vunapos.dto.item import item_to_dict
from vunapos.services.price_list_service import get_default_price_list, resolve_price_list
from vunapos.services.profile_service import resolve_pos_profile
from vunapos.utils.permissions import require_read


def _get_barcode(item_code):
	return frappe.db.get_value("Item Barcode", {"parent": item_code}, "barcode", order_by="idx asc")


def _get_item_code_from_barcode(barcode):
	return frappe.db.get_value("Item Barcode", {"barcode": barcode}, "parent")


def _get_actual_qty(item_code, warehouse):
	if not warehouse:
		return None
	stock_balance = flt(get_stock_balance(item_code, warehouse))
	reserved_stock = flt(get_sre_reserved_qty_for_item_and_warehouse(item_code, warehouse))
	return max(stock_balance - reserved_stock, 0)


def _get_rate(item_code, profile, price_list=None):
	price_list = price_list or get_priority_price_list(customer=profile.customer, pos_profile=profile)
	ctx = frappe._dict(
		{
			"doctype": "Sales Invoice",
			"item_code": item_code,
			"company": profile.company,
			"customer": profile.customer,
			"selling_price_list": price_list,
			"price_list": price_list,
			"currency": profile.currency,
			"conversion_rate": 1,
			"plc_conversion_rate": 1,
			"warehouse": profile.warehouse,
			"qty": 1,
			"ignore_pricing_rule": cint(profile.get("ignore_pricing_rule")),
		}
	)
	details = get_item_details(ctx)
	return flt(details.get("price_list_rate") or details.get("rate") or 0)


def _to_item_payload(item_code, profile, barcode=None, price_list=None):
	require_read("Item", item_code)
	item = frappe.get_cached_doc("Item", item_code)
	price_list = price_list or get_priority_price_list(customer=profile.customer, pos_profile=profile)
	uom_rates = _get_uom_rate_map([item_code], price_list, profile.customer)
	uoms = []
	for row in item.get("uoms", []):
		uoms.append(
			{
				"uom": row.uom,
				"conversion_factor": row.conversion_factor,
				"rate": uom_rates.get(item_code, {}).get(row.uom),
			}
		)
	item_tax_template = next(
		(row.item_tax_template for row in item.get("taxes", []) if row.item_tax_template), None
	)
	item_tax_summary = _get_item_tax_summary_map(
		[item_tax_template] if item_tax_template else [],
		prices_include_tax=profile.get("vunapos_item_prices_include_tax"),
		profile_tax_inclusivity=_get_profile_tax_inclusivity(profile),
	)
	rate = _get_rate(item.item_code, profile, price_list)
	bundle = _get_product_bundle_map([item.item_code], profile.warehouse).get(item.item_code, {})
	variant_count = _get_variant_count_map([item.item_code]).get(item.item_code, 0)
	actual_qty = _get_actual_qty(item.item_code, profile.warehouse)
	if bundle.get("available_qty") is not None:
		actual_qty = bundle["available_qty"]
	return item_to_dict(
		item,
		rate=rate,
		actual_qty=actual_qty,
		barcode=barcode or _get_barcode(item.item_code),
		item_tax_template=item_tax_template,
		item_tax=_with_item_tax_prices(item_tax_summary.get(item_tax_template), rate),
		uoms=uoms,
		is_product_bundle=bool(bundle),
		bundle_items=bundle.get("items", []),
		variant_count=variant_count,
	)


def _get_first_barcode_map(item_codes):
	if not item_codes:
		return {}

	rows = frappe.get_all(
		"Item Barcode",
		filters={"parent": ["in", item_codes]},
		fields=["parent", "barcode"],
		order_by="idx asc",
	)
	barcode_map = {}
	for row in rows:
		if row.parent not in barcode_map:
			barcode_map[row.parent] = row.barcode
	return barcode_map


def _get_item_tax_template_map(item_codes):
	# One `Item Tax` row per item in practice (no tax_category-based multi-row
	# selection in this client's data) - first row wins, matching what
	# get_item_details() falls back to when there's nothing to disambiguate.
	if not item_codes:
		return {}

	rows = frappe.get_all(
		"Item Tax",
		filters={"parent": ["in", item_codes]},
		fields=["parent", "item_tax_template"],
		order_by="idx asc",
	)
	template_map = {}
	for row in rows:
		if row.parent not in template_map and row.item_tax_template:
			template_map[row.parent] = row.item_tax_template
	return template_map


def _get_profile_tax_inclusivity(profile):
	if not profile.get("taxes_and_charges"):
		return {}
	template = frappe.get_cached_doc("Sales Taxes and Charges Template", profile.taxes_and_charges)
	return {
		row.account_head: bool(row.get("included_in_print_rate"))
		for row in template.get("taxes", [])
		if row.account_head
	}


def _get_item_tax_summary_map(template_names, prices_include_tax=False, profile_tax_inclusivity=None):
	if not template_names:
		return {}

	rows = frappe.get_all(
		"Item Tax Template Detail",
		filters={"parent": ["in", list(set(template_names))]},
		fields=["parent", "tax_type", "tax_rate"],
		order_by="parent asc, idx asc",
	)
	by_template = {}
	profile_tax_inclusivity = profile_tax_inclusivity or {}
	for row in rows:
		summary = by_template.setdefault(
			row.parent, {"accounts": [], "tax_rate": 0.0, "inclusive_tax_rate": 0.0}
		)
		rate = flt(row.tax_rate)
		inclusive = profile_tax_inclusivity.get(row.tax_type, bool(prices_include_tax))
		summary["tax_rate"] += rate
		if inclusive:
			summary["inclusive_tax_rate"] += rate
		summary["accounts"].append(
			{"account_head": row.tax_type, "rate": rate, "included_in_print_rate": inclusive}
		)

	for template_name, summary in by_template.items():
		summary["exclusive_tax_rate"] = summary["tax_rate"] - summary["inclusive_tax_rate"]
		summary.update(
			{
				"template": template_name,
				"inclusive": bool(summary["tax_rate"] and not summary["exclusive_tax_rate"]),
			}
		)
	return by_template


def _with_item_tax_prices(summary, rate):
	if not summary:
		return None
	precision = get_currency_precision()
	listed_rate = flt(rate, precision)
	percent = flt(summary.get("tax_rate"))
	inclusive_percent = flt(summary.get("inclusive_tax_rate"))
	net_rate = listed_rate / (1 + inclusive_percent / 100) if inclusive_percent else listed_rate
	gross_rate = net_rate * (1 + percent / 100)
	return {
		**summary,
		"net_rate": flt(net_rate, precision),
		"tax_amount": flt(gross_rate - net_rate, precision),
		"gross_rate": flt(gross_rate, precision),
	}


def _get_actual_qty_map(item_codes, warehouse):
	if not item_codes or not warehouse:
		return None

	# Bin.reserved_stock does not include every reservation source in every
	# ERPNext release (notably native Stock Reservation Entries). Use the same
	# reservation-aware calculation as the item-details endpoint so catalogue
	# quantities represent sellable stock, not merely physical stock.
	return {item_code: _get_actual_qty(item_code, warehouse) for item_code in item_codes}


def _get_product_bundle_map(item_codes, warehouse=None):
	"""Return active Product Bundle components and sellable bundle quantity."""
	if not item_codes:
		return {}
	bundles = frappe.get_all(
		"Product Bundle",
		filters={"new_item_code": ["in", item_codes], "disabled": 0},
		fields=["name", "new_item_code"],
	)
	if not bundles:
		return {}
	bundle_by_name = {row.name: row.new_item_code for row in bundles}
	children = frappe.get_all(
		"Product Bundle Item",
		filters={"parent": ["in", list(bundle_by_name)]},
		fields=["parent", "item_code", "qty", "uom", "idx"],
		order_by="parent asc, idx asc",
	)
	component_codes = list({row.item_code for row in children})
	component_items = {
		row.name: row
		for row in frappe.get_all(
			"Item",
			filters={"name": ["in", component_codes]} if component_codes else {"name": ""},
			fields=["name", "item_name", "stock_uom", "is_stock_item", "has_batch_no", "has_serial_no"],
		)
	}
	stock_map = _get_actual_qty_map(component_codes, warehouse) if warehouse else {}
	result = {}
	for row in children:
		component = component_items.get(row.item_code)
		result.setdefault(bundle_by_name[row.parent], []).append(
			{
				"item_code": row.item_code,
				"item_name": component.item_name if component else row.item_code,
				"qty": flt(row.qty),
				"uom": row.uom or (component.stock_uom if component else None),
				"available_qty": flt(stock_map.get(row.item_code))
				if component and component.is_stock_item
				else None,
				"is_stock_item": bool(component.is_stock_item) if component else False,
				"has_batch_no": bool(component.has_batch_no) if component else False,
				"has_serial_no": bool(component.has_serial_no) if component else False,
			}
		)
	for bundle_code, components in result.items():
		limits = [
			flt(row["available_qty"]) / row["qty"]
			for row in components
			if row["is_stock_item"] and row["qty"] > 0
		]
		result[bundle_code] = {
			"items": components,
			"available_qty": max(0, int(min(limits))) if limits else None,
		}
	return result


def _get_variant_count_map(item_codes):
	if not item_codes:
		return {}
	rows = frappe.get_all(
		"Item",
		filters={"variant_of": ["in", item_codes], "disabled": 0, "is_sales_item": 1},
		fields=["variant_of"],
	)
	counts = {}
	for row in rows:
		counts[row.variant_of] = counts.get(row.variant_of, 0) + 1
	return counts


def _get_uom_rate_map(item_codes, price_list, customer=None):
	if not item_codes or not price_list:
		return {}

	current_date = today()
	item_price = frappe.qb.DocType("Item Price")
	blank_batch = item_price.batch_no.isnull() | (item_price.batch_no == "")
	blank_party = (item_price.customer.isnull() | (item_price.customer == "")) & (
		item_price.supplier.isnull() | (item_price.supplier == "")
	)
	party_match = (item_price.customer == customer) | blank_party if customer else blank_party
	rows = (
		frappe.qb.from_(item_price)
		.select(item_price.item_code, item_price.uom, item_price.price_list_rate)
		.where(item_price.selling == 1)
		.where(item_price.price_list == price_list)
		.where(item_price.item_code.isin(item_codes))
		.where(blank_batch)
		.where(party_match)
		.where((item_price.valid_from <= current_date) | item_price.valid_from.isnull())
		.where((item_price.valid_upto >= current_date) | item_price.valid_upto.isnull())
		.orderby(item_price.item_code)
		.orderby(item_price.customer, order=Order.desc)
		.orderby(item_price.valid_from, order=Order.desc)
		.orderby(item_price.modified, order=Order.desc)
	).run(as_dict=True)
	rate_map = {}
	for row in rows:
		item_rates = rate_map.setdefault(row.item_code, {})
		if row.uom not in item_rates:
			item_rates[row.uom] = flt(row.price_list_rate)
	return rate_map


def _to_item_payload_from_row(
	item,
	rate_map,
	actual_qty_map,
	barcode_map,
	item_tax_template_map=None,
	item_tax_summary_map=None,
	uom_map=None,
	pricing_rule_map=None,
	bundle_map=None,
	variant_count_map=None,
):
	price_list_rate = rate_map.get(item.name)
	if price_list_rate is None:
		price_list_rate = flt(item.standard_rate)
	pricing_rule = (pricing_rule_map or {}).get(item.name)
	rate = flt(pricing_rule.get("rate")) if pricing_rule else price_list_rate
	bundle = (bundle_map or {}).get(item.name, {})
	actual_qty = actual_qty_map.get(item.name, 0) if actual_qty_map is not None else None
	if bundle.get("available_qty") is not None:
		actual_qty = bundle["available_qty"]

	item_tax_template = (item_tax_template_map or {}).get(item.name)
	return item_to_dict(
		item,
		rate=rate,
		price_list_rate=price_list_rate,
		actual_qty=actual_qty,
		barcode=barcode_map.get(item.name),
		item_tax_template=item_tax_template,
		item_tax=_with_item_tax_prices((item_tax_summary_map or {}).get(item_tax_template), rate),
		uoms=(uom_map or {}).get(item.name, []),
		pricing_rule=pricing_rule,
		is_product_bundle=bool(bundle),
		bundle_items=bundle.get("items", []),
		variant_count=(variant_count_map or {}).get(item.name, 0),
	)


def _get_catalogue_pricing_rule_map(items, rate_map, profile, customer, price_list):
	if not items or profile.get("ignore_pricing_rule"):
		return {}

	pricing_items = []
	for item in items:
		price_list_rate = flt(rate_map.get(item.name, item.standard_rate))
		pricing_items.append(
			{
				"doctype": "Sales Invoice Item",
				"name": f"catalogue-{item.name}",
				"child_docname": f"catalogue-{item.name}",
				"item_code": item.name,
				"item_group": item.item_group,
				"brand": item.get("brand"),
				"qty": 1,
				"stock_qty": 1,
				"uom": item.stock_uom,
				"stock_uom": item.stock_uom,
				"parenttype": "Sales Invoice",
				"parent": "",
				"warehouse": profile.warehouse,
				"price_list_rate": price_list_rate,
				"rate": price_list_rate,
				"conversion_factor": 1,
			}
		)

	results = apply_pricing_rule(
		{
			"items": pricing_items,
			"customer": customer,
			"currency": profile.currency,
			"conversion_rate": 1,
			"price_list": price_list,
			"price_list_currency": profile.currency,
			"plc_conversion_rate": 1,
			"company": profile.company,
			"transaction_date": today(),
			"ignore_pricing_rule": cint(profile.get("ignore_pricing_rule")),
			"doctype": "Sales Invoice",
			"name": "",
			"update_stock": 1,
			"pos_profile": profile.name,
		}
	)

	precision = get_currency_precision()
	pricing_rule_map = {}
	for item, result in zip(items, results, strict=True):
		if not result.get("has_pricing_rule"):
			continue
		original_rate = flt(rate_map.get(item.name, item.standard_rate), precision)
		if result.get("price_or_product_discount") == "Product":
			free_items = [
				{
					"item_code": row.get("item_code"),
					"item_name": row.get("item_name"),
					"qty": flt(row.get("qty")),
					"uom": row.get("uom"),
				}
				for row in result.get("free_item_data") or []
			]
			if free_items:
				pricing_rule_map[item.name] = {
					"rate": original_rate,
					"discount_percentage": 0,
					"pricing_rules": frappe.parse_json(result.get("pricing_rules") or "[]"),
					"preview_qty": 1,
					"kind": "product",
					"free_items": free_items,
				}
			continue
		if result.get("price_or_product_discount") != "Price":
			continue
		rule_rate = flt(result.get("price_list_rate") or original_rate, precision)
		margin = flt(result.get("margin_rate_or_amount"))
		if result.get("margin_type") == "Percentage":
			rate_with_margin = rule_rate * (1 + margin / 100)
		elif result.get("margin_type") == "Amount":
			rate_with_margin = rule_rate + margin
		else:
			rate_with_margin = rule_rate
		discount_amount = flt(result.get("discount_amount"))
		if not discount_amount and result.get("discount_percentage"):
			discount_amount = rate_with_margin * flt(result.discount_percentage) / 100
		effective_rate = flt(rate_with_margin - discount_amount, precision)
		if effective_rate == original_rate:
			continue
		pricing_rule_map[item.name] = {
			"rate": effective_rate,
			"discount_percentage": flt(
				(original_rate - effective_rate) / original_rate * 100 if original_rate else 0,
				2,
			),
			"pricing_rules": frappe.parse_json(result.get("pricing_rules") or "[]"),
			"preview_qty": 1,
			"kind": "price",
		}
	return pricing_rule_map


def _get_uom_map(item_codes, uom_rate_map=None):
	result = {item_code: [] for item_code in item_codes}
	if not item_codes:
		return result
	for row in frappe.get_all(
		"UOM Conversion Detail",
		filters={"parenttype": "Item", "parent": ["in", item_codes]},
		fields=["parent", "uom", "conversion_factor"],
		order_by="idx asc",
	):
		row["rate"] = (uom_rate_map or {}).get(row.parent, {}).get(row.uom)
		result.setdefault(row.parent, []).append(row)
	return result


def get_priority_price_list(customer=None, pos_profile=None):
	return get_default_price_list(customer=customer, pos_profile=pos_profile)


def _apply_scanned_uom(payload, item_code, uom, profile, price_list):
	if not uom:
		return
	if uom == payload.get("stock_uom"):
		conversion_factor = 1
		unit_rate = flt(payload.get("rate"))
	else:
		configured = next((row for row in payload.get("uoms", []) if row.get("uom") == uom), None)
		if not configured:
			frappe.throw(_("UOM {0} is not configured for item {1}.").format(uom, item_code))
		conversion_factor = flt(configured.get("conversion_factor"))
		unit_rate = configured.get("rate")
		if unit_rate is None:
			unit_rate = flt(payload.get("rate")) * conversion_factor

	if conversion_factor <= 0:
		frappe.throw(_("UOM {0} has an invalid conversion factor for item {1}.").format(uom, item_code))

	payload["uom"] = uom
	payload["conversion_factor"] = conversion_factor
	payload["rate"] = flt(unit_rate)
	payload["price_list_rate"] = flt(unit_rate)
	if payload.get("item_tax_template"):
		tax_summary = _get_item_tax_summary_map(
			[payload["item_tax_template"]],
			prices_include_tax=profile.get("vunapos_item_prices_include_tax"),
			profile_tax_inclusivity=_get_profile_tax_inclusivity(profile),
		).get(payload["item_tax_template"])
		payload["item_tax"] = _with_item_tax_prices(tax_summary, unit_rate)


def resolve_scanned_barcode(barcode, pos_profile=None, customer=None, price_list=None):
	"""Resolve an item, batch, or active serial identifier from a scanner value."""
	value = (barcode or "").strip()
	if not value:
		frappe.throw(_("A barcode is required"))
	profile = resolve_pos_profile(pos_profile)
	customer = customer or profile.customer
	price_list = resolve_price_list(profile, customer=customer, requested_price_list=price_list)

	item_barcode_rows = frappe.get_all(
		"Item Barcode",
		filters={"barcode": value},
		fields=["parent as item_code", "uom"],
		limit_page_length=20,
	)
	serial_rows = frappe.get_all(
		"Serial No",
		filters={"name": value, "warehouse": profile.warehouse, "status": "Active"},
		fields=["item_code", "name as serial_no", "batch_no"],
		limit_page_length=20,
	)
	batch_rows = frappe.get_all(
		"Batch",
		filters={"name": value, "disabled": 0},
		fields=["item as item_code", "name as batch_no"],
		limit_page_length=20,
	)

	item_codes = {
		row.item_code
		for row in [*item_barcode_rows, *serial_rows, *batch_rows]
		if row.item_code
		and frappe.db.get_value("Item", {"name": row.item_code, "disabled": 0, "is_sales_item": 1}, "name")
	}
	if len(item_codes) != 1:
		if not item_codes:
			frappe.throw(_("No sellable item was found for barcode {0}.").format(value))
		frappe.throw(_("Barcode {0} is assigned to more than one item.").format(value))

	item_code = next(iter(item_codes))
	payload = _to_item_payload(item_code, profile, barcode=value, price_list=price_list)
	barcode_row = next((row for row in item_barcode_rows if row.item_code == item_code), None)
	if barcode_row and barcode_row.uom:
		_apply_scanned_uom(payload, item_code, barcode_row.uom, profile, price_list)
	serial = next((row for row in serial_rows if row.item_code == item_code), None)
	if serial:
		if flt(payload.get("conversion_factor") or 1) != 1:
			frappe.throw(
				_("Serial-numbered item {0} cannot be scanned using multi-unit UOM {1}.").format(
					item_code, payload.get("uom")
				)
			)
		payload["scan_tracking"] = {
			"type": "serial",
			"serial_no": serial.serial_no,
			"batch_no": serial.batch_no,
		}
		return payload

	batch = next((row for row in batch_rows if row.item_code == item_code), None)
	if batch:
		from vunapos.services.batch_service import get_item_batches

		available = next(
			(
				row
				for row in get_item_batches(item_code, warehouse=profile.warehouse).get("batches", [])
				if row["batch_no"] == batch.batch_no
			),
			None,
		)
		if not available:
			frappe.throw(_("Batch {0} is not available for sale.").format(batch.batch_no))
		payload["scan_tracking"] = {
			"type": "batch",
			"batch_no": batch.batch_no,
			"available_qty": available["available_qty"],
		}

	return payload


def search_items(query=None, pos_profile=None, customer=None, price_list=None, limit=None, since=None):
	profile = resolve_pos_profile(pos_profile)
	customer = customer or profile.customer
	price_list = resolve_price_list(profile, customer=customer, requested_price_list=price_list)
	limit = cint(limit)
	query = (query or "").strip()

	barcode_item_code = _get_item_code_from_barcode(query) if query else None
	filters = {"disabled": 0, "is_sales_item": 1}
	query_filters = dict(filters)
	if since:
		# Item.modified alone misses rate and stock changes: Item Price and Bin are
		# separate doctypes and neither bumps the parent Item's modified timestamp.
		changed_item_codes = set(frappe.get_all("Item", filters={"modified": [">", since]}, pluck="name"))
		if price_list:
			changed_item_codes.update(
				frappe.get_all(
					"Item Price",
					filters={"price_list": price_list, "modified": [">", since]},
					pluck="item_code",
				)
			)
		if profile.warehouse:
			changed_item_codes.update(
				frappe.get_all(
					"Bin",
					filters={"warehouse": profile.warehouse, "modified": [">", since]},
					pluck="item_code",
				)
			)
		query_filters["name"] = ["in", list(changed_item_codes) or [""]]
	or_filters = []
	if query:
		or_filters = [
			["Item", "item_code", "like", f"%{query}%"],
			["Item", "item_name", "like", f"%{query}%"],
		]

	get_all_args = {
		"doctype": "Item",
		"filters": query_filters,
		"or_filters": or_filters,
		"fields": [
			"name",
			"item_code",
			"item_name",
			"item_group",
			"brand",
			"description",
			"image",
			"stock_uom",
			"standard_rate",
			"is_stock_item",
			"allow_negative_stock",
			"has_batch_no",
			"has_serial_no",
			"has_variants",
			"variant_based_on",
			"variant_of",
			"modified",
		],
		"order_by": "item_name asc",
	}
	if limit > 0:
		get_all_args["limit_page_length"] = limit

	items = frappe.get_all(**get_all_args)

	item_by_code = {}
	item_codes = []
	if barcode_item_code:
		item_codes.append(barcode_item_code)
	for item in items:
		if item.name not in item_codes:
			item_codes.append(item.name)
		item_by_code[item.name] = item

	if barcode_item_code and barcode_item_code not in item_by_code:
		barcode_item = frappe.get_value(
			"Item",
			{"name": barcode_item_code, **filters},
			get_all_args["fields"],
			as_dict=True,
		)
		if barcode_item:
			item_by_code[barcode_item_code] = barcode_item

	item_codes = [item_code for item_code in item_codes if item_code in item_by_code]
	barcode_map = _get_first_barcode_map(item_codes)
	actual_qty_map = _get_actual_qty_map(item_codes, profile.warehouse)
	uom_rate_map = _get_uom_rate_map(item_codes, price_list, customer)
	rate_map = {}
	for item_code in item_codes:
		item_rates = uom_rate_map.get(item_code, {})
		stock_uom = item_by_code[item_code].stock_uom
		for price_uom in (stock_uom, None, ""):
			if price_uom in item_rates:
				rate_map[item_code] = item_rates[price_uom]
				break
	item_tax_template_map = _get_item_tax_template_map(item_codes)
	item_tax_summary_map = _get_item_tax_summary_map(
		item_tax_template_map.values(),
		prices_include_tax=profile.get("vunapos_item_prices_include_tax"),
		profile_tax_inclusivity=_get_profile_tax_inclusivity(profile),
	)
	uom_map = _get_uom_map(item_codes, uom_rate_map)
	bundle_map = _get_product_bundle_map(item_codes, profile.warehouse)
	variant_count_map = _get_variant_count_map(item_codes)
	pricing_rule_map = _get_catalogue_pricing_rule_map(
		[item_by_code[item_code] for item_code in item_codes],
		rate_map,
		profile,
		customer,
		price_list,
	)
	if barcode_item_code:
		barcode_map[barcode_item_code] = query

	return [
		_to_item_payload_from_row(
			item_by_code[item_code],
			rate_map,
			actual_qty_map,
			barcode_map,
			item_tax_template_map,
			item_tax_summary_map,
			uom_map,
			pricing_rule_map,
			bundle_map,
			variant_count_map,
		)
		for item_code in item_codes
	]


def get_item_details_for_pos(item_code, pos_profile=None, customer=None, price_list=None):
	profile = resolve_pos_profile(pos_profile)
	if customer:
		profile.customer = customer
	price_list = resolve_price_list(
		profile,
		customer=profile.customer,
		requested_price_list=price_list,
	)
	if not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} does not exist").format(item_code))
	return _to_item_payload(item_code, profile, price_list=price_list)


def get_product_bundle_details(item_code, pos_profile=None, customer=None, price_list=None):
	profile = resolve_pos_profile(pos_profile)
	price_list = resolve_price_list(
		profile, customer=customer or profile.customer, requested_price_list=price_list
	)
	bundle = _get_product_bundle_map([item_code], profile.warehouse).get(item_code)
	if not bundle:
		frappe.throw(_("Item {0} is not an active Product Bundle").format(item_code))
	return {
		"item_code": item_code,
		"price_list": price_list,
		"warehouse": profile.warehouse,
		"available_qty": bundle.get("available_qty"),
		"items": bundle.get("items", []),
	}


def get_template_variants(template_item_code, pos_profile=None, customer=None, price_list=None):
	profile = resolve_pos_profile(pos_profile)
	price_list = resolve_price_list(
		profile, customer=customer or profile.customer, requested_price_list=price_list
	)
	template = frappe.get_cached_doc("Item", template_item_code)
	if not template.has_variants:
		frappe.throw(_("Item {0} is not a variant template").format(template_item_code))
	variants = frappe.get_all(
		"Item",
		filters={"variant_of": template_item_code, "disabled": 0, "is_sales_item": 1},
		fields=["name", "item_name", "description", "item_group", "variant_based_on"],
		order_by="item_name asc",
	)
	attribute_rows = frappe.get_all(
		"Item Variant Attribute",
		filters={"parent": ["in", [row.name for row in variants]]} if variants else {"parent": ""},
		fields=["parent", "attribute", "attribute_value", "idx"],
		order_by="parent asc, idx asc",
	)
	attributes = {}
	for row in attribute_rows:
		attributes.setdefault(row.parent, []).append(
			{"attribute": row.attribute, "value": row.attribute_value}
		)
	return {
		"template": {
			"item_code": template.name,
			"item_name": template.item_name,
			"description": template.description,
			"variant_based_on": template.variant_based_on,
		},
		"variants": [
			{
				**_to_item_payload(row.name, profile, price_list=price_list),
				"attributes": attributes.get(row.name, []),
			}
			for row in variants
		],
	}
