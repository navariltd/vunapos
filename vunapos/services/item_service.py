import frappe
from erpnext.stock.get_item_details import get_item_details
from frappe import _
from frappe.utils import cint, flt, today

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
	return flt(
		frappe.db.sql(
			"""
			select sum(actual_qty)
			from `tabStock Ledger Entry`
			where item_code = %s
				and warehouse = %s
				and docstatus < 2
				and is_cancelled = 0
			""",
			(item_code, warehouse),
		)[0][0]
		or 0
	)


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
	return item_to_dict(
		item,
		rate=_get_rate(item.item_code, profile),
		actual_qty=_get_actual_qty(item.item_code, profile.warehouse),
		barcode=barcode or _get_barcode(item.item_code),
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


def _get_actual_qty_map(item_codes, warehouse):
	if not item_codes or not warehouse:
		return None

	placeholders = ", ".join(["%s"] * len(item_codes))
	rows = frappe.db.sql(
		f"""
		select item_code, sum(actual_qty) as actual_qty
		from `tabBin`
		where warehouse = %s
			and item_code in ({placeholders})
		group by item_code
		""",
		[warehouse, *item_codes],
		as_dict=True,
	)
	return {row.item_code: flt(row.actual_qty) for row in rows}


def _get_rate_map(item_codes, price_list):
	if not item_codes or not price_list:
		return {}

	placeholders = ", ".join(["%s"] * len(item_codes))
	current_date = today()
	rows = frappe.db.sql(
		f"""
		select item_code, price_list_rate
		from `tabItem Price`
		where selling = 1
			and price_list = %s
			and item_code in ({placeholders})
			and (valid_from <= %s or valid_from is null)
			and (valid_upto >= %s or valid_upto is null)
		order by item_code asc, valid_from desc, modified desc
		""",
		[price_list, *item_codes, current_date, current_date],
		as_dict=True,
	)
	rate_map = {}
	for row in rows:
		if row.item_code not in rate_map:
			rate_map[row.item_code] = flt(row.price_list_rate)
	return rate_map


def _to_item_payload_from_row(item, rate_map, actual_qty_map, barcode_map):
	rate = rate_map.get(item.name)
	if rate is None:
		rate = flt(item.standard_rate)
	actual_qty = actual_qty_map.get(item.name, 0) if actual_qty_map is not None else None

	return item_to_dict(
		item,
		rate=rate,
		actual_qty=actual_qty,
		barcode=barcode_map.get(item.name),
	)


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


def search_items(query=None, pos_profile=None, customer=None, limit=None):
	profile = resolve_pos_profile(pos_profile)
	customer = customer or profile.customer
	price_list = get_priority_price_list(customer=customer, pos_profile=profile)
	limit = cint(limit)
	query = (query or "").strip()

	barcode_item_code = _get_item_code_from_barcode(query) if query else None
	filters = {"disabled": 0, "is_sales_item": 1, "has_variants": 0}
	or_filters = []
	if query:
		or_filters = [
			["Item", "item_code", "like", f"%{query}%"],
			["Item", "item_name", "like", f"%{query}%"],
		]

	get_all_args = {
		"doctype": "Item",
		"filters": filters,
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
	rate_map = _get_rate_map(item_codes, price_list)
	if barcode_item_code:
		barcode_map[barcode_item_code] = query

	return [
		_to_item_payload_from_row(item_by_code[item_code], rate_map, actual_qty_map, barcode_map)
		for item_code in item_codes
	]


def get_item_details_for_pos(item_code, pos_profile=None, customer=None):
	profile = resolve_pos_profile(pos_profile)
	if customer:
		profile.customer = customer
	if not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item {0} does not exist").format(item_code))
	return _to_item_payload(item_code, profile)
