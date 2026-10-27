"""Restaurant orders: open orders on a table (or for takeaway/delivery) that are
billed later through the existing VunaPOS checkout.

An order is an operational document. It never posts stock or accounting.
Billing converts its lines into a normal cart and calls
`invoice_service.create_and_submit_invoice`, then stamps the order, service
type and table onto the resulting invoice.
"""

from uuid import uuid4

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt, now_datetime

from vunapos.dto.invoice import invoice_to_dict
from vunapos.dto.restaurant import order_summary_to_dict, order_to_dict, waiter_name
from vunapos.services.floor_plan_service import (
	TABLE_DOCTYPE,
	is_floor_plan_manager,
	require_restaurant_profile,
)
from vunapos.services.invoice_service import (
	_append_cart_items,
	_build_invoice_doc,
	_recalculate,
	_resolve_item_uom,
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
from vunapos.services.profile_service import resolve_pos_profile
from vunapos.services.service_type_service import get_default_service_type, resolve_service_type

ORDER_DOCTYPE = "VunaPOS Restaurant Order"
STATUS_OPEN = "Open"
STATUS_BILLED = "Billed"
STATUS_CANCELLED = "Cancelled"
CLOSED_STATUSES = (STATUS_BILLED, STATUS_CANCELLED)
MAX_NOTE_LENGTH = 500
INVOICE_DOCTYPES = ("Sales Invoice", "POS Invoice")
# Set by this service when it closes an order (billing or cancelling), so the
# controller lets that one status change through.
CLOSING_FLAG = "vunapos_closing_restaurant_order"


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


# ---- document validation (also runs on Desk edits) ----


def _validate_table(doc, profile, service_type):
	if service_type["requires_table"] and not doc.restaurant_table:
		_throw(
			"TABLE_REQUIRED",
			_("Select a table for a {0} order").format(service_type["service_type_name"]),
			{"service_type": service_type["name"]},
		)
	if not doc.restaurant_table:
		return
	# Locking the table row makes concurrent orders for one table run one after
	# the other, so the occupancy check below cannot race.
	table = frappe.db.get_value(
		TABLE_DOCTYPE,
		doc.restaurant_table,
		["pos_profile", "is_active", "table_label"],
		as_dict=True,
		for_update=True,
	)
	if not table or table.pos_profile != profile.name:
		_throw(
			"TABLE_NOT_FOUND",
			_("Table {0} does not belong to POS Profile {1}").format(doc.restaurant_table, profile.name),
			{"table": doc.restaurant_table},
		)
	if not cint(table.is_active):
		_throw(
			"TABLE_INACTIVE",
			_("Table {0} is not active").format(table.table_label),
			{"table": doc.restaurant_table},
		)
	if cint(profile.get("vunapos_allow_multiple_orders_per_table")):
		return
	other = frappe.db.get_value(
		ORDER_DOCTYPE,
		{"restaurant_table": doc.restaurant_table, "status": STATUS_OPEN, "name": ["!=", doc.name or ""]},
		"name",
	)
	if other:
		_throw(
			"TABLE_OCCUPIED",
			_("Table {0} already has an open order ({1})").format(table.table_label, other),
			{"table": doc.restaurant_table, "order": other},
		)


def validate_order_doc(doc):
	previous = None if doc.is_new() else doc.get_doc_before_save()
	if previous and previous.status in CLOSED_STATUSES:
		_throw(
			"ORDER_NOT_OPEN",
			_("Order {0} is {1} and can no longer be changed").format(doc.name, previous.status),
			{"order": doc.name, "status": previous.status},
		)
	if doc.status in CLOSED_STATUSES and not doc.flags.get(CLOSING_FLAG):
		_throw(
			"INVALID_ORDER_STATUS",
			_("Bill or cancel an order through VunaPOS, not by editing its status"),
			{"order": doc.name, "status": doc.status},
		)
	if previous and previous.pos_profile != doc.pos_profile:
		_throw(
			"ORDER_PROFILE_LOCKED", _("An order cannot be moved to another POS Profile"), {"order": doc.name}
		)

	require_restaurant_profile(doc.pos_profile)
	profile = frappe.get_cached_doc("POS Profile", doc.pos_profile)
	service_type = resolve_service_type(profile, doc.service_type)
	doc.requires_table = cint(service_type["requires_table"])
	if doc.status == STATUS_OPEN:
		if not doc.requires_table:
			# Tables belong only to service types that use them. Clearing the table
			# on a switch to Takeaway also frees it, instead of leaving a hidden
			# table occupied.
			doc.restaurant_table = None
		_validate_table(doc, profile, service_type)
	if cint(doc.pax) < 0:
		_throw("INVALID_PAX", _("Guests cannot be negative"))
	doc.order_note = _clean_note(doc.order_note, _("Order note"))
	doc.waiter = doc.waiter or frappe.session.user
	doc.opened_at = doc.opened_at or now_datetime()

	previous_line_ids = {row.line_id for row in previous.get("items") or []} if previous else set()
	# A new service type can mean a new price list, so every line must have a
	# price in it; otherwise a line would be billed at zero.
	service_type_changed = bool(previous) and previous.service_type != doc.service_type
	menu = floor = None
	seen_line_ids = set()
	for row in doc.get("items") or []:
		row.line_id = cstr(row.line_id).strip() or str(uuid4())
		if row.line_id in seen_line_ids:
			_throw(
				"DUPLICATE_LINE_ID",
				_("Line ID {0} is used twice").format(row.line_id),
				{"line_id": row.line_id},
			)
		seen_line_ids.add(row.line_id)
		if flt(row.qty) <= 0:
			_throw(
				"INVALID_QTY",
				_("Quantity for {0} must be greater than zero").format(row.item_code),
				{"line_id": row.line_id},
			)
		if row.line_id not in previous_line_ids and doc.status == STATUS_OPEN:
			# Only lines added in this save are checked against the menu, so an
			# open order is not blocked when the menu changes under it.
			item = _validate_item(profile, row.item_code)
			if menu is None:
				floor = resolve_table_floor(profile.name, doc.restaurant_table)
				menu = get_menu_definition(profile, doc.service_type, floor)
			validate_menu_item(profile, row.item_code, item.item_group, doc.service_type, floor, menu=menu)
		if doc.status == STATUS_OPEN and (row.line_id not in previous_line_ids or service_type_changed):
			validate_service_type_price(profile, row.item_code, doc.service_type)
		# Same default as checkout: the item's Sales UOM, else its Stock UOM.
		row.uom, _conversion_factor = _resolve_item_uom(row.item_code, row.uom)
		row.note = _clean_note(row.note, _("Item note"))
		row.added_by = row.added_by or frappe.session.user
		row.added_at = row.added_at or now_datetime()


# ---- loading ----


def _load_order(order, for_update=False):
	if not order or not frappe.db.exists(ORDER_DOCTYPE, order):
		_throw("ORDER_NOT_FOUND", _("Order {0} was not found").format(order), {"order": order})
	doc = frappe.get_doc(ORDER_DOCTYPE, order, for_update=for_update)
	profile = resolve_pos_profile(doc.pos_profile)
	return doc, profile


def _load_open_order(order):
	doc, profile = _load_order(order, for_update=True)
	if doc.status != STATUS_OPEN:
		_throw(
			"ORDER_NOT_OPEN",
			_("Order {0} is {1} and can no longer be changed").format(doc.name, doc.status),
			{"order": doc.name, "status": doc.status},
		)
	return doc, profile


def _restaurant_profile(pos_profile):
	profile = resolve_pos_profile(pos_profile)
	require_restaurant_profile(profile.name)
	return profile


# ---- lines ----


def _find_line(doc, line_id):
	row = next((row for row in doc.get("items") or [] if row.line_id == line_id), None)
	if not row:
		_throw(
			"ORDER_LINE_NOT_FOUND",
			_("Line {0} was not found on order {1}").format(line_id, doc.name),
			{"line_id": line_id},
		)
	return row


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


def _append_lines(doc, items):
	# Item, menu and UOM rules are applied by validate_order_doc when the order
	# is saved, so API and Desk edits follow the same rules.
	existing_line_ids = {row.line_id for row in doc.get("items") or []}
	for item in _parse_list(items):
		line_id = cstr(item.get("line_id")).strip()
		if line_id and line_id in existing_line_ids:
			# A retried request re-sends lines it already added.
			continue
		qty = flt(item.get("qty") or 1)
		if qty <= 0:
			_throw(
				"INVALID_QTY", _("Quantity must be greater than zero"), {"item_code": item.get("item_code")}
			)
		if not item.get("item_code"):
			_throw("ITEM_REQUIRED", _("Item code is required"))
		line_id = line_id or str(uuid4())
		existing_line_ids.add(line_id)
		doc.append(
			"items",
			{
				"line_id": line_id,
				"item_code": item.get("item_code"),
				"qty": qty,
				"uom": item.get("uom"),
				"note": item.get("note"),
				"added_by": frappe.session.user,
				"added_at": now_datetime(),
			},
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
):
	idempotency_key = cstr(idempotency_key).strip() or None
	if idempotency_key:
		existing = frappe.db.get_value(ORDER_DOCTYPE, {"idempotency_key": idempotency_key}, "name")
		if existing:
			doc, _profile = _load_order(existing)
			return order_to_dict(doc)
	profile = _restaurant_profile(pos_profile)
	if not service_type:
		default = get_default_service_type(profile)
		service_type = default["name"] if default else None
	resolve_service_type(profile, service_type)
	doc = frappe.new_doc(ORDER_DOCTYPE)
	doc.update(
		{
			"pos_profile": profile.name,
			"service_type": service_type,
			"restaurant_table": table or None,
			"customer": customer or None,
			"pax": cint(pax),
			"order_note": order_note,
			"waiter": frappe.session.user,
			"opened_at": now_datetime(),
			"idempotency_key": idempotency_key,
		}
	)
	_append_lines(doc, items)
	doc.insert()
	return order_to_dict(doc)


def get_order(order):
	doc, _profile = _load_order(order)
	return order_to_dict(doc)


def list_orders(pos_profile=None, status=STATUS_OPEN, table=None, service_type=None, limit=100):
	profile = _restaurant_profile(pos_profile)
	filters = {"pos_profile": profile.name}
	if status:
		filters["status"] = status
	if table:
		filters["restaurant_table"] = table
	if service_type:
		filters["service_type"] = service_type
	rows = frappe.get_all(
		ORDER_DOCTYPE,
		filters=filters,
		fields=[
			"name",
			"status",
			"service_type",
			"restaurant_table",
			"customer",
			"pax",
			"waiter",
			"opened_at",
			"invoice_doctype",
			"invoice",
			"modified",
		],
		order_by="opened_at asc",
		limit_page_length=min(max(cint(limit), 1), 500),
	)
	return [order_summary_to_dict(row) for row in rows]


def update_order(order, service_type=None, table=None, customer=None, pax=None, order_note=None):
	"""Change the order header. None leaves a field as it is; an empty string clears it.

	Moving to another table is a table transfer. Changing the service type or
	table does not re-check lines already on the order against the menu.
	"""
	doc, _profile = _load_open_order(order)
	if service_type is not None:
		doc.service_type = service_type
	if table is not None:
		doc.restaurant_table = table or None
	if customer is not None:
		doc.customer = customer or None
	if pax is not None:
		doc.pax = cint(pax)
	if order_note is not None:
		doc.order_note = order_note
	doc.save()
	return order_to_dict(doc)


def add_items(order, items):
	doc, _profile = _load_open_order(order)
	if not _parse_list(items):
		_throw("ITEMS_REQUIRED", _("Add at least one item"))
	_append_lines(doc, items)
	doc.save()
	return order_to_dict(doc)


def update_item(order, line_id, qty=None, note=None):
	doc, _profile = _load_open_order(order)
	row = _find_line(doc, line_id)
	if qty is not None:
		if flt(qty) <= 0:
			_throw("INVALID_QTY", _("Quantity must be greater than zero. Remove the line instead."))
		row.qty = flt(qty)
	if note is not None:
		row.note = note
	doc.save()
	return order_to_dict(doc)


def remove_item(order, line_id, manager_pin_token=None):
	doc, profile = _load_open_order(order)
	row = _find_line(doc, line_id)
	manager_identity = None
	# Same rule as removing an item from a retail cart.
	if profile.get("vunapos_require_manager_pin_item_removal"):
		manager_identity = consume_pin_token(manager_pin_token, profile, "manager").get("subject")
	doc.remove(row)
	doc.save()
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
		approved_by = consume_pin_token(manager_pin_token, profile, "manager").get("subject")
	doc.update(
		{
			"status": STATUS_CANCELLED,
			"cancel_reason": reason,
			"cancel_approved_by": approved_by,
			"cancelled_by": frappe.session.user,
			"cancelled_at": now_datetime(),
		}
	)
	doc.flags[CLOSING_FLAG] = True
	doc.save()
	return order_to_dict(doc)


def _billed_result(doc):
	invoice = frappe.get_doc(doc.invoice_doctype, doc.invoice)
	return {"order": order_to_dict(doc), "invoice": invoice_to_dict(invoice)}


def _stamp_invoice(invoice_doctype, invoice_name, doc):
	values = {
		"vunapos_restaurant_order": doc.name,
		"vunapos_service_type": doc.service_type,
		"vunapos_restaurant_table": doc.restaurant_table,
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
):
	"""Bill an open order through the standard VunaPOS checkout.

	The billing user needs an open POS shift (checkout enforces it). The
	invoice is created and owned by that user, so POS closing works unchanged.
	"""
	doc, _profile = _load_order(order, for_update=True)
	idempotency_key = cstr(idempotency_key).strip() or None
	if doc.status == STATUS_BILLED:
		if (
			idempotency_key
			and doc.invoice
			and (
				frappe.db.get_value(doc.invoice_doctype, doc.invoice, "vunapos_idempotency_key")
				== idempotency_key
			)
		):
			return _billed_result(doc)
		_throw(
			"ORDER_ALREADY_BILLED",
			_("Order {0} has already been billed on {1}").format(doc.name, doc.invoice),
			{"order": doc.name, "invoice": doc.invoice},
		)
	if doc.status != STATUS_OPEN:
		_throw(
			"ORDER_NOT_OPEN",
			_("Order {0} is {1} and cannot be billed").format(doc.name, doc.status),
			{"order": doc.name, "status": doc.status},
		)
	if not doc.get("items"):
		_throw("ORDER_EMPTY", _("Add at least one item before billing the order"), {"order": doc.name})

	cart_items = _order_cart_items(doc)
	savepoint = "vunapos_restaurant_checkout"
	frappe.db.savepoint(savepoint)
	try:
		invoice = create_and_submit_invoice(
			pos_profile=doc.pos_profile,
			customer=customer or doc.customer,
			items=cart_items,
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
			service_type=doc.service_type,
		)
		_stamp_invoice(invoice["doctype"], invoice["name"], doc)
		doc.update(
			{
				"status": STATUS_BILLED,
				"customer": invoice.get("customer") or doc.customer,
				"invoice_doctype": invoice["doctype"],
				"invoice": invoice["name"],
				"billed_by": frappe.session.user,
				"billed_at": now_datetime(),
			}
		)
		doc.flags[CLOSING_FLAG] = True
		# The billing user is authorised by checkout itself (profile assignment
		# and an open shift); updating the order is bookkeeping for that sale.
		doc.save(ignore_permissions=True)
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		raise
	return {"order": order_to_dict(doc), "invoice": invoice}


def _order_cart_items(doc):
	return [
		{"item_code": row.item_code, "qty": row.qty, "uom": row.uom, "item_note": row.note}
		for row in doc.get("items") or []
	]


def preview_order(order, customer=None):
	"""Price an open order exactly as checkout will, without saving anything.

	Uses the service type's price list, offers (pricing rules) and taxes, such
	as a Dine In service charge. Unlike invoice preview it needs no open shift,
	so waiters can show the bill. Stock is checked at checkout, not here.
	"""
	doc, profile = _load_order(order)
	if not doc.get("items"):
		_throw("ORDER_EMPTY", _("Add at least one item before previewing the order"), {"order": doc.name})
	invoice, profile = _build_invoice_doc(
		pos_profile=profile.name,
		customer=customer or doc.customer,
		service_type=doc.service_type,
	)
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
		filters={"pos_profile": profile.name, "is_active": 1},
		fields=["name", "table_label", "floor", "seats"],
		order_by="table_label asc",
	)
	orders_by_table = {}
	for row in frappe.get_all(
		ORDER_DOCTYPE,
		filters={"pos_profile": profile.name, "status": STATUS_OPEN, "restaurant_table": ["is", "set"]},
		fields=["name", "restaurant_table", "service_type", "pax", "waiter", "opened_at"],
		order_by="opened_at asc",
	):
		orders_by_table.setdefault(row.restaurant_table, []).append(
			{
				"name": row.name,
				"service_type": row.service_type,
				"pax": cint(row.pax),
				"waiter": row.waiter,
				"waiter_name": waiter_name(row.waiter),
				"opened_at": row.opened_at,
			}
		)
	return [
		{
			"table": table.name,
			"table_label": table.table_label,
			"floor": table.floor,
			"seats": cint(table.seats),
			"status": "Occupied" if orders_by_table.get(table.name) else "Free",
			"orders": orders_by_table.get(table.name, []),
		}
		for table in tables
	]
