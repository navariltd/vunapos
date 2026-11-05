"""Restaurant orders: open orders on a table (or for takeaway/delivery) that are
billed later through the existing VunaPOS checkout.

An order is a standard ERPNext Sales Order, submitted when it is created and
marked as a restaurant order by its `vunapos_restaurant` field. Submitting it
posts no stock or accounting entries. Lines are changed afterwards with
ERPNext's Update Items (`update_child_qty_rate`), which keeps the order's
totals and reserved quantities right. Billing calls
`invoice_service.create_and_submit_invoice` with every invoice line linked to
its Sales Order line, so ERPNext marks the order billed (and delivered when
the invoice updates stock).

The status the API shows (Open, Billed, Cancelled) is derived from the Sales
Order, see `dto.restaurant.order_status`.
"""

import json
from uuid import uuid4

import frappe
from erpnext.controllers.accounts_controller import _get_taxes_and_charges, update_child_qty_rate
from frappe import _
from frappe.utils import cint, cstr, flt, now_datetime

from vunapos.dto.invoice import invoice_to_dict
from vunapos.dto.restaurant import (
	ORDER_STATUS_BILLED,
	ORDER_STATUS_CANCELLED,
	ORDER_STATUS_FIELDS,
	ORDER_STATUS_OPEN,
	line_id,
	order_status,
	order_summary_to_dict,
	order_to_dict,
	waiter_name,
)
from vunapos.services.floor_plan_service import (
	TABLE_DOCTYPE,
	is_floor_plan_manager,
	require_restaurant_profile,
)
from vunapos.services.invoice_service import (
	_append_cart_items,
	_apply_sales_order_delivery_date,
	_build_invoice_doc,
	_build_sales_order_doc,
	_get_item_row,
	_recalculate,
	_resolve_item_uom,
	_sync_profile_pricing_fields,
	create_and_submit_invoice,
	validate_cart_items,
)
from vunapos.services.menu_service import (
	get_menu_definition,
	resolve_table_floor,
	validate_menu_item,
	validate_service_type_price,
)
from vunapos.services.pin_service import consume_pin_token
from vunapos.services.profile_service import require_restaurant_staff_shift, resolve_pos_profile
from vunapos.services.restaurant_service import get_profile_restaurant, require_restaurant_access
from vunapos.services.service_type_service import (
	get_default_service_type,
	get_service_type_pricing,
	resolve_service_type,
)

ORDER_DOCTYPE = "Sales Order"
MAX_NOTE_LENGTH = 500
SUMMARY_FIELDS = (
	"name",
	"vunapos_restaurant",
	"vunapos_branch",
	"vunapos_restaurant_session",
	*ORDER_STATUS_FIELDS,
	"vunapos_service_type",
	"vunapos_restaurant_table",
	"customer",
	"vunapos_pax",
	"vunapos_waiter",
	"vunapos_opened_at",
	"vunapos_billing_doctype",
	"grand_total",
	"modified",
)
# Customer details that would be wrong once an order moves to another customer.
CUSTOMER_DETAIL_FIELDS = (
	"customer_address",
	"address_display",
	"shipping_address_name",
	"shipping_address",
	"contact_person",
	"contact_display",
	"contact_email",
	"contact_mobile",
	"contact_phone",
)


def _throw(code, message, meta=None, exc_type=frappe.ValidationError):
	exc = exc_type(message)
	exc.vuna_error_code = code
	exc.vuna_error_meta = meta or {}
	raise exc


def _parse_list(value):
	if isinstance(value, str):
		value = frappe.parse_json(value or "[]")
	return value or []


def _clean_note(note, label):
	note = cstr(note or "").strip()
	if len(note) > MAX_NOTE_LENGTH:
		_throw(
			"NOTE_TOO_LONG",
			_("{0} cannot exceed {1} characters").format(label, MAX_NOTE_LENGTH),
			{"max_length": MAX_NOTE_LENGTH},
		)
	return note or None


def _clean_pax(pax):
	pax = cint(pax)
	if pax < 0:
		_throw("INVALID_PAX", _("Guests cannot be negative"))
	return pax


def _open_order_filters(**filters):
	"""Filters matching the Sales Orders `order_status` calls Open."""
	return {
		"docstatus": 1,
		"status": ["!=", "Closed"],
		"per_billed": ["<", 100],
		"vunapos_billing_invoice": ["is", "not set"],
		**filters,
	}


