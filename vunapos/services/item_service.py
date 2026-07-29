import frappe
from erpnext.accounts.doctype.pricing_rule.pricing_rule import apply_pricing_rule
from erpnext.accounts.utils import get_currency_precision
from erpnext.stock.doctype.stock_reservation_entry.stock_reservation_entry import (
	get_sre_reserved_qty_for_item_and_warehouse,
)
from erpnext.stock.get_item_details import get_item_details
from erpnext.stock.utils import get_stock_balance
from frappe import _
from frappe.query_builder.functions import Sum
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
	return item_to_dict(
		item,
		rate=rate,
		actual_qty=_get_actual_qty(item.item_code, profile.warehouse),
		barcode=barcode or _get_barcode(item.item_code),
		item_tax_template=item_tax_template,
		item_tax=_with_item_tax_prices(item_tax_summary.get(item_tax_template), rate),
		uoms=uoms,
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

	bin_table = frappe.qb.DocType("Bin")
	rows = (
		frappe.qb.from_(bin_table)
		.select(
			bin_table.item_code,
			Sum(bin_table.actual_qty - bin_table.reserved_stock).as_("available_qty"),
		)
		.where(bin_table.warehouse == warehouse)
		.where(bin_table.item_code.isin(item_codes))
		.groupby(bin_table.item_code)
	).run(as_dict=True)
	return {row.item_code: max(flt(row.available_qty), 0) for row in rows}


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
):
	price_list_rate = rate_map.get(item.name)
	if price_list_rate is None:
		price_list_rate = flt(item.standard_rate)
	pricing_rule = (pricing_rule_map or {}).get(item.name)
	rate = flt(pricing_rule.get("rate")) if pricing_rule else price_list_rate
	actual_qty = actual_qty_map.get(item.name, 0) if actual_qty_map is not None else None

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
	)


def _get_catalogue_pricing_rule_map(items, rate_map, profile, customer, price_list):
	if not items:
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
			"ignore_pricing_rule": 0,
			"doctype": "Sales Invoice",
			"name": "",
			"update_stock": 1,
			"pos_profile": profile.name,
		}
	)

	precision = get_currency_precision()
	pricing_rule_map = {}
	for item, result in zip(items, results, strict=True):
		if not result.get("has_pricing_rule") or result.get("price_or_product_discount") != "Price":
			continue
		original_rate = flt(rate_map.get(item.name, item.standard_rate), precision)
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


def search_items(query=None, pos_profile=None, customer=None, price_list=None, limit=None, since=None):
	profile = resolve_pos_profile(pos_profile)
	customer = customer or profile.customer
	price_list = resolve_price_list(profile, customer=customer, requested_price_list=price_list)
	limit = cint(limit)
	query = (query or "").strip()

	barcode_item_code = _get_item_code_from_barcode(query) if query else None
	filters = {"disabled": 0, "is_sales_item": 1, "has_variants": 0}
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
