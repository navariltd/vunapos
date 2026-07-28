import frappe
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


def _get_rate(item_code, profile):
	price_list = get_priority_price_list(customer=profile.customer, pos_profile=profile)
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


def _to_item_payload(item_code, profile, barcode=None):
	require_read("Item", item_code)
	item = frappe.get_cached_doc("Item", item_code)
	price_list = get_priority_price_list(customer=profile.customer, pos_profile=profile)
	uom_rates = _get_uom_rate_map([item_code], price_list)
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
	return item_to_dict(
		item,
		rate=_get_rate(item.item_code, profile),
		actual_qty=_get_actual_qty(item.item_code, profile.warehouse),
		barcode=barcode or _get_barcode(item.item_code),
		item_tax_template=item_tax_template,
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


def _get_uom_rate_map(item_codes, price_list):
	if not item_codes or not price_list:
		return {}

	current_date = today()
	item_price = frappe.qb.DocType("Item Price")
	rows = (
		frappe.qb.from_(item_price)
		.select(item_price.item_code, item_price.uom, item_price.price_list_rate)
		.where(item_price.selling == 1)
		.where(item_price.price_list == price_list)
		.where(item_price.item_code.isin(item_codes))
		.where((item_price.valid_from <= current_date) | item_price.valid_from.isnull())
		.where((item_price.valid_upto >= current_date) | item_price.valid_upto.isnull())
		.orderby(item_price.item_code)
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
	item, rate_map, actual_qty_map, barcode_map, item_tax_template_map=None, uom_map=None
):
	rate = rate_map.get(item.name)
	if rate is None:
		rate = flt(item.standard_rate)
	actual_qty = actual_qty_map.get(item.name, 0) if actual_qty_map is not None else None

	return item_to_dict(
		item,
		rate=rate,
		actual_qty=actual_qty,
		barcode=barcode_map.get(item.name),
		item_tax_template=(item_tax_template_map or {}).get(item.name),
		uoms=(uom_map or {}).get(item.name, []),
	)


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
	if customer:
		customer_details = frappe.db.get_value(
			"Customer",
			customer,
			["default_price_list", "customer_group"],
			as_dict=True,
		)
		if customer_details:
			if customer_details.get("default_price_list"):
				return customer_details.default_price_list
			if customer_details.get("customer_group"):
				group_price_list = frappe.db.get_value(
					"Customer Group",
					customer_details.customer_group,
					"default_price_list",
				)
				if group_price_list:
					return group_price_list

	if pos_profile and pos_profile.get("selling_price_list"):
		return pos_profile.selling_price_list

	return frappe.db.get_single_value("Selling Settings", "selling_price_list")


def search_items(query=None, pos_profile=None, customer=None, limit=None, since=None):
	profile = resolve_pos_profile(pos_profile)
	customer = customer or profile.customer
	price_list = get_priority_price_list(customer=customer, pos_profile=profile)
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
	uom_rate_map = _get_uom_rate_map(item_codes, price_list)
	rate_map = {}
	for item_code in item_codes:
		item_rates = uom_rate_map.get(item_code, {})
		stock_uom = item_by_code[item_code].stock_uom
		for price_uom in (stock_uom, None, ""):
			if price_uom in item_rates:
				rate_map[item_code] = item_rates[price_uom]
				break
	item_tax_template_map = _get_item_tax_template_map(item_codes)
	uom_map = _get_uom_map(item_codes, uom_rate_map)
	if barcode_item_code:
		barcode_map[barcode_item_code] = query

	return [
		_to_item_payload_from_row(
			item_by_code[item_code], rate_map, actual_qty_map, barcode_map, item_tax_template_map, uom_map
		)
		for item_code in item_codes
	]


def get_item_details_for_pos(item_code, pos_profile=None, customer=None):
	profile = resolve_pos_profile(pos_profile)
	if customer:
		profile.customer = customer
	if not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} does not exist").format(item_code))
	return _to_item_payload(item_code, profile)