def _status_filters(status, filters):
	"""(filters, or_filters) for `list_orders`, matching `order_status`."""
	if status == ORDER_STATUS_OPEN:
		return _open_order_filters(**filters), None
	if status == ORDER_STATUS_BILLED:
		return (
			{"docstatus": 1, **filters},
			{"vunapos_billing_invoice": ["is", "set"], "per_billed": [">=", 100]},
		)
	if status == ORDER_STATUS_CANCELLED:
		return (
			{"vunapos_billing_invoice": ["is", "not set"], "per_billed": ["<", 100], **filters},
			{"docstatus": 2, "status": "Closed"},
		)
	if status:
		_throw(
			"INVALID_ORDER_STATUS",
			_("Order status must be Open, Billed or Cancelled"),
			{"status": status},
		)
	return {"docstatus": ["in", (1, 2)], **filters}, None


# ---- validation ----


def _restaurant_setting(profile, fieldname):
	restaurant = get_profile_restaurant(profile)
	return restaurant.get(fieldname) if restaurant else None


def _validate_table(profile, service_type, table, order=None, restaurant_session=None):
	"""Return the table the order should sit at: None unless the service type uses tables."""
	if not service_type["requires_table"]:
		# Tables belong only to service types that use them. Clearing the table
		# on a switch to Takeaway also frees it, instead of leaving it occupied.
		return None
	if not table:
		_throw(
			"TABLE_REQUIRED",
			_("Select a table for a {0} order").format(service_type["service_type_name"]),
			{"service_type": service_type["name"]},
		)
	# Locking the table row makes concurrent orders for one table run one after
	# the other, so the occupancy check below cannot race.
	row = frappe.db.get_value(
		TABLE_DOCTYPE,
		table,
		["restaurant", "branch", "is_active", "table_label"],
		as_dict=True,
		for_update=True,
	)
	if not row or row.restaurant != profile.vunapos_restaurant or row.branch != profile.vunapos_branch:
		_throw(
			"TABLE_NOT_FOUND",
			_("Table {0} does not belong to restaurant {1}").format(table, profile.vunapos_restaurant),
			{"table": table},
		)
	if not cint(row.is_active):
		_throw("TABLE_INACTIVE", _("Table {0} is not active").format(row.table_label), {"table": table})
	if restaurant_session:
		from vunapos.services.restaurant_session_service import lock_tables

		lock_tables(
			[table], profile.vunapos_restaurant, session=restaurant_session, branch=profile.vunapos_branch
		)
		return table
	from vunapos.services.restaurant_session_service import current_assignments, current_legacy_orders

	for assignment in current_assignments(table):
		if frappe.db.get_value("Restaurant Session", assignment.parent, "status", for_update=True) in (
			"Open",
			"Settling",
		):
			_throw("TABLE_OCCUPIED", _("Table {0} belongs to an active restaurant session.").format(table))
	if cint(_restaurant_setting(profile, "allow_multiple_orders_per_table")):
		return table
	other = next((row.name for row in current_legacy_orders(table) if row.name != order), None)
	if other:
		_throw(
			"TABLE_OCCUPIED",
			_("Table {0} already has an open order ({1})").format(row.table_label, other),
			{"table": table, "order": other},
		)
	return table


def _validate_item(profile, item_code):
	if not item_code:
		_throw("ITEM_REQUIRED", _("Item code is required"))
	item = frappe.db.get_value(
		"Item",
		item_code,
		["item_group", "disabled", "is_sales_item", "has_variants", "is_stock_item"],
		as_dict=True,
	)
	if not item or cint(item.disabled) or not cint(item.is_sales_item):
		_throw("ITEM_NOT_SELLABLE", _("Item {0} cannot be sold").format(item_code), {"item_code": item_code})
	if cint(item.has_variants):
		_throw(
			"ITEM_HAS_VARIANTS",
			_("Item {0} is a template. Choose one of its variants.").format(item_code),
			{"item_code": item_code},
		)
	if not cint(item.is_stock_item) and not cint(profile.get("vunapos_allow_service_items")):
		# Same rule checkout applies; failing here keeps it from surfacing only at payment.
		_throw(
			"SERVICE_ITEMS_DISABLED",
			_("Item {0} is a service item and service items are disabled for this POS Profile").format(
				item_code
			),
			{"item_code": item_code},
		)
	return item


def _new_lines(items, existing_line_ids=()):
	"""Normalise requested lines, skipping line ids the order already has (a retry)."""
	seen = set(existing_line_ids)
	lines = []
	for item in _parse_list(items):
		requested_id = cstr(item.get("line_id")).strip()
		if requested_id and requested_id in seen:
			continue
		if not item.get("item_code"):
			_throw("ITEM_REQUIRED", _("Item code is required"))
		qty = flt(item.get("qty") or 1)
		if qty <= 0:
			_throw(
				"INVALID_QTY", _("Quantity must be greater than zero"), {"item_code": item.get("item_code")}
			)
		new_id = requested_id or str(uuid4())
		seen.add(new_id)
		# Same default as checkout: the item's Sales UOM, else its Stock UOM.
		uom, _conversion_factor = _resolve_item_uom(item.get("item_code"), item.get("uom"))
		lines.append(
			frappe._dict(
				line_id=new_id,
				item_code=item.get("item_code"),
				qty=qty,
				uom=uom,
				note=_clean_note(item.get("note"), _("Item note")),
				modifiers=item.get("modifiers"),
			)
		)
	return lines


def _validate_lines(profile, service_type, table, lines, existing_rows=(), price_list=None, customer=None):
	"""Item, menu and price rules for lines being added. Lines already on the
	order are not re-checked, so an open order is not blocked by a menu change."""
	floor = resolve_table_floor(profile.name, table)
	menu = get_menu_definition(profile, service_type, floor)
	from vunapos.services.modifier_service import expand_modifier_lines

	lines[:] = expand_modifier_lines(lines)
	addon_codes = {line.item_code for line in lines if line.get("parent_line_id")}
	priced_addons = set()
	if addon_codes:
		from vunapos.services.menu_service import items_priced_in
		from vunapos.services.price_list_service import resolve_price_list

		resolved_list = resolve_price_list(
			profile,
			customer=customer or profile.customer,
			requested_price_list=price_list or get_service_type_pricing(profile, service_type)["price_list"],
		)
		priced_addons = items_priced_in(resolved_list, addon_codes)
	for line in lines:
		item = _validate_item(profile, line.item_code)
		if not line.get("parent_line_id"):
			validate_menu_item(profile, line.item_code, item.item_group, service_type, floor, menu=menu)
		else:
			if line.item_code not in priced_addons:
				_throw("ADDON_PRICE_REQUIRED", _("Add a selling price for add-on {0}").format(line.item_code))
		validate_service_type_price(profile, line.item_code, service_type)
	if cint(frappe.db.get_single_value("Selling Settings", "allow_multiple_items")):
		return
	seen = {row.item_code for row in existing_rows}
	for line in lines:
		if line.item_code in seen:
			_throw(
				"REPEATED_ITEM_NOT_ALLOWED",
				_(
					"Item {0} is already on the order. Turn on Allow Item to Be Added Multiple Times "
					"in Selling Settings to add it again."
				).format(line.item_code),
				{"item_code": line.item_code},
			)
		seen.add(line.item_code)


# ---- loading ----


def _load_order(order, for_update=False):
	restaurant = order and frappe.db.get_value(ORDER_DOCTYPE, order, "vunapos_restaurant")
	if not restaurant:
		_throw("ORDER_NOT_FOUND", _("Order {0} was not found").format(order), {"order": order})
	# Orders belong to the restaurant, so staff of any of its tills can open them.
	doc = frappe.get_doc(ORDER_DOCTYPE, order, for_update=for_update)
	profile = frappe.get_cached_doc("POS Profile", doc.vunapos_pos_profile)
	require_restaurant_access(restaurant, branch=doc.vunapos_branch)
	return doc, profile


def _require_open(doc, action=None):
	status = order_status(doc)
	if status != ORDER_STATUS_OPEN:
		message = (
			_("Order {0} is {1} and cannot be billed")
			if action == "bill"
			else _("Order {0} is {1} and can no longer be changed")
		)
		_throw("ORDER_NOT_OPEN", message.format(doc.name, status), {"order": doc.name, "status": status})


def _load_open_order(order):
	doc, profile = _load_order(order, for_update=True)
	_require_open(doc)
	return doc, profile


def _require_editable_round(doc):
	if (
		doc.get("vunapos_restaurant_session")
		or any(row.get("vunapos_parent_line_id") for row in doc.get("items") or [])
	) and doc.docstatus == 1:
		_throw(
			"ROUND_ALREADY_COMMITTED",
			_(
				"This order is already placed. Add additional items from the POS catalogue and place a new order."
			),
		)


def _restaurant_profile(pos_profile):
	profile = resolve_pos_profile(pos_profile)
	require_restaurant_profile(profile.name)
	return profile


def _billing_profile(order_profile, pos_profile):
	"""The till that bills: the cashier's own, which must be in the order's restaurant."""
	if not pos_profile or pos_profile == order_profile.name:
		return order_profile
	profile = _restaurant_profile(pos_profile)
	if (profile.vunapos_restaurant, profile.vunapos_branch) != (
		order_profile.vunapos_restaurant,
		order_profile.vunapos_branch,
	):
		_throw(
			"ORDER_RESTAURANT_MISMATCH",
			_("POS Profile {0} is not in restaurant {1}").format(
				profile.name, order_profile.vunapos_restaurant
			),
			{"pos_profile": profile.name, "restaurant": order_profile.vunapos_restaurant},
		)
	return profile


# ---- lines and pricing ----


def _find_line(doc, requested_id):
	row = next((row for row in doc.get("items") or [] if line_id(row) == requested_id), None)
	if not row:
		_throw(
			"ORDER_LINE_NOT_FOUND",
			_("Line {0} was not found on order {1}").format(requested_id, doc.name),
			{"line_id": requested_id},
		)
	return row


def _price_line(doc, profile, item_code, qty, uom):
	"""Price a line exactly as checkout will: the order's price list and pricing rules."""
	return _get_item_row(item_code, qty, doc, profile, pricing_item={"uom": uom})


def _line_values(row, **changes):
	"""An existing order line as ERPNext's Update Items expects it."""
	return {
		"docname": row.name,
		"item_code": row.item_code,
		"qty": flt(row.qty),
		"rate": flt(row.rate),
		"uom": row.uom,
		"conversion_factor": flt(row.conversion_factor),
		"delivery_date": row.delivery_date,
		"description": row.description,
		"warehouse": row.warehouse,
		**changes,
	}


def _new_line_values(doc, profile, line):
	priced = _price_line(doc, profile, line.item_code, line.qty, line.uom)
	return {
		"item_code": line.item_code,
		"qty": line.qty,
		"rate": flt(priced["rate"]),
		"uom": priced["uom"],
		"conversion_factor": priced["conversion_factor"],
		"delivery_date": doc.delivery_date,
		"description": priced.get("description") or line.item_code,
		"warehouse": priced.get("warehouse"),
	}


def _update_lines(doc, lines_values, new_lines=()):
	"""Set the order's lines with ERPNext's Update Items: rows left out are removed,
	rows without a docname are added. VunaPOS line fields are stamped on the new rows."""
	before = {row.name for row in doc.get("items")}
	update_child_qty_rate(ORDER_DOCTYPE, json.dumps(lines_values, default=str), doc.name)
	doc.reload()
	added = [row for row in doc.get("items") if row.name not in before]
	now = now_datetime()
	for row, line in zip(added, new_lines, strict=False):
		row.db_set(
			{
				"vunapos_line_id": line.line_id,
				"vunapos_item_note": line.note,
				"vunapos_added_by": frappe.session.user,
				"vunapos_added_at": now,
				"vunapos_modifiers": line.get("modifiers_snapshot"),
				"vunapos_parent_line_id": line.get("parent_line_id"),
			},
			update_modified=False,
		)


def _apply_header_pricing(doc, profile, price_list=None):
	"""Put the service type's (else the profile's) price list and taxes on the order."""
	_sync_profile_pricing_fields(doc, profile, price_list)
	doc.set("taxes", [])
	if doc.taxes_and_charges:
		doc.extend("taxes", _get_taxes_and_charges("Sales Taxes and Charges Template", doc.taxes_and_charges))
	doc.append_taxes_from_item_tax_template()
	doc.calculate_taxes_and_totals()


def _reprice_lines(doc, profile):
	_update_lines(
		doc,
		[
			_line_values(row, rate=flt(_price_line(doc, profile, row.item_code, row.qty, row.uom)["rate"]))
			for row in doc.get("items")
		],
	)


def _set_customer(doc, customer):
	details = frappe.db.get_value(
		"Customer", customer, ["customer_name", "customer_group", "territory"], as_dict=True
	)
	if not details:
		_throw("CUSTOMER_NOT_FOUND", _("Customer {0} was not found").format(customer), {"customer": customer})
	doc.update(
		{
			"customer": customer,
			"customer_name": details.customer_name,
			"customer_group": details.customer_group,
			"territory": details.territory,
		}
	)
	for fieldname in CUSTOMER_DETAIL_FIELDS:
		if doc.meta.has_field(fieldname):
			doc.set(fieldname, None)


def _save_submitted(doc):
	"""Save header changes on the submitted order, including fields ERPNext locks
	after submit (customer, service type pricing). Nothing is billed yet."""
	doc.flags.ignore_validate_update_after_submit = True
	doc.save()


def _change_header(doc, profile, customer=None, service_type_changed=False):
	"""Save header changes; a new customer or service type also re-prices every line."""
	previous_customer = doc.customer
	customer_changed = bool(customer) and customer != doc.customer
	if customer_changed:
		_set_customer(doc, customer)
	reprice = customer_changed or service_type_changed
	if reprice:
		_apply_header_pricing(doc, profile)
	_save_submitted(doc)
	if reprice:
		_reprice_lines(doc, profile)
	if customer_changed:
		doc.add_comment(
			"Info", _("Customer changed from {0} to {1}.").format(previous_customer, doc.customer)
		)


# ---- public API ----


def create_order(
	pos_profile=None,
	service_type=None,
	table=None,
	customer=None,
	pax=None,
	order_note=None,
	items=None,
	idempotency_key=None,
	restaurant_session=None,
	price_list=None,
	kitchen_routing=None,
):
	idempotency_key = cstr(idempotency_key).strip() or None
	if idempotency_key:
		existing = frappe.db.get_value(
			ORDER_DOCTYPE,
			{"vunapos_idempotency_key": idempotency_key, "vunapos_restaurant": ["is", "set"]},
			"name",
		)
		if existing:
			doc, _profile = _load_order(existing)
			if doc.get("vunapos_restaurant_session") != restaurant_session:
				_throw("IDEMPOTENCY_CONFLICT", _("This order key belongs to a different session."))
			return order_to_dict(doc)
	profile = _restaurant_profile(pos_profile)
	require_restaurant_staff_shift(profile.name)
	if not service_type:
		default = get_default_service_type(profile)
		service_type = default["name"] if default else None
	service_type_row = resolve_service_type(profile, service_type)
	if restaurant_session:
		from vunapos.services.restaurant_session_service import _load

		session = _load(restaurant_session, for_update=True)
		if (
			session.status != "Open"
			or session.restaurant != profile.vunapos_restaurant
			or session.branch != profile.vunapos_branch
			or session.customer != customer
			or session.service_type != service_type
		):
			_throw("SESSION_CONTEXT_MISMATCH", _("Order does not match the open Restaurant Session."))
		if table and table not in [row.table for row in session.tables if not row.released_at]:
			_throw("SESSION_CONTEXT_MISMATCH", _("Table is not assigned to this session."))
	table = _validate_table(profile, service_type_row, table or None, restaurant_session=restaurant_session)
	# A Sales Order cannot be submitted without lines.
	lines = _new_lines(items)
	if not lines:
		_throw("ITEMS_REQUIRED", _("Add at least one item"))
	_validate_lines(profile, service_type, table, lines, price_list=price_list, customer=customer)
	if restaurant_session:
		from vunapos.services.kitchen_service import route_lines
		from vunapos.services.restaurant_stock_service import plan_stock

		route_lines(profile.vunapos_restaurant, lines, kitchen_routing, branch=profile.vunapos_branch)
		plan_stock(profile, lines)

	doc, profile = _build_sales_order_doc(
		pos_profile=profile.name, customer=customer or None, service_type=service_type, price_list=price_list
	)
	now = now_datetime()
	doc.update(
		{
			"vunapos_restaurant": profile.vunapos_restaurant,
			"vunapos_branch": profile.vunapos_branch,
			"vunapos_restaurant_session": restaurant_session,
			"vunapos_restaurant_table": table,
			"vunapos_pax": _clean_pax(pax),
			"vunapos_order_note": _clean_note(order_note, _("Order note")),
			"vunapos_waiter": frappe.session.user,
			"vunapos_opened_at": now,
			"vunapos_idempotency_key": idempotency_key,
			# Stock is issued by the invoice; a reservation would only block it.
			"reserve_stock": 0,
		}
	)
	_append_cart_items(
		doc,
		profile,
		[
			{"item_code": line.item_code, "qty": line.qty, "uom": line.uom, "item_note": line.note}
			for line in lines
		],
	)
	for row, line in zip(doc.get("items"), lines, strict=False):
		row.update(
			{
				"vunapos_line_id": line.line_id,
				"vunapos_added_by": frappe.session.user,
				"vunapos_added_at": now,
				"vunapos_kitchen_station": line.get("routed_station"),
				"vunapos_temporary_kitchen_routing": cint(line.get("temporary_routing")),
				"vunapos_modifiers": line.get("modifiers_snapshot"),
				"vunapos_parent_line_id": line.get("parent_line_id"),
			}
		)
		# Add-ons travel with the prepared parent, but remain separate stock
		# lines (and are never counted again as BOM ingredients).
		if restaurant_session and line.get("parent_line_id") and line.get("routed_station"):
			row.warehouse = (
				frappe.get_cached_value("Kitchen Station", line.routed_station, "raw_material_warehouse")
				or profile.warehouse
			)
	_apply_header_pricing(doc, profile, price_list)
	_apply_sales_order_delivery_date(doc, None)
	_recalculate(doc, profile, price_list)
	# ERPNext may populate child dates during recalculation; keep today.
	_apply_sales_order_delivery_date(doc, None)
	doc.insert()
	# ERPNext's global auto-reserve option must not reserve finished goods for
	# made-to-order rows before their Work Orders have produced them.
	if restaurant_session:
		doc.reserve_stock = 0
	previous_routing = frappe.flags.get("vunapos_kitchen_routing")
	try:
		frappe.flags.vunapos_kitchen_routing = kitchen_routing
		doc.submit()
	finally:
		frappe.flags.vunapos_kitchen_routing = previous_routing
	return order_to_dict(doc)


def get_order(order):
	doc, _profile = _load_order(order)
	return order_to_dict(doc)


def list_orders(pos_profile=None, status=ORDER_STATUS_OPEN, table=None, service_type=None, limit=100):
	profile = _restaurant_profile(pos_profile)
	# Every till of the restaurant shares its tables and orders.
	filters = {
		"vunapos_restaurant": profile.vunapos_restaurant,
		"vunapos_branch": profile.vunapos_branch,
	}
	if table:
		filters["vunapos_restaurant_table"] = table
	if service_type:
		filters["vunapos_service_type"] = service_type
	filters, or_filters = _status_filters(status, filters)
	rows = frappe.get_all(
		ORDER_DOCTYPE,
		filters=filters,
		or_filters=or_filters,
		fields=list(SUMMARY_FIELDS),
		order_by="vunapos_opened_at asc",
		limit_page_length=min(max(cint(limit), 1), 500),
	)
	return [order_summary_to_dict(row) for row in rows]


def update_order(order, service_type=None, table=None, customer=None, pax=None, order_note=None):
	"""Change the order header. None leaves a field as it is; an empty string clears it
	(for the customer: back to the profile's default customer).

	Moving to another table is a table transfer. Changing the service type or
	customer re-prices every line; lines are not re-checked against the menu.
	"""
	doc, profile = _load_open_order(order)
	_require_editable_round(doc)
	new_service_type = doc.vunapos_service_type if service_type is None else service_type
	service_type_row = resolve_service_type(profile, new_service_type)
	service_type_changed = new_service_type != doc.vunapos_service_type
	new_table = doc.vunapos_restaurant_table if table is None else (table or None)
	if service_type_changed or new_table != doc.vunapos_restaurant_table:
		new_table = _validate_table(profile, service_type_row, new_table, order=doc.name)
	if service_type_changed:
		# A new service type can mean a new price list, so every line must have a
		# price in it; otherwise a line would be billed at zero.
		for row in doc.get("items"):
			validate_service_type_price(profile, row.item_code, new_service_type)
	new_customer = None
	if customer is not None:
		new_customer = customer or profile.customer
		if not new_customer:
			_throw("CUSTOMER_REQUIRED", _("Select a customer: the POS Profile has no default customer"))
	doc.vunapos_service_type = new_service_type
	doc.vunapos_restaurant_table = new_table
	if pax is not None:
		doc.vunapos_pax = _clean_pax(pax)
	if order_note is not None:
		doc.vunapos_order_note = _clean_note(order_note, _("Order note"))
	_change_header(doc, profile, customer=new_customer, service_type_changed=service_type_changed)
	return order_to_dict(doc)


def add_items(order, items):
	doc, profile = _load_open_order(order)
	_require_editable_round(doc)
	if not _parse_list(items):
		_throw("ITEMS_REQUIRED", _("Add at least one item"))
	lines = _new_lines(items, {line_id(row) for row in doc.get("items")})
	if not lines:
		# Every line was already added: a retried request.
		return order_to_dict(doc)
	_validate_lines(
		profile, doc.vunapos_service_type, doc.vunapos_restaurant_table, lines, existing_rows=doc.get("items")
	)
	_update_lines(
		doc,
		[_line_values(row) for row in doc.get("items")]
		+ [_new_line_values(doc, profile, line) for line in lines],
		new_lines=lines,
	)
	return order_to_dict(doc)


def update_item(order, line_id, qty=None, note=None):
	doc, profile = _load_open_order(order)
	_require_editable_round(doc)
	row = _find_line(doc, line_id)
	if note is not None:
		note = _clean_note(note, _("Item note"))
	if qty is not None:
		qty = flt(qty)
		if qty <= 0:
			_throw("INVALID_QTY", _("Quantity must be greater than zero. Remove the line instead."))
		if qty != flt(row.qty):
			# Re-priced at the new quantity, as checkout would (quantity offers).
			rate = flt(_price_line(doc, profile, row.item_code, qty, row.uom)["rate"])
			_update_lines(
				doc,
				[
					_line_values(other, qty=qty, rate=rate) if other.name == row.name else _line_values(other)
					for other in doc.get("items")
				],
			)
			row = _find_line(doc, line_id)
	if note is not None:
		row.db_set("vunapos_item_note", note)
	return order_to_dict(doc)


def remove_item(order, line_id, manager_pin_token=None):
	doc, profile = _load_open_order(order)
	_require_editable_round(doc)
	row = _find_line(doc, line_id)
	if len(doc.get("items")) == 1:
		# A submitted Sales Order cannot be left without lines.
		_throw(
			"ORDER_LAST_LINE",
			_("This is the order's last line. Cancel the order instead."),
			{"order": doc.name, "line_id": line_id},
		)
	manager_identity = None
	# Same rule as removing an item from a retail cart.
	if profile.get("vunapos_require_manager_pin_item_removal"):
		manager_identity = consume_pin_token(manager_pin_token, profile, "manager").get("subject")
	_update_lines(doc, [_line_values(other) for other in doc.get("items") if other.name != row.name])
	if manager_identity:
		doc.add_comment(
			"Info",
			_("{0} x {1} removed with manager PIN approval by {2}.").format(
				row.qty, row.item_code, manager_identity
			),
		)
	return order_to_dict(doc)


def cancel_order(order, reason=None, manager_pin_token=None):
	doc, profile = _load_open_order(order)
	reason = _clean_note(reason, _("Cancel reason"))
	if not reason:
		_throw("CANCEL_REASON_REQUIRED", _("Enter a reason for cancelling the order"))
	approved_by = None
	if cint(profile.get("vunapos_require_manager_pin_order_cancel")) and not is_floor_plan_manager():
		approved_by = consume_pin_token(manager_pin_token, profile, "manager_order_cancel").get("subject")
	doc.update(
		{
			"vunapos_cancel_reason": reason,
			"vunapos_cancel_approved_by": approved_by,
			"vunapos_cancelled_by": frappe.session.user,
			"vunapos_cancelled_at": now_datetime(),
		}
	)
	# Restaurant access and the PIN rule are checked above, so staff without
	# the Sales Order cancel right (waiters, cashiers) can cancel an order.
	doc.flags.ignore_permissions = True
	doc.cancel()
	return order_to_dict(doc)


def _billed_result(doc):
	invoice = frappe.get_doc(doc.vunapos_billing_doctype, doc.vunapos_billing_invoice)
	return {"order": order_to_dict(doc), "invoice": invoice_to_dict(invoice)}


def _stamp_invoice(invoice_doctype, invoice_name, doc):
	values = {
		"vunapos_service_type": doc.vunapos_service_type,
		"vunapos_restaurant_table": doc.vunapos_restaurant_table,
	}
	meta = frappe.get_meta(invoice_doctype)
	values = {fieldname: value for fieldname, value in values.items() if meta.has_field(fieldname)}
	if values:
		frappe.db.set_value(invoice_doctype, invoice_name, values, update_modified=False)


def checkout_order(
	order,
	payments=None,
	idempotency_key=None,
	customer=None,
	is_credit_sale=False,
	due_date=None,
	price_list=None,
	loyalty_points=None,
	tax_id=None,
	shipping_address_name=None,
	salesperson=None,
	salesperson_token=None,
	checkout_fields=None,
	pos_profile=None,
):
	"""Bill an open order through the standard VunaPOS checkout.

	`pos_profile` is the billing till, defaulting to the till the order was
	taken on; it must be in the same restaurant. The billing user needs an open
	POS shift on it (checkout enforces it). The invoice is created and owned by
	that user, so POS closing works unchanged. Its lines link to the Sales Order
	lines, so ERPNext marks the order billed.
	"""
	doc, order_profile = _load_order(order, for_update=True)
	if doc.get("vunapos_restaurant_session"):
		_throw(
			"SESSION_SETTLEMENT_REQUIRED",
			_("This round belongs to a Restaurant Session. Bill the complete session, not a single round."),
		)
	billing_profile = _billing_profile(order_profile, pos_profile)
	idempotency_key = cstr(idempotency_key).strip() or None
	if order_status(doc) == ORDER_STATUS_BILLED:
		if (
			idempotency_key
			and doc.vunapos_billing_invoice
			and (
				frappe.db.get_value(
					doc.vunapos_billing_doctype, doc.vunapos_billing_invoice, "vunapos_idempotency_key"
				)
				== idempotency_key
			)
		):
			return _billed_result(doc)
		_throw(
			"ORDER_ALREADY_BILLED",
			_("Order {0} has already been billed on {1}").format(doc.name, doc.vunapos_billing_invoice),
			{"order": doc.name, "invoice": doc.vunapos_billing_invoice},
		)
	_require_open(doc, action="bill")
	if not doc.get("items"):
		_throw("ORDER_EMPTY", _("Add at least one item before billing the order"), {"order": doc.name})

	savepoint = "vunapos_restaurant_checkout"
	frappe.db.savepoint(savepoint)
	try:
		if customer and customer != doc.customer:
			# An invoice must be for its Sales Order's customer, so the order follows.
			_change_header(doc, order_profile, customer=customer)
		invoice = create_and_submit_invoice(
			pos_profile=billing_profile.name,
			customer=doc.customer,
			items=_order_cart_items(doc),
			payments=payments,
			idempotency_key=idempotency_key,
			is_credit_sale=is_credit_sale,
			due_date=due_date,
			price_list=price_list,
			loyalty_points=loyalty_points,
			tax_id=tax_id,
			shipping_address_name=shipping_address_name,
			salesperson=salesperson,
			salesperson_token=salesperson_token,
			checkout_fields=checkout_fields,
			service_type=doc.vunapos_service_type,
			sales_order=doc.name,
		)
		_stamp_invoice(invoice["doctype"], invoice["name"], doc)
		# Billed from here, even while a queued invoice is still being submitted.
		doc.db_set(
			{
				"vunapos_billing_doctype": invoice["doctype"],
				"vunapos_billing_invoice": invoice["name"],
				"vunapos_billed_by": frappe.session.user,
				"vunapos_billed_at": now_datetime(),
			}
		)
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		raise
	doc.reload()
	return {"order": order_to_dict(doc), "invoice": invoice}


def _order_cart_items(doc):
	return [
		{
			"item_code": row.item_code,
			"qty": row.qty,
			"uom": row.uom,
			"item_note": row.vunapos_item_note,
			"so_detail": row.name,
		}
		for row in doc.get("items") or []
	]


def preview_order(order, customer=None, pos_profile=None):
	"""Price an open order exactly as checkout will, without saving anything.

	Uses the service type's price list, offers (pricing rules) and taxes, such
	as a Dine In service charge. Unlike invoice preview it needs no open shift,
	so waiters can show the bill. Stock is checked at checkout, not here.
	"""
	doc, profile = _load_order(order)
	profile = _billing_profile(profile, pos_profile)
	if not doc.get("items"):
		_throw("ORDER_EMPTY", _("Add at least one item before previewing the order"), {"order": doc.name})
	invoice, profile = _build_invoice_doc(
		pos_profile=profile.name,
		customer=customer or doc.customer,
		service_type=doc.vunapos_service_type,
	)
	invoice.vunapos_restaurant = doc.vunapos_restaurant
	invoice.vunapos_branch = doc.vunapos_branch
	cart_items = _order_cart_items(doc)
	validate_cart_items(cart_items, profile, validate_stock=False)
	_append_cart_items(invoice, profile, cart_items)
	_recalculate(invoice, profile)
	return {"order": order_to_dict(doc), "invoice": invoice_to_dict(invoice)}


def get_table_status(pos_profile=None):
	"""Derive each active table's status from its open orders (never stored)."""
	profile = _restaurant_profile(pos_profile)
	tables = frappe.get_all(
		TABLE_DOCTYPE,
		filters={"restaurant": profile.vunapos_restaurant, "branch": profile.vunapos_branch, "is_active": 1},
		fields=["name", "table_label", "floor", "seats"],
		order_by="table_label asc",
	)
	orders_by_table = {}
	for row in frappe.get_all(
		ORDER_DOCTYPE,
		filters=_open_order_filters(
			vunapos_restaurant=profile.vunapos_restaurant,
			vunapos_restaurant_table=["in", [table.name for table in tables] or [""]],
			vunapos_restaurant_session=["is", "not set"],
		),
		fields=[
			"name",
			"vunapos_restaurant_table",
			"vunapos_service_type",
			"vunapos_pax",
			"vunapos_waiter",
			"vunapos_opened_at",
		],
		order_by="vunapos_opened_at asc",
	):
		orders_by_table.setdefault(row.vunapos_restaurant_table, []).append(
			{
				"name": row.name,
				"service_type": row.vunapos_service_type,
				"pax": cint(row.vunapos_pax),
				"waiter": row.vunapos_waiter,
				"waiter_name": waiter_name(row.vunapos_waiter),
				"opened_at": row.vunapos_opened_at,
			}
		)
	from vunapos.services.restaurant_session_service import list_sessions

	sessions_by_table = {
		table.table: session for session in list_sessions(profile.name) for table in session.tables
	}
	return [
		{
			"table": table.name,
			"table_label": table.table_label,
			"floor": table.floor,
			"seats": cint(table.seats),
			"status": "Occupied"
			if orders_by_table.get(table.name) or table.name in sessions_by_table
			else "Free",
			"session": sessions_by_table.get(table.name),
			"orders": orders_by_table.get(table.name, []),
		}
		for table in tables
	]
