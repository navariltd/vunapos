import json
import math
from datetime import date
from decimal import Decimal, InvalidOperation

import frappe
from erpnext.accounts.doctype.loyalty_program.loyalty_program import validate_loyalty_points
from erpnext.stock.doctype.stock_reservation_entry.stock_reservation_entry import (
	get_sre_reserved_qty_for_item_and_warehouse,
)
from erpnext.stock.get_item_details import get_item_details, get_item_tax_map
from erpnext.stock.utils import get_stock_balance
from frappe import _
from frappe.utils import cint, cstr, flt, get_datetime, getdate, now_datetime, nowdate

from vunapos.dto.invoice import invoice_to_dict
from vunapos.services.batch_service import allocate_batches as allocate_item_batches
from vunapos.services.batch_service import (
	auto_allocate_serials,
	get_item_batches,
	get_item_tracking_flags,
	validate_batch_allocation,
	validate_serial_allocation,
)
from vunapos.services.checkout_queue_service import (
	QUEUE_STATUS_PROCESSING,
	QUEUE_STATUS_QUEUED,
	enqueue_invoice_submission,
	find_invoice_by_idempotency_key,
	get_queue_limits,
)
from vunapos.services.customer_service import validate_customer_address
from vunapos.services.gateway_payment_service import (
	consume_gateway_payment_links,
	gateway_payment_metadata,
	payment_mode_gateway,
	validate_gateway_payment_link,
)
from vunapos.services.pin_service import consume_pin_token, validate_pin_token
from vunapos.services.price_list_service import resolve_price_list
from vunapos.services.profile_service import (
	get_invoice_mode,
	require_open_pos_session,
	resolve_pos_profile,
)
from vunapos.services.stock_reservation_service import (
	create_invoice_stock_reservations,
	validate_invoice_stock_reservations,
)
from vunapos.utils.permissions import require_create, require_read, require_write

SUPPORTED_INVOICE_DOCTYPES = ("Sales Invoice", "POS Invoice")
SUPPORTED_ORDER_DOCTYPES = ("Sales Order",)
HELD_FIELD = "vunapos_held"
VUNAPOS_FIELD = "vunapos_invoice"
IDEMPOTENCY_FIELD = "vunapos_idempotency_key"
CREDIT_SALE_FIELD = "vunapos_credit_sale"
OPENING_ENTRY_FIELD = "vunapos_opening_entry"
SESSION_CASHIER_FIELD = "vunapos_session_cashier"
SESSION_VERIFIED_AT_FIELD = "vunapos_session_verified_at"


def _stamp_salesperson(doc, profile, salesperson=None, salesperson_token=None):
	if not profile.get("vunapos_enable_salesperson_pin"):
		return
	if not salesperson and _has_field(doc.doctype, "sales_team") and doc.get("sales_team"):
		salesperson = doc.sales_team[0].get("sales_person")
	if not salesperson:
		_throw("SALESPERSON_REQUIRED", _("Verify a salesperson PIN before completing this sale."))
	if not salesperson_token and doc.get("vunapos_queue_status") not in ("Queued", "Processing"):
		_throw("PIN_TOKEN_REQUIRED", _("Verify a salesperson PIN before completing this sale."))
	if salesperson_token:
		validate_pin_token(salesperson_token, profile, "salesperson", salesperson)
	if not frappe.db.exists("Sales Person", salesperson):
		_throw("INVALID_SALESPERSON", _("The selected salesperson does not exist."))
	row = next(
		(
			row
			for row in profile.get("vunapos_pin_users", [])
			if row.get("enabled")
			and row.get("role") == "Salesperson"
			and row.get("sales_person") == salesperson
		),
		None,
	)
	if not row:
		_throw("INVALID_SALESPERSON", _("The selected salesperson is not enabled for this POS Profile."))
	if _has_field(doc.doctype, "sales_team"):
		doc.set("sales_team", [])
		team_row = doc.append("sales_team", {})
		team_row.sales_person = salesperson
		team_row.allocated_percentage = 100


def _throw(code, message, meta=None):
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	exc.vuna_error_meta = meta or {}
	raise exc


def _validate_invoice_doctype(invoice_doctype):
	if invoice_doctype not in SUPPORTED_INVOICE_DOCTYPES:
		frappe.throw(_("Unsupported invoice doctype: {0}").format(invoice_doctype))


def _has_field(doctype, fieldname):
	return frappe.get_meta(doctype).has_field(fieldname)


def _set_if_has_field(doc, fieldname, value):
	if _has_field(doc.doctype, fieldname):
		doc.set(fieldname, value)


def _stamp_validated_session(doc, opening_entry, verified_at=None):
	_set_if_has_field(doc, OPENING_ENTRY_FIELD, opening_entry.name)
	_set_if_has_field(doc, SESSION_CASHIER_FIELD, opening_entry.user)
	_set_if_has_field(doc, SESSION_VERIFIED_AT_FIELD, verified_at or now_datetime())
	return doc


def _reset_invoice_totals(doc):
	for fieldname in (
		"net_total",
		"base_net_total",
		"total",
		"base_total",
		"grand_total",
		"base_grand_total",
		"rounded_total",
		"base_rounded_total",
		"total_taxes_and_charges",
		"base_total_taxes_and_charges",
		"outstanding_amount",
		"paid_amount",
		"change_amount",
	):
		_set_if_has_field(doc, fieldname, 0)
	return doc


def _apply_item_tax_inclusivity(doc):
	profile_name = doc.get("pos_profile") or doc.get("vunapos_pos_profile")
	if not profile_name:
		return
	prices_include_tax = bool(
		frappe.get_cached_value("POS Profile", profile_name, "vunapos_item_prices_include_tax")
	)
	for tax in doc.get("taxes", []):
		if tax.get("set_by_item_tax_template"):
			tax.included_in_print_rate = prices_include_tax


def _recalculate(doc):
	_ensure_controller_item_attrs(doc)
	if hasattr(doc, "set_missing_values"):
		doc.set_missing_values()
	if hasattr(doc, "append_taxes_from_item_tax_template"):
		doc.append_taxes_from_item_tax_template()
	_apply_item_tax_inclusivity(doc)
	if hasattr(doc, "calculate_taxes_and_totals"):
		doc.calculate_taxes_and_totals()
	if hasattr(doc, "set_total_in_words"):
		doc.set_total_in_words()
	return doc


def _ensure_controller_item_attrs(doc):
	for item in doc.get("items", []):
		if not hasattr(item, "against_pick_list"):
			item.against_pick_list = None
		if not hasattr(item, "pick_list_item"):
			item.pick_list_item = None


def _sync_profile_pricing_fields(doc, profile, requested_price_list=None):
	price_list = resolve_price_list(
		profile,
		customer=doc.get("customer"),
		requested_price_list=requested_price_list,
	)
	_set_if_has_field(doc, "selling_price_list", price_list)
	_set_if_has_field(doc, "currency", profile.currency)
	_set_if_has_field(doc, "taxes_and_charges", profile.get("taxes_and_charges"))
	_set_if_has_field(doc, "ignore_pricing_rule", profile.get("ignore_pricing_rule"))
	return doc


def _sync_invoice_item_pricing(doc, profile):
	for row in doc.get("items", []):
		details = _get_item_row(
			row.item_code,
			row.qty,
			doc,
			profile,
			item_tax_template=row.get("item_tax_template"),
			pricing_item={"uom": row.get("uom")},
		)
		for fieldname in (
			"uom",
			"stock_uom",
			"conversion_factor",
			"rate",
			"price_list_rate",
			"item_tax_template",
			"item_tax_rate",
		):
			if details.get(fieldname) is not None and row.meta.has_field(fieldname):
				row.set(fieldname, details.get(fieldname))
	return doc


def _save_invoice(doc):
	if doc.get("items"):
		if doc.get("pos_profile"):
			profile = resolve_pos_profile(doc.get("pos_profile"))
			_sync_profile_pricing_fields(doc, profile, doc.get("selling_price_list"))
			_sync_invoice_item_pricing(doc, profile)
		_recalculate(doc)
	doc.flags.ignore_mandatory = not bool(doc.get("items"))
	doc.save()
	if doc.get("items"):
		_materialize_batch_bundles(doc)
	return doc


def _load_draft_invoice(invoice_doctype, invoice_name):
	_validate_invoice_doctype(invoice_doctype)
	require_read(invoice_doctype, invoice_name)
	doc = frappe.get_doc(invoice_doctype, invoice_name)
	if doc.docstatus != 0:
		_throw("INVOICE_ALREADY_SUBMITTED", _("Invoice {0} is not a draft").format(invoice_name))
	if doc.get("vunapos_queue_status"):
		_throw(
			"INVOICE_QUEUE_LOCKED",
			_("Invoice {0} is already queued for submission").format(invoice_name),
		)
	require_write(invoice_doctype, invoice_name)
	return doc


def _load_checkout_invoice(invoice_doctype, invoice_name):
	_validate_invoice_doctype(invoice_doctype)
	require_read(invoice_doctype, invoice_name)
	doc = frappe.get_doc(invoice_doctype, invoice_name)
	if doc.docstatus == 0:
		require_write(invoice_doctype, invoice_name)
	return doc


def _find_submitted_invoice_by_idempotency_key(idempotency_key):
	doc = find_invoice_by_idempotency_key(idempotency_key, SUPPORTED_INVOICE_DOCTYPES)
	if not doc or doc.docstatus != 1:
		return None
	require_read(doc.doctype, doc.name)
	return doc


def _find_submitted_order_by_idempotency_key(idempotency_key):
	doc = find_invoice_by_idempotency_key(idempotency_key, SUPPORTED_ORDER_DOCTYPES)
	if not doc or doc.docstatus != 1:
		return None
	require_read(doc.doctype, doc.name)
	return doc


def _payment_rows(payments):
	if isinstance(payments, str):
		payments = json.loads(payments or "[]")
	return payments or []


def _invoice_total_for_payment(doc):
	return max(
		flt(doc.get("rounded_total") or doc.get("grand_total") or 0) - flt(doc.get("loyalty_amount")),
		0,
	)


def _apply_loyalty_redemption(doc, loyalty_points=None):
	if loyalty_points in (None, "", 0, "0"):
		_set_if_has_field(doc, "redeem_loyalty_points", 0)
		_set_if_has_field(doc, "loyalty_points", 0)
		_set_if_has_field(doc, "loyalty_amount", 0)
		_set_if_has_field(doc, "loyalty_redemption_account", None)
		_set_if_has_field(doc, "loyalty_redemption_cost_center", None)
		return doc
	if isinstance(loyalty_points, bool):
		_throw("INVALID_LOYALTY_POINTS", _("Enter a valid whole number of loyalty points"))
	try:
		points = Decimal(str(loyalty_points))
	except (InvalidOperation, TypeError, ValueError):
		_throw("INVALID_LOYALTY_POINTS", _("Enter a valid whole number of loyalty points"))
	if not points.is_finite() or points <= 0 or points != points.to_integral_value():
		_throw("INVALID_LOYALTY_POINTS", _("Loyalty points must be a positive whole number"))
	if not doc.get("customer") or not frappe.db.get_value("Customer", doc.get("customer"), "loyalty_program"):
		_throw(
			"CUSTOMER_NOT_ENROLLED_IN_LOYALTY",
			_("The selected customer is not enrolled in a Loyalty Program"),
		)

	_set_if_has_field(doc, "redeem_loyalty_points", 1)
	_set_if_has_field(doc, "loyalty_points", 0)
	_set_if_has_field(doc, "loyalty_amount", 0)
	validate_loyalty_points(doc, int(points))
	return doc


def _currency_precision(doc):
	for fieldname in ("rounded_total", "grand_total"):
		try:
			precision = doc.precision(fieldname)
			if precision is not None:
				return precision
		except Exception:
			pass
	return 2


def _valid_payment_modes(profile):
	return {row.mode_of_payment for row in profile.get("payments", []) if row.get("mode_of_payment")}


def _payment_mode_type(mode_of_payment):
	return frappe.get_cached_value("Mode of Payment", mode_of_payment, "type") or "General"


def _has_gateway_payment_rows(payments, profile):
	rows = _payment_rows(payments)
	if not rows or not profile:
		return False
	return any(
		payment_mode_gateway(profile, row.get("mode_of_payment")) for row in rows if isinstance(row, dict)
	)


def _validate_credit_sale_request(profile, is_credit_sale=False, customer=None):
	is_credit_sale = bool(cint(is_credit_sale))
	if not is_credit_sale:
		return False
	if not profile or not profile.get("vunapos_allow_credit_sales"):
		_throw("CREDIT_SALES_NOT_ALLOWED", _("Credit sales are not allowed for this POS Profile"))
	if not customer:
		_throw("CREDIT_CUSTOMER_REQUIRED", _("Select a customer before completing a credit sale"))
	return True


def _validate_credit_due_date(is_credit_sale, due_date=None, posting_date=None):
	if not is_credit_sale:
		return None
	if not due_date:
		_throw("CREDIT_DUE_DATE_REQUIRED", _("Select a payment due date for this credit sale"))
	try:
		parsed_due_date = due_date if isinstance(due_date, date) else date.fromisoformat(str(due_date))
	except (TypeError, ValueError):
		_throw("CREDIT_DUE_DATE_INVALID", _("Enter a valid payment due date"))
	posting_date = getdate(posting_date or nowdate())
	if parsed_due_date < posting_date:
		_throw(
			"CREDIT_DUE_DATE_INVALID",
			_("Payment due date cannot be before the invoice posting date"),
		)
	return parsed_due_date


def _normalize_checkout_tax_id(tax_id):
	tax_id = cstr(tax_id or "").strip()
	if len(tax_id) > 140:
		_throw("TAX_ID_TOO_LONG", _("Tax ID cannot exceed 140 characters"))
	return tax_id or None


def _customer_accepts_checkout_tax_id(customer):
	return bool(customer and frappe.db.get_value("Customer", customer, "is_walkin"))


def _apply_checkout_tax_id(doc, tax_id=None, *, persist=False):
	tax_id = _normalize_checkout_tax_id(tax_id)
	if not tax_id:
		return doc
	if not _customer_accepts_checkout_tax_id(doc.get("customer")):
		_throw(
			"CUSTOMER_TAX_ID_NOT_ALLOWED",
			_("Checkout Tax ID can only be entered for customers marked as walk-in"),
		)
	_set_if_has_field(doc, "tax_id", tax_id)
	if persist and _has_field(doc.doctype, "tax_id") and doc.get("name"):
		doc.db_set("tax_id", tax_id, update_modified=False)
	return doc


def _apply_shipping_address(doc, shipping_address_name=None, *, persist=False):
	"""Validate and apply a customer-linked shipping address to a transaction."""
	address_name = cstr(shipping_address_name or "").strip()
	if not address_name:
		return doc
	profile_name = doc.get("pos_profile")
	validate_customer_address(
		pos_profile=profile_name,
		customer=doc.get("customer"),
		address_name=address_name,
	)
	_set_if_has_field(doc, "shipping_address_name", address_name)
	if persist and _has_field(doc.doctype, "shipping_address_name") and doc.get("name"):
		doc.db_set("shipping_address_name", address_name, update_modified=False)
	return doc


def _apply_credit_sale_fields(doc, is_credit_sale, due_date=None):
	_set_if_has_field(doc, CREDIT_SALE_FIELD, is_credit_sale)
	if is_credit_sale:
		_set_if_has_field(
			doc,
			"due_date",
			_validate_credit_due_date(True, due_date, doc.get("posting_date")),
		)
	return doc


def validate_payment_rows(
	doc,
	payments=None,
	profile=None,
	is_credit_sale=False,
	opening_entry=None,
	allow_partial_override=False,
):
	is_credit_sale = _validate_credit_sale_request(profile, is_credit_sale, doc.get("customer"))
	rows = _payment_rows(payments)
	precision = _currency_precision(doc)
	expected_total = flt(_invoice_total_for_payment(doc), precision)
	if not isinstance(rows, list):
		_throw("NO_PAYMENT_ROWS", _("Payment rows must be a list"))
	if not rows and expected_total <= 0:
		return []
	if not rows and (is_credit_sale or allow_partial_override):
		return []
	if not rows:
		_throw("NO_PAYMENT_ROWS", _("At least one payment row is required"))

	valid_modes = _valid_payment_modes(profile) if profile else set()
	seen_modes = set()
	total_paid = Decimal("0")
	non_cash_paid = Decimal("0")
	validated_rows = []
	for row in rows:
		if not isinstance(row, dict):
			_throw("INVALID_PAYMENT_MODE", _("Each payment row must be an object"))

		mode_of_payment = row.get("mode_of_payment")
		if not isinstance(mode_of_payment, str) or not mode_of_payment.strip():
			_throw("INVALID_PAYMENT_MODE", _("Payment mode is required"))
		mode_of_payment = mode_of_payment.strip()
		if profile is not None and mode_of_payment not in valid_modes:
			_throw(
				"INVALID_PAYMENT_MODE",
				_("Payment mode {0} is not allowed for this POS Profile").format(mode_of_payment),
			)
		if mode_of_payment in seen_modes:
			_throw(
				"DUPLICATE_PAYMENT_MODE",
				_("Payment mode {0} can only be used once").format(mode_of_payment),
			)
		payment_gateway = payment_mode_gateway(profile, mode_of_payment) if profile else None

		raw_amount = row.get("amount")
		storage_amount = None
		amount = None
		if not payment_gateway or raw_amount not in (None, ""):
			try:
				if isinstance(raw_amount, bool):
					raise InvalidOperation
				amount = Decimal(str(raw_amount))
			except (InvalidOperation, TypeError, ValueError):
				_throw("INVALID_PAYMENT_AMOUNT", _("Payment amount must be a valid number"))
			if not amount.is_finite() or amount <= 0:
				_throw("INVALID_PAYMENT_AMOUNT", _("Payment amount must be greater than zero"))
			storage_amount = float(amount)
			if not math.isfinite(storage_amount):
				_throw("INVALID_PAYMENT_AMOUNT", _("Payment amount is outside the supported range"))
		gateway_link = None
		if payment_gateway:
			if not opening_entry:
				_throw(
					"GATEWAY_PAYMENT_SESSION_MISMATCH", _("Gateway payments require an active POS session")
				)
			gateway_link = validate_gateway_payment_link(
				row.get("gateway_payment_link"),
				profile=profile,
				opening_entry=opening_entry,
				mode_of_payment=mode_of_payment,
				payment_gateway=payment_gateway,
				customer=doc.get("customer"),
				amount=storage_amount if amount is not None else None,
				currency=doc.get("currency"),
				precision=precision,
			)
			storage_amount = flt(gateway_link.amount, precision)
			amount = Decimal(str(storage_amount))

		seen_modes.add(mode_of_payment)
		total_paid += amount
		if _payment_mode_type(mode_of_payment) != "Cash":
			non_cash_paid += amount
		validated_rows.append(
			{
				"mode_of_payment": mode_of_payment,
				"amount": storage_amount,
				"default": row.get("default"),
				"gateway_payment_link": gateway_link.name if gateway_link else None,
			}
		)

	paid_total = flt(total_paid, precision)
	non_cash_total = flt(non_cash_paid, precision)
	allow_partial_payment = bool(profile and profile.get("allow_partial_payment")) or allow_partial_override
	if non_cash_total > expected_total:
		_throw(
			"NON_CASH_OVERPAYMENT",
			_("Electronic payments cannot exceed the invoice total"),
			{"expected_total": expected_total, "non_cash_total": non_cash_total, "precision": precision},
		)
	if paid_total < expected_total and not (allow_partial_payment or is_credit_sale):
		_throw(
			"PAYMENT_TOTAL_MISMATCH",
			_("Payment total must cover the invoice total"),
			{"expected_total": expected_total, "paid_total": paid_total, "precision": precision},
		)

	return validated_rows


def _cart_item_rows(items):
	if isinstance(items, str):
		items = json.loads(items or "[]")
	return items or []


def _resolve_item_uom(item_code, uom=None):
	item = frappe.get_cached_doc("Item", item_code)
	uom = uom or item.get("sales_uom") or item.stock_uom
	if uom == item.stock_uom:
		return uom, 1.0
	for row in item.get("uoms", []):
		if row.uom == uom and flt(row.conversion_factor) > 0:
			return uom, flt(row.conversion_factor)
	_throw("INVALID_ITEM_UOM", _("UOM {0} is not configured for item {1}.").format(uom, item_code))


def _get_cart_item_qtys(items):
	item_qtys = {}
	for item in _cart_item_rows(items):
		item_code = item.get("item_code")
		qty = flt(item.get("qty") or 0)
		if not item_code:
			frappe.throw(_("Item code is required"))
		if qty <= 0:
			frappe.throw(_("Quantity for item {0} must be greater than zero").format(item_code))
		_unused_uom, conversion_factor = _resolve_item_uom(item_code, item.get("uom"))
		item_qtys[item_code] = item_qtys.get(item_code, 0) + qty * conversion_factor
	return item_qtys


def _validate_stock_qtys(item_qtys, profile):
	if not item_qtys:
		frappe.throw(_("Cannot submit an empty cart"))

	for item_code, qty in item_qtys.items():
		item = frappe.get_cached_doc("Item", item_code)
		if not item.is_stock_item or item.allow_negative_stock:
			continue

		actual_qty = _get_actual_qty(item_code, profile.warehouse)
		if actual_qty < qty:
			if item.get("has_batch_no"):
				_throw(
					"INSUFFICIENT_BATCH_STOCK",
					_("Only {0} units are available across valid batches for {1}.").format(
						actual_qty, item_code
					),
					{"requested_qty": qty, "available_qty": actual_qty},
				)
			frappe.throw(
				_("Insufficient stock for {0}. Available quantity is {1}.").format(item_code, actual_qty)
			)


def _get_actual_qty(item_code, warehouse):
	if not warehouse:
		return 0
	stock_balance = flt(get_stock_balance(item_code, warehouse))
	reserved_stock = flt(get_sre_reserved_qty_for_item_and_warehouse(item_code, warehouse))
	return max(stock_balance - reserved_stock, 0)


def validate_cart_items(items, profile):
	delivery_charge_item = profile.get("vunapos_delivery_charge_item")
	if delivery_charge_item:
		matches = [item for item in items if item.get("item_code") == delivery_charge_item]
		if len(matches) > 1:
			_throw(
				"DUPLICATE_DELIVERY_CHARGE",
				_("Only one Delivery Charge line is allowed on an invoice"),
			)
	item_qtys = _get_cart_item_qtys(items)
	_validate_stock_qtys(item_qtys, profile)
	return item_qtys


def _pricing_override(item):
	override = item.get("pricing_override")
	if isinstance(override, str):
		override = json.loads(override or "{}")
	return override or None


def _apply_pricing_override(row, item, profile):
	override = _pricing_override(item)
	if not override:
		return row
	kind = override.get("type")
	try:
		value = Decimal(str(override.get("value")))
	except (InvalidOperation, TypeError, ValueError):
		_throw("INVALID_PRICE_OVERRIDE", _("The price override must be a valid number"))
	if not value.is_finite() or value < 0:
		_throw("INVALID_PRICE_OVERRIDE", _("The price override cannot be negative"))
	value = float(value)
	price_list_rate = flt(row.get("price_list_rate") or row.get("rate"))
	if kind == "rate":
		is_delivery_charge = item.get("item_code") == profile.get("vunapos_delivery_charge_item")
		if not profile.get("allow_rate_change") and not (
			is_delivery_charge and profile.get("vunapos_allow_delivery_charge_change")
		):
			_throw("RATE_CHANGE_NOT_ALLOWED", _("Rate changes are not allowed for this POS Profile"))
		row["rate"] = value
		row["discount_percentage"] = 0
		row["discount_amount"] = 0
	elif kind == "discount_percentage":
		if not profile.get("allow_discount_change"):
			_throw("DISCOUNT_CHANGE_NOT_ALLOWED", _("Discount changes are not allowed for this POS Profile"))
		if value > 100:
			_throw("INVALID_PRICE_OVERRIDE", _("Discount percentage cannot exceed 100"))
		row["discount_percentage"] = value
		row["discount_amount"] = flt(price_list_rate * value / 100)
		row["rate"] = flt(price_list_rate - row["discount_amount"])
	elif kind == "discount_amount":
		if not profile.get("allow_discount_change"):
			_throw("DISCOUNT_CHANGE_NOT_ALLOWED", _("Discount changes are not allowed for this POS Profile"))
		if value > price_list_rate:
			_throw("INVALID_PRICE_OVERRIDE", _("Discount amount cannot exceed the price-list rate"))
		row["discount_amount"] = value
		row["discount_percentage"] = flt(value / price_list_rate * 100) if price_list_rate else 0
		row["rate"] = flt(price_list_rate - value)
	else:
		_throw("INVALID_PRICE_OVERRIDE", _("Unsupported price override type"))
	return row


def _get_item_row(item_code, qty, doc, profile, item_tax_template=None, pricing_item=None):
	item = frappe.get_cached_doc("Item", item_code)
	if not item.is_stock_item and not profile.get("vunapos_allow_service_items"):
		allowed_delivery_items = {value for value in (profile.get("vunapos_delivery_charge_item"),) if value}
		if not (profile.get("vunapos_allow_delivery_charges") and item_code in allowed_delivery_items):
			_throw("SERVICE_ITEMS_DISABLED", _("Service items are disabled for this POS Profile"))
	if item_code == profile.get("vunapos_delivery_charge_item") and item.is_stock_item:
		_throw(
			"INVALID_DELIVERY_CHARGE_ITEM",
			_("The configured Delivery Charge Item must have Maintain Stock disabled"),
		)
	uom, conversion_factor = _resolve_item_uom(item_code, (pricing_item or {}).get("uom"))
	ctx = frappe._dict(
		{
			"doctype": doc.doctype,
			"child_doctype": f"{doc.doctype} Item",
			"item_code": item_code,
			"item_tax_template": item_tax_template,
			"company": doc.company,
			"customer": doc.customer,
			"selling_price_list": doc.selling_price_list,
			"price_list": doc.selling_price_list,
			"currency": doc.currency,
			"conversion_rate": doc.get("conversion_rate") or 1,
			"plc_conversion_rate": doc.get("plc_conversion_rate") or 1,
			"warehouse": profile.warehouse,
			"qty": flt(qty),
			"uom": uom,
			"conversion_factor": conversion_factor,
			"is_pos": doc.get("is_pos"),
			"update_stock": doc.get("update_stock"),
			"ignore_pricing_rule": doc.get("ignore_pricing_rule"),
		}
	)
	details = get_item_details(ctx, doc=doc)
	row = {
		"item_code": item_code,
		"qty": flt(qty),
		"uom": details.get("uom"),
		"stock_uom": details.get("stock_uom"),
		"conversion_factor": details.get("conversion_factor") or 1,
		"warehouse": profile.warehouse or details.get("warehouse"),
		"rate": flt(details.get("rate") or details.get("price_list_rate") or 0),
		"against_pick_list": None,
		"pick_list_item": None,
	}
	row["uom"] = uom
	row["conversion_factor"] = conversion_factor
	for fieldname in (
		"item_name",
		"description",
		"income_account",
		"expense_account",
		"cost_center",
		"item_tax_template",
		"item_tax_rate",
		"price_list_rate",
		"pricing_rules",
	):
		if details.get(fieldname) is not None:
			row[fieldname] = details.get(fieldname)
	if item_tax_template:
		row["item_tax_template"] = item_tax_template
		if not row.get("item_tax_rate"):
			row["item_tax_rate"] = get_item_tax_map(doc=doc, tax_template=item_tax_template, as_json=True)
	return _apply_pricing_override(row, pricing_item or {}, profile)


def _apply_vunapos_item_metadata(row, item):
	note = cstr(item.get("item_note") or "").strip()
	if len(note) > 500:
		_throw("ITEM_NOTE_TOO_LONG", _("Item notes cannot exceed 500 characters"))
	if row.meta.has_field("vunapos_item_note"):
		row.vunapos_item_note = note or None
	override = _pricing_override(item)
	if row.meta.has_field("vunapos_pricing_override"):
		row.vunapos_pricing_override = (
			_("{0}: {1}").format(override.get("type"), override.get("value")) if override else None
		)
	if row.meta.has_field("vunapos_pricing_override_by"):
		row.vunapos_pricing_override_by = frappe.session.user if override else None
	return row


def _has_vunapos_pricing_override(row):
	return row.meta.has_field("vunapos_pricing_override") and bool(row.get("vunapos_pricing_override"))


def _rate_matches_pricing_rule_discount(row, precision):
	if not row.get("pricing_rules") or _has_vunapos_pricing_override(row):
		return False
	price_list_rate = flt(row.get("price_list_rate") or 0, precision)
	rate = flt(row.get("rate") or 0, precision)
	discount_amount = flt(row.get("discount_amount") or 0, precision)
	discount_percentage = flt(row.get("discount_percentage") or 0, precision)
	if discount_amount:
		return rate == flt(price_list_rate - discount_amount, precision)
	if discount_percentage:
		return rate == flt(price_list_rate - (price_list_rate * discount_percentage / 100), precision)
	return False


def _set_row_batch_allocations(row, allocations):
	row.flags.vunapos_batch_allocations = allocations or []


def _set_row_serial_allocations(row, allocations):
	row.flags.vunapos_serial_allocations = allocations or []


def _get_row_serial_allocations(row):
	if getattr(row.flags, "vunapos_serial_allocations", None):
		return row.flags.vunapos_serial_allocations
	if row.get("serial_and_batch_bundle") and frappe.db.exists(
		"Serial and Batch Bundle", row.serial_and_batch_bundle
	):
		bundle = frappe.get_doc("Serial and Batch Bundle", row.serial_and_batch_bundle)
		return [
			{"serial_no": entry.serial_no, "batch_no": entry.get("batch_no")}
			for entry in bundle.get("entries", [])
			if entry.get("serial_no")
		]
	return []


def _get_row_batch_allocations(row):
	if getattr(row.flags, "vunapos_batch_allocations", None):
		return row.flags.vunapos_batch_allocations
	if row.get("serial_and_batch_bundle"):
		return _get_bundle_allocations(row.serial_and_batch_bundle)
	if row.get("batch_no"):
		return [
			{
				"batch_no": row.batch_no,
				"qty": flt(row.qty),
				"expiry_date": frappe.db.get_value("Batch", row.batch_no, "expiry_date"),
				"available_qty": None,
			}
		]
	return []


def _get_bundle_allocations(bundle_name):
	allocations = []
	if not bundle_name or not frappe.db.exists("Serial and Batch Bundle", bundle_name):
		return allocations
	bundle = frappe.get_doc("Serial and Batch Bundle", bundle_name)
	for entry in bundle.get("entries", []):
		if not entry.get("batch_no"):
			continue
		allocations.append(
			{
				"batch_no": entry.batch_no,
				"qty": abs(flt(entry.qty)),
				"expiry_date": frappe.db.get_value("Batch", entry.batch_no, "expiry_date"),
				"available_qty": None,
			}
		)
	return allocations


def _reserved_batch_qtys(doc):
	reserved = {}
	for row in doc.get("items", []):
		for allocation in _get_row_batch_allocations(row):
			key = (row.item_code, row.get("warehouse"), allocation.get("batch_no"))
			reserved[key] = reserved.get(key, 0) + flt(allocation.get("qty"))
	return reserved


def _allocate_batches_for_doc(item_code, qty, warehouse, reserved):
	remaining_qty = flt(qty)
	allocations = []
	for batch in get_item_batches(item_code, warehouse=warehouse).get("batches", []):
		if remaining_qty <= 0:
			break
		key = (item_code, warehouse, batch.get("batch_no"))
		available_qty = flt(batch.get("available_qty")) - flt(reserved.get(key))
		allocated_qty = min(available_qty, remaining_qty)
		if allocated_qty <= 0:
			continue
		allocation = {
			"batch_no": batch.get("batch_no"),
			"qty": allocated_qty,
			"expiry_date": batch.get("expiry_date"),
			"available_qty": flt(batch.get("available_qty")),
		}
		allocations.append(allocation)
		reserved[key] = flt(reserved.get(key)) + allocated_qty
		remaining_qty -= allocated_qty

	allocated_qty = sum(flt(row["qty"]) for row in allocations)
	if flt(allocated_qty) < flt(qty):
		_throw(
			"INSUFFICIENT_BATCH_STOCK",
			_("Only {0} units are available across valid batches for {1}.").format(allocated_qty, item_code),
			{"requested_qty": qty, "available_qty": allocated_qty},
		)
	return allocations


def _manual_batch_allocations(item_code, qty, warehouse, allocations):
	allocations = allocations or []
	validate_batch_allocation(item_code, qty, allocations, warehouse=warehouse)
	available = {
		row["batch_no"]: row for row in get_item_batches(item_code, warehouse=warehouse).get("batches", [])
	}
	return [
		{
			"batch_no": allocation.get("batch_no"),
			"qty": flt(allocation.get("qty")),
			"expiry_date": available[allocation.get("batch_no")].get("expiry_date"),
			"available_qty": flt(available[allocation.get("batch_no")].get("available_qty")),
		}
		for allocation in allocations
	]


def _apply_batch_allocation(row, doc, profile, qty=None):
	flags = get_item_tracking_flags(row.item_code)
	if flags["requires_serial"]:
		serials = auto_allocate_serials(
			row.item_code,
			qty or flt(row.qty) * flt(row.get("conversion_factor") or 1),
			warehouse=profile.warehouse or row.get("warehouse"),
		)
		_set_row_serial_allocations(row, serials)
		return row
	if not flags["requires_batch"]:
		return row

	allocation = allocate_item_batches(
		row.item_code,
		qty or flt(row.qty) * flt(row.get("conversion_factor") or 1),
		warehouse=profile.warehouse or row.get("warehouse"),
		strategy="FEFO",
	)
	allocations = allocation.get("allocations", [])
	_set_row_batch_allocations(row, allocations)
	if len(allocations) == 1:
		row.batch_no = allocations[0]["batch_no"]
		if row.meta.has_field("actual_batch_qty"):
			row.actual_batch_qty = allocations[0]["qty"]
	return row


def _create_serial_and_batch_bundle_for_row(doc, row, allocations):
	serial_allocations = _get_row_serial_allocations(row)
	if not row.meta.has_field("serial_and_batch_bundle") or (
		not serial_allocations and (not allocations or len(allocations) <= 1)
	):
		return None
	if row.get("serial_and_batch_bundle"):
		bundle = frappe.get_doc("Serial and Batch Bundle", row.serial_and_batch_bundle)
	else:
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		bundle = frappe.new_doc("Serial and Batch Bundle")
	bundle.item_code = row.item_code
	bundle.warehouse = row.get("warehouse")
	bundle.company = doc.company
	bundle.has_batch_no = int(bool(allocations or any(entry.get("batch_no") for entry in serial_allocations)))
	bundle.has_serial_no = int(bool(serial_allocations))
	bundle.voucher_type = doc.doctype
	bundle.voucher_no = doc.name
	bundle.voucher_detail_no = row.name
	bundle.type_of_transaction = "Outward"
	posting_date = doc.get("posting_date") or doc.get("transaction_date") or nowdate()
	bundle.posting_datetime = get_datetime(f"{posting_date} {doc.get('posting_time') or '00:00:00'}")
	bundle.set("entries", [])
	entries = serial_allocations or allocations
	for allocation in entries:
		bundle.append(
			"entries",
			{
				"serial_no": allocation.get("serial_no"),
				"batch_no": allocation.get("batch_no"),
				"qty": -1 if allocation.get("serial_no") else -abs(flt(allocation["qty"])),
				"warehouse": row.get("warehouse"),
			},
		)
	if bundle.is_new():
		bundle.insert(ignore_permissions=True)
	else:
		bundle.save(ignore_permissions=True)
	frappe.db.set_value(row.doctype, row.name, "serial_and_batch_bundle", bundle.name)
	row.serial_and_batch_bundle = bundle.name
	row.batch_no = None
	frappe.db.set_value(row.doctype, row.name, "batch_no", None)
	return bundle.name


def _materialize_batch_bundles(doc):
	changed = False
	for row in doc.get("items", []):
		allocations = _get_row_batch_allocations(row)
		if len(allocations) > 1 or _get_row_serial_allocations(row):
			_create_serial_and_batch_bundle_for_row(doc, row, allocations)
			changed = True
	if changed:
		doc.save(ignore_permissions=True)
	return doc


def validate_invoice_batch_allocations(doc):
	# Sales Orders do not issue stock. Batch/serial allocation is performed when
	# a stock transaction is created from the order, not during POS order entry.
	if doc.doctype == "Sales Order":
		return
	allocated_by_batch = {}
	for row in doc.get("items", []):
		flags = get_item_tracking_flags(row.item_code)
		if flags["requires_serial"]:
			validate_serial_allocation(
				row.item_code,
				flt(row.qty) * flt(row.get("conversion_factor") or 1),
				_get_row_serial_allocations(row),
				warehouse=row.get("warehouse"),
			)
			continue
		if not flags["requires_batch"]:
			continue
		allocations = _get_row_batch_allocations(row)
		if not allocations:
			_throw(
				"BATCH_ALLOCATION_REQUIRED",
				_("Batch allocation is required for item {0}.").format(row.item_code),
			)
		validate_batch_allocation(
			row.item_code,
			flt(row.qty) * flt(row.get("conversion_factor") or 1),
			allocations,
			warehouse=row.get("warehouse"),
		)
		for allocation in allocations:
			key = (row.item_code, row.get("warehouse"), allocation.get("batch_no"))
			allocated_by_batch[key] = allocated_by_batch.get(key, 0) + flt(allocation.get("qty"))

	for (item_code, warehouse, batch_no), allocated_qty in allocated_by_batch.items():
		available = {
			row["batch_no"]: row
			for row in get_item_batches(item_code, warehouse=warehouse).get("batches", [])
		}
		available_qty = flt((available.get(batch_no) or {}).get("available_qty"))
		if flt(allocated_qty) > available_qty:
			_throw(
				"INSUFFICIENT_BATCH_STOCK",
				_("Only {0} units are available in batch {1}.").format(available_qty, batch_no),
				{"requested_qty": allocated_qty, "available_qty": available_qty},
			)


def _resolve_invoice_doctype(invoice_doctype=None):
	invoice_doctype = invoice_doctype or get_invoice_mode()
	_validate_invoice_doctype(invoice_doctype)
	return invoice_doctype


def _build_invoice_doc(pos_profile=None, customer=None, invoice_doctype=None, price_list=None):
	invoice_doctype = _resolve_invoice_doctype(invoice_doctype)
	profile = resolve_pos_profile(pos_profile)
	customer = customer or profile.customer
	if not customer:
		frappe.throw(_("Customer is required because the POS Profile has no default customer"))

	doc = frappe.new_doc(invoice_doctype)
	doc.customer = customer
	doc.company = profile.company
	doc.posting_date = nowdate()
	_set_if_has_field(doc, "set_posting_time", 1)
	_set_if_has_field(doc, "is_pos", 1)
	_set_if_has_field(doc, "update_stock", 1)
	_set_if_has_field(doc, "pos_profile", profile.name)
	_set_if_has_field(doc, "disable_rounded_total", profile.get("disable_rounded_total"))
	_sync_profile_pricing_fields(doc, profile, price_list)
	# Populate ERPNext customer defaults (customer group, territory, and related
	# context) before item pricing rules are evaluated for the first cart row.
	if hasattr(doc, "set_missing_values"):
		doc.set_missing_values()
	_set_if_has_field(doc, VUNAPOS_FIELD, 1)
	_set_if_has_field(doc, HELD_FIELD, 0)
	_set_if_has_field(doc, IDEMPOTENCY_FIELD, None)
	_reset_invoice_totals(doc)

	if invoice_doctype == "POS Invoice" and _has_field(doc.doctype, "payments"):
		for row in profile.get("payments", []):
			doc.append(
				"payments",
				{"mode_of_payment": row.mode_of_payment, "amount": 0, "default": row.get("default")},
			)

	return doc, profile


def _build_sales_order_doc(pos_profile=None, customer=None, price_list=None, delivery_date=None):
	profile = resolve_pos_profile(pos_profile)
	customer = customer or profile.customer
	if not customer:
		frappe.throw(_("Customer is required because the POS Profile has no default customer"))

	doc = frappe.new_doc("Sales Order")
	doc.customer = customer
	doc.company = profile.company
	doc.transaction_date = nowdate()
	requested_delivery_date = getdate(delivery_date or nowdate())
	if requested_delivery_date < getdate(nowdate()):
		_throw("INVALID_DELIVERY_DATE", _("Sales Order delivery date cannot be before today."))
	doc.delivery_date = requested_delivery_date
	_set_if_has_field(doc, "order_type", "Sales")
	_set_if_has_field(doc, "set_warehouse", profile.warehouse)
	_set_if_has_field(doc, "disable_rounded_total", profile.get("disable_rounded_total"))
	_set_if_has_field(doc, "vunapos_pos_profile", profile.name)
	_sync_profile_pricing_fields(doc, profile, price_list)
	if hasattr(doc, "set_missing_values"):
		doc.set_missing_values()
	_set_if_has_field(doc, VUNAPOS_FIELD, 1)
	_set_if_has_field(doc, IDEMPOTENCY_FIELD, None)
	_reset_invoice_totals(doc)
	return doc, profile


def _apply_sales_order_delivery_date(doc, delivery_date):
	"""Keep the requested schedule on both Sales Order headers and item rows."""
	requested_delivery_date = getdate(delivery_date or nowdate())
	if requested_delivery_date < getdate(nowdate()):
		_throw("INVALID_DELIVERY_DATE", _("Sales Order delivery date cannot be before today."))
	doc.delivery_date = requested_delivery_date
	for row in doc.get("items", []):
		if _has_field(row.doctype, "delivery_date"):
			row.delivery_date = requested_delivery_date


def _append_cart_items(doc, profile, items):
	reserved = _reserved_batch_qtys(doc)
	for item in _cart_item_rows(items):
		flags = get_item_tracking_flags(item.get("item_code"))
		_unused_uom, conversion_factor = _resolve_item_uom(item.get("item_code"), item.get("uom"))
		stock_qty = flt(item.get("qty")) * conversion_factor
		if doc.doctype == "Sales Order":
			row = doc.append(
				"items",
				_get_item_row(
					item.get("item_code"),
					item.get("qty"),
					doc,
					profile,
					item_tax_template=item.get("item_tax_template"),
					pricing_item=item,
				),
			)
			_apply_vunapos_item_metadata(row, item)
			continue
		if flags["requires_serial"]:
			serials = (
				validate_serial_allocation(
					item.get("item_code"),
					stock_qty,
					item.get("serial_allocations"),
					warehouse=profile.warehouse,
				)
				if item.get("serial_allocations")
				else auto_allocate_serials(item.get("item_code"), stock_qty, warehouse=profile.warehouse)
			)
			row = doc.append(
				"items",
				_get_item_row(
					item.get("item_code"),
					item.get("qty"),
					doc,
					profile,
					item_tax_template=item.get("item_tax_template"),
					pricing_item=item,
				),
			)
			_set_row_serial_allocations(row, serials)
			_apply_vunapos_item_metadata(row, item)
			continue
		if flags["requires_batch"]:
			if item.get("batch_allocations"):
				allocations = _manual_batch_allocations(
					item.get("item_code"), stock_qty, profile.warehouse, item.get("batch_allocations")
				)
			else:
				allocations = _allocate_batches_for_doc(
					item.get("item_code"),
					stock_qty,
					profile.warehouse,
					reserved,
				)
			row = doc.append(
				"items",
				_get_item_row(
					item.get("item_code"),
					item.get("qty"),
					doc,
					profile,
					item_tax_template=item.get("item_tax_template"),
					pricing_item=item,
				),
			)
			if len(allocations) == 1:
				row.batch_no = allocations[0].get("batch_no")
				if row.meta.has_field("actual_batch_qty"):
					row.actual_batch_qty = allocations[0].get("qty")
			_set_row_batch_allocations(row, allocations)
			_apply_vunapos_item_metadata(row, item)
			continue
		if item.get("batch_allocations"):
			_throw(
				"INVALID_BATCH_ALLOCATION",
				_("Item {0} is not configured for batch tracking.").format(item.get("item_code")),
			)
		row = doc.append(
			"items",
			_get_item_row(
				item.get("item_code"),
				item.get("qty"),
				doc,
				profile,
				item_tax_template=item.get("item_tax_template"),
				pricing_item=item,
			),
		)
		_apply_vunapos_item_metadata(row, item)
	return doc


def _validate_existing_pricing_permissions(doc, profile):
	precision = _currency_precision(doc)
	for item in doc.get("items", []):
		baseline = _get_item_row(
			item.item_code,
			item.qty,
			doc,
			profile,
			item_tax_template=item.get("item_tax_template"),
		)
		rate_changed = flt(item.rate, precision) != flt(baseline.get("rate"), precision)
		discount_changed = flt(item.get("discount_percentage"), precision) != flt(
			baseline.get("discount_percentage"), precision
		) or flt(item.get("discount_amount"), precision) != flt(baseline.get("discount_amount"), precision)
		if (rate_changed or discount_changed) and _rate_matches_pricing_rule_discount(item, precision):
			continue
		if rate_changed:
			if discount_changed and profile.get("allow_discount_change"):
				continue
			if profile.get("allow_rate_change"):
				continue
			_throw("RATE_CHANGE_NOT_ALLOWED", _("Rate changes are not allowed for this POS Profile"))
		if discount_changed and not profile.get("allow_discount_change"):
			_throw("DISCOUNT_CHANGE_NOT_ALLOWED", _("Discount changes are not allowed for this POS Profile"))


def create_draft_invoice(pos_profile=None, customer=None, price_list=None):
	invoice_doctype = _resolve_invoice_doctype()
	require_create(invoice_doctype)
	doc, _profile = _build_invoice_doc(
		pos_profile=pos_profile,
		customer=customer,
		invoice_doctype=invoice_doctype,
		price_list=price_list,
	)
	doc.insert(ignore_mandatory=True)
	return invoice_to_dict(doc)


def preview_invoice(
	pos_profile=None,
	customer=None,
	items=None,
	invoice_doctype=None,
	price_list=None,
	loyalty_points=None,
):
	invoice_doctype = _resolve_invoice_doctype(invoice_doctype)
	require_create(invoice_doctype)
	doc, profile = _build_invoice_doc(
		pos_profile=pos_profile,
		customer=customer,
		invoice_doctype=invoice_doctype,
		price_list=price_list,
	)
	require_open_pos_session(profile.name)
	cart_items = _cart_item_rows(items)
	validate_cart_items(cart_items, profile)
	_append_cart_items(doc, profile, cart_items)
	_recalculate(doc)
	_apply_loyalty_redemption(doc, loyalty_points)
	return invoice_to_dict(doc)


def get_invoice(invoice_doctype, invoice_name):
	_validate_invoice_doctype(invoice_doctype)
	require_read(invoice_doctype, invoice_name)
	return invoice_to_dict(frappe.get_doc(invoice_doctype, invoice_name))


def hold_invoice(invoice_doctype, invoice_name):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	opening_entry = require_open_pos_session(doc.get("pos_profile"))
	_stamp_validated_session(doc, opening_entry)
	_set_if_has_field(doc, VUNAPOS_FIELD, 1)
	_set_if_has_field(doc, HELD_FIELD, 1)
	doc.save(ignore_permissions=True)
	return invoice_to_dict(doc)


def restore_invoice(invoice_doctype, invoice_name):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	require_open_pos_session(doc.get("pos_profile"))
	_set_if_has_field(doc, HELD_FIELD, 0)
	doc.save(ignore_permissions=True)
	return invoice_to_dict(doc)


def clear_invoice(invoice_doctype, invoice_name):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	doc.set("items", [])
	if _has_field(doc.doctype, "taxes"):
		doc.set("taxes", [])
	if _has_field(doc.doctype, "payments"):
		doc.set("payments", [])
	_reset_invoice_totals(doc)
	_set_if_has_field(doc, HELD_FIELD, 0)
	doc.flags.ignore_mandatory = True
	doc.save(ignore_permissions=True)
	return invoice_to_dict(doc)


def update_invoice_from_cart(
	invoice_doctype,
	invoice_name,
	customer=None,
	items=None,
	price_list=None,
	loyalty_points=None,
):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	profile = resolve_pos_profile(doc.get("pos_profile"))
	cart_items = _cart_item_rows(items)
	validate_cart_items(cart_items, profile)

	if customer:
		doc.customer = customer
	_sync_profile_pricing_fields(doc, profile, price_list)
	doc.set("items", [])
	if _has_field(doc.doctype, "taxes"):
		doc.set("taxes", [])

	_append_cart_items(doc, profile, cart_items)
	_recalculate(doc)
	_apply_loyalty_redemption(doc, loyalty_points)

	_set_if_has_field(doc, VUNAPOS_FIELD, 1)
	_set_if_has_field(doc, HELD_FIELD, 0)
	_save_invoice(doc)
	return invoice_to_dict(doc)


def _held_invoice_row(doctype, row):
	total = row.get("rounded_total") or row.get("grand_total") or 0
	return {
		"doctype": doctype,
		"name": row.get("name"),
		"customer": row.get("customer"),
		"customer_name": row.get("customer_name"),
		"posting_date": row.get("posting_date"),
		"modified": row.get("modified"),
		"grand_total": row.get("grand_total"),
		"rounded_total": row.get("rounded_total"),
		"total": total,
		"currency": row.get("currency"),
	}


def list_held_invoices(pos_profile=None, limit=20):
	limit = min(int(limit or 20), 100)
	rows = []
	for doctype in SUPPORTED_INVOICE_DOCTYPES:
		if not frappe.db.table_exists(doctype):
			continue
		require_read(doctype)
		filters = {
			"docstatus": 0,
		}
		if _has_field(doctype, VUNAPOS_FIELD):
			filters[VUNAPOS_FIELD] = 1
		if _has_field(doctype, HELD_FIELD):
			filters[HELD_FIELD] = 1
		if pos_profile and _has_field(doctype, "pos_profile"):
			filters["pos_profile"] = pos_profile

		for row in frappe.get_all(
			doctype,
			filters=filters,
			fields=[
				"name",
				"customer",
				"customer_name",
				"posting_date",
				"modified",
				"grand_total",
				"rounded_total",
				"currency",
			],
			order_by="modified desc",
			limit_page_length=limit,
		):
			rows.append(_held_invoice_row(doctype, row))

	rows.sort(key=lambda row: row.get("modified") or "", reverse=True)
	return rows[:limit]


def add_item(invoice_doctype, invoice_name, item_code, qty=1):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	profile = resolve_pos_profile(doc.get("pos_profile"))
	_sync_profile_pricing_fields(doc, profile)
	validate_cart_items([{"item_code": item_code, "qty": qty}], profile)
	_append_cart_items(doc, profile, [{"item_code": item_code, "qty": qty}])
	if profile.get("vunapos_new_item_position") == "Top" and len(doc.get("items")) > 1:
		doc.items = [doc.items[-1], *doc.items[:-1]]
		for index, row in enumerate(doc.items, start=1):
			row.idx = index
	_save_invoice(doc)
	return invoice_to_dict(doc)


def update_item(invoice_doctype, invoice_name, row_name, qty):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	row = next((item for item in doc.get("items", []) if item.name == row_name), None)
	if not row:
		frappe.throw(_("Invoice item row {0} was not found").format(row_name))
	profile = resolve_pos_profile(doc.get("pos_profile"))
	_sync_profile_pricing_fields(doc, profile)
	validate_cart_items([{"item_code": row.item_code, "qty": qty}], profile)
	flags = get_item_tracking_flags(row.item_code)
	if flags["requires_serial"]:
		_throw("SERIAL_SELECTION_REQUIRED", _("Serial-numbered items require manual serial selection."))
	if flags["requires_batch"]:
		item_code = row.item_code
		item_tax_template = row.get("item_tax_template")
		doc.remove(row)
		_append_cart_items(
			doc,
			profile,
			[{"item_code": item_code, "qty": qty, "item_tax_template": item_tax_template}],
		)
		_save_invoice(doc)
		return invoice_to_dict(doc)
	row.qty = flt(qty)
	row.batch_no = None
	if row.meta.has_field("serial_and_batch_bundle"):
		row.serial_and_batch_bundle = None
	_apply_batch_allocation(row, doc, profile, flt(qty) * flt(row.get("conversion_factor") or 1))
	_save_invoice(doc)
	return invoice_to_dict(doc)


def remove_item(invoice_doctype, invoice_name, row_name, manager_pin_token=None):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	profile = resolve_pos_profile(doc.get("pos_profile"))
	manager_identity = None
	if profile.get("vunapos_require_manager_pin_item_removal"):
		manager_state = consume_pin_token(manager_pin_token, profile, "manager")
		manager_identity = manager_state.get("subject")
	row = next((item for item in doc.get("items", []) if item.name == row_name), None)
	if not row:
		frappe.throw(_("Invoice item row {0} was not found").format(row_name))
	doc.remove(row)
	_save_invoice(doc)
	if manager_identity:
		doc.add_comment(
			"Info",
			_("Item {0} removed with manager PIN approval by {1}.").format(row_name, manager_identity),
		)
	return invoice_to_dict(doc)


def set_payment_rows(doc, payments=None, profile=None, is_credit_sale=False):
	if not _has_field(doc.doctype, "payments"):
		return doc

	doc.set("payments", [])
	payment_child_doctype = frappe.get_meta(doc.doctype).get_field("payments").options
	payment_rows = _payment_rows(payments)
	if is_credit_sale and not payment_rows:
		# ERPNext validates POS documents before it discards zero-value payment rows.
		# Supply the profile default transiently so a fully unpaid credit sale remains
		# a native POS invoice while recording no collection.
		configured_modes = list(profile.get("payments", [])) if profile else []
		default_mode = next((row for row in configured_modes if row.get("default")), None)
		default_mode = default_mode or (configured_modes[0] if configured_modes else None)
		if not default_mode:
			_throw(
				"NO_PAYMENT_MODES",
				_("Configure at least one Mode of Payment on this POS Profile for credit sales"),
			)
		payment_rows = [
			{
				"mode_of_payment": default_mode.mode_of_payment,
				"amount": 0,
				"default": default_mode.get("default"),
			}
		]
	for payment in payment_rows:
		row = {
			"mode_of_payment": payment.get("mode_of_payment"),
			"amount": flt(payment.get("amount")),
			"default": payment.get("default"),
		}
		_apply_gateway_metadata_to_payment_row(row, payment, payment_child_doctype)
		doc.append("payments", row)
	return doc


def _apply_gateway_metadata_to_payment_row(row: dict, payment: dict, child_doctype: str) -> None:
	metadata = gateway_payment_metadata(payment.get("gateway_payment_link"))
	if not metadata:
		return
	field_map = {
		"ke_transaction_id": metadata.get("transaction_reference"),
		"ke_transaction_date": metadata.get("transaction_date"),
		"ke_payment_request": metadata.get("ke_payment_request"),
	}
	child_meta = frappe.get_meta(child_doctype)
	for fieldname, value in field_map.items():
		if value and child_meta.has_field(fieldname):
			row[fieldname] = value


def _gateway_payment_links(payment_rows):
	links = []
	for payment in payment_rows or []:
		link_name = payment.get("gateway_payment_link")
		if link_name:
			links.append(frappe.get_doc("VunaPOS Gateway Payment Link", link_name))
	return links


def submit_invoice(
	invoice_doctype,
	invoice_name,
	payments=None,
	is_credit_sale=False,
	due_date=None,
	loyalty_points=None,
	tax_id=None,
	shipping_address_name=None,
	salesperson=None,
	salesperson_token=None,
):
	doc = _load_draft_invoice(invoice_doctype, invoice_name)
	profile = resolve_pos_profile(doc.get("pos_profile"))
	is_credit_sale = _validate_credit_sale_request(profile, is_credit_sale, doc.get("customer"))
	opening_entry = require_open_pos_session(profile.name)
	validate_cart_items(
		[{"item_code": item.item_code, "qty": item.qty, "uom": item.uom} for item in doc.get("items", [])],
		profile,
	)
	_validate_existing_pricing_permissions(doc, profile)
	_recalculate(doc)
	_apply_loyalty_redemption(doc, loyalty_points)
	validate_invoice_batch_allocations(doc)
	payment_rows = validate_payment_rows(
		doc, payments, profile, is_credit_sale=is_credit_sale, opening_entry=opening_entry
	)
	gateway_links = _gateway_payment_links(payment_rows)
	set_payment_rows(doc, payment_rows, profile=profile, is_credit_sale=is_credit_sale)
	_apply_credit_sale_fields(doc, is_credit_sale, due_date)
	_apply_checkout_tax_id(doc, tax_id)
	_apply_shipping_address(doc, shipping_address_name)
	_stamp_salesperson(doc, profile, salesperson, salesperson_token)
	_stamp_validated_session(doc, opening_entry)
	if hasattr(doc, "set_paid_amount"):
		doc.set_paid_amount()
	doc.flags.ignore_mandatory = False
	doc.save()
	_apply_checkout_tax_id(doc, tax_id, persist=True)
	_apply_shipping_address(doc, shipping_address_name, persist=True)
	doc.submit()
	consume_gateway_payment_links(gateway_links, doc)
	return invoice_to_dict(doc)


def checkout_invoice(
	invoice_doctype,
	invoice_name,
	payments=None,
	idempotency_key=None,
	is_credit_sale=False,
	due_date=None,
	loyalty_points=None,
	tax_id=None,
	shipping_address_name=None,
	salesperson=None,
	salesperson_token=None,
):
	existing = _find_submitted_invoice_by_idempotency_key(idempotency_key)
	if existing:
		return invoice_to_dict(existing)

	doc = _load_checkout_invoice(invoice_doctype, invoice_name)
	if doc.docstatus == 1:
		return invoice_to_dict(doc)
	if doc.docstatus != 0:
		_throw("INVOICE_ALREADY_SUBMITTED", _("This invoice has already been submitted"))
	if _has_field(doc.doctype, VUNAPOS_FIELD) and not doc.get(VUNAPOS_FIELD):
		_throw("INVALID_VUNAPOS_INVOICE", _("Invoice was not created by VunaPOS"))
	if not doc.get("items"):
		_throw("EMPTY_INVOICE", _("Add at least one item before checkout"))

	_prepare_invoice_for_checkout(
		doc,
		payments=payments,
		idempotency_key=idempotency_key,
		is_credit_sale=is_credit_sale,
		due_date=due_date,
		loyalty_points=loyalty_points,
		tax_id=tax_id,
		shipping_address_name=shipping_address_name,
		salesperson=salesperson,
		salesperson_token=salesperson_token,
	)
	doc.submit()
	consume_gateway_payment_links(getattr(doc.flags, "vunapos_gateway_payment_links", []), doc)
	return invoice_to_dict(doc)


def _prepare_invoice_for_checkout(
	doc,
	*,
	payments=None,
	idempotency_key=None,
	is_credit_sale=False,
	due_date=None,
	loyalty_points=None,
	tax_id=None,
	shipping_address_name=None,
	salesperson=None,
	salesperson_token=None,
):
	profile = resolve_pos_profile(doc.get("pos_profile"))
	is_credit_sale = _validate_credit_sale_request(profile, is_credit_sale, doc.get("customer"))
	opening_entry = require_open_pos_session(profile.name)
	validate_cart_items(
		[{"item_code": item.item_code, "qty": item.qty, "uom": item.uom} for item in doc.get("items", [])],
		profile,
	)
	_validate_existing_pricing_permissions(doc, profile)
	_recalculate(doc)
	_apply_loyalty_redemption(doc, loyalty_points)
	validate_invoice_batch_allocations(doc)
	payment_rows = validate_payment_rows(
		doc, payments, profile, is_credit_sale=is_credit_sale, opening_entry=opening_entry
	)
	doc.flags.vunapos_gateway_payment_links = _gateway_payment_links(payment_rows)
	set_payment_rows(doc, payment_rows, profile=profile, is_credit_sale=is_credit_sale)
	_apply_credit_sale_fields(doc, is_credit_sale, due_date)
	_apply_checkout_tax_id(doc, tax_id)
	_apply_shipping_address(doc, shipping_address_name)
	_stamp_salesperson(doc, profile, salesperson, salesperson_token)
	_stamp_validated_session(doc, opening_entry)
	_set_if_has_field(doc, VUNAPOS_FIELD, 1)
	_set_if_has_field(doc, HELD_FIELD, 0)
	if idempotency_key:
		_set_if_has_field(doc, IDEMPOTENCY_FIELD, idempotency_key)
	if hasattr(doc, "set_paid_amount"):
		doc.set_paid_amount()
	doc.flags.ignore_mandatory = False
	doc.save()
	_apply_checkout_tax_id(doc, tax_id, persist=True)
	_apply_shipping_address(doc, shipping_address_name, persist=True)
	return doc


def create_invoice_from_cart(
	pos_profile=None,
	customer=None,
	items=None,
	price_list=None,
	loyalty_points=None,
	idempotency_key=None,
):
	savepoint = "vunapos_hold_invoice"
	frappe.db.savepoint(savepoint)
	try:
		profile = resolve_pos_profile(pos_profile)
		cart_items = _cart_item_rows(items)
		validate_cart_items(cart_items, profile)

		draft = create_draft_invoice(
			pos_profile=profile.name,
			customer=customer,
			price_list=price_list,
		)
		doc = frappe.get_doc(draft["doctype"], draft["name"])
		if idempotency_key:
			_set_if_has_field(doc, IDEMPOTENCY_FIELD, str(idempotency_key).strip())

		_append_cart_items(doc, profile, cart_items)
		_recalculate(doc)
		_apply_loyalty_redemption(doc, loyalty_points)

		_save_invoice(doc)
		return invoice_to_dict(doc)
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		raise


def create_and_submit_invoice(
	pos_profile=None,
	customer=None,
	items=None,
	payments=None,
	idempotency_key=None,
	is_credit_sale=False,
	due_date=None,
	price_list=None,
	loyalty_points=None,
	tax_id=None,
	shipping_address_name=None,
	salesperson=None,
	salesperson_token=None,
):
	existing = find_invoice_by_idempotency_key(idempotency_key, SUPPORTED_INVOICE_DOCTYPES)
	if existing:
		require_read(existing.doctype, existing.name)
		if existing.docstatus == 1:
			return invoice_to_dict(existing)
		if existing.docstatus != 0:
			_throw("INVOICE_ALREADY_SUBMITTED", _("This checkout attempt can no longer be submitted"))
		existing_profile = resolve_pos_profile(existing.get("pos_profile"))
		has_gateway_payment = _has_gateway_payment_rows(payments, existing_profile)
		if get_queue_limits(existing_profile)["enabled"] and not has_gateway_payment:
			if existing.get("vunapos_queue_status") in (QUEUE_STATUS_QUEUED, QUEUE_STATUS_PROCESSING):
				return invoice_to_dict(existing)
			if existing.get("vunapos_queue_status"):
				_throw(
					"QUEUE_RETRY_REQUIRED",
					_("Invoice {0} requires review before it can be retried").format(existing.name),
					{"status": existing.get("vunapos_queue_status")},
				)
			_prepare_invoice_for_checkout(
				existing,
				payments=payments,
				idempotency_key=idempotency_key,
				is_credit_sale=is_credit_sale,
				due_date=due_date,
				loyalty_points=loyalty_points,
				tax_id=tax_id,
				shipping_address_name=shipping_address_name,
				salesperson=salesperson,
				salesperson_token=salesperson_token,
			)
			if existing.get("vunapos_reservation_fingerprint"):
				validate_invoice_stock_reservations(existing)
			else:
				create_invoice_stock_reservations(existing)
			enqueue_invoice_submission(existing)
			_apply_checkout_tax_id(existing, tax_id, persist=True)
			_apply_shipping_address(existing, shipping_address_name, persist=True)
			return invoice_to_dict(existing)
		return checkout_invoice(
			existing.doctype,
			existing.name,
			payments=payments,
			idempotency_key=idempotency_key,
			is_credit_sale=is_credit_sale,
			due_date=due_date,
			loyalty_points=loyalty_points,
			tax_id=tax_id,
			shipping_address_name=shipping_address_name,
			salesperson=salesperson,
			salesperson_token=salesperson_token,
		)
	savepoint = "vunapos_checkout"
	frappe.db.savepoint(savepoint)
	try:
		profile = resolve_pos_profile(pos_profile)
		has_gateway_payment = _has_gateway_payment_rows(payments, profile)
		if (
			get_queue_limits(profile)["enabled"]
			and not has_gateway_payment
			and not str(idempotency_key or "").strip()
		):
			_throw(
				"CHECKOUT_IDEMPOTENCY_REQUIRED",
				_("An idempotency key is required when background invoice submission is enabled"),
			)
		_validate_credit_sale_request(profile, is_credit_sale, customer or profile.customer)
		_validate_credit_due_date(is_credit_sale, due_date, nowdate())
		draft = create_invoice_from_cart(
			pos_profile=profile.name,
			customer=customer,
			items=items,
			price_list=price_list,
			loyalty_points=loyalty_points,
			idempotency_key=idempotency_key,
		)
		doc = frappe.get_doc(draft["doctype"], draft["name"])
		if get_queue_limits(profile)["enabled"] and not has_gateway_payment:
			_prepare_invoice_for_checkout(
				doc,
				payments=payments,
				idempotency_key=idempotency_key,
				is_credit_sale=is_credit_sale,
				due_date=due_date,
				loyalty_points=loyalty_points,
				tax_id=tax_id,
				shipping_address_name=shipping_address_name,
				salesperson=salesperson,
				salesperson_token=salesperson_token,
			)
			create_invoice_stock_reservations(doc)
			enqueue_invoice_submission(doc)
			_apply_checkout_tax_id(doc, tax_id, persist=True)
			_apply_shipping_address(doc, shipping_address_name, persist=True)
			return invoice_to_dict(doc)
		return checkout_invoice(
			doc.doctype,
			doc.name,
			payments=payments,
			idempotency_key=idempotency_key,
			is_credit_sale=is_credit_sale,
			due_date=due_date,
			loyalty_points=loyalty_points,
			tax_id=tax_id,
			shipping_address_name=shipping_address_name,
			salesperson=salesperson,
			salesperson_token=salesperson_token,
		)
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		raise


def create_and_submit_sales_order(
	pos_profile=None,
	customer=None,
	items=None,
	payments=None,
	idempotency_key=None,
	price_list=None,
	delivery_date=None,
	tax_id=None,
	shipping_address_name=None,
	salesperson=None,
	salesperson_token=None,
):
	existing = _find_submitted_order_by_idempotency_key(idempotency_key)
	if existing:
		return invoice_to_dict(existing)

	savepoint = "vunapos_sales_order_checkout"
	frappe.db.savepoint(savepoint)
	try:
		require_create("Sales Order")
		if not frappe.has_permission("Sales Order", "submit"):
			frappe.throw(_("Not permitted to submit Sales Order"), frappe.PermissionError)
		profile = resolve_pos_profile(pos_profile)
		opening_entry = require_open_pos_session(profile.name)
		cart_items = _cart_item_rows(items)
		validate_cart_items(cart_items, profile)
		doc, profile = _build_sales_order_doc(
			pos_profile=profile.name,
			customer=customer,
			price_list=price_list,
			delivery_date=delivery_date,
		)
		_append_cart_items(doc, profile, cart_items)
		_apply_sales_order_delivery_date(doc, delivery_date)
		_recalculate(doc)
		# ERPNext may populate child dates during recalculation; restore the cashier's date.
		_apply_sales_order_delivery_date(doc, delivery_date)
		validate_invoice_batch_allocations(doc)
		payment_rows = validate_payment_rows(
			doc,
			payments,
			profile=profile,
			opening_entry=opening_entry,
			allow_partial_override=True,
		)
		if payment_rows and not str(idempotency_key or "").strip():
			_throw(
				"SALES_ORDER_PAYMENT_IDEMPOTENCY_REQUIRED",
				_("An idempotency key is required when collecting a Sales Order advance"),
			)
		order_total = flt(doc.get("rounded_total") or doc.get("grand_total") or 0)
		paid_total = sum(flt(row.get("amount")) for row in payment_rows)
		if paid_total > order_total:
			_throw(
				"SALES_ORDER_ADVANCE_OVERPAYMENT",
				_("Sales Order advance payments cannot exceed the order total"),
				{"order_total": order_total, "paid_total": paid_total},
			)
		_stamp_validated_session(doc, opening_entry)
		_stamp_salesperson(doc, profile, salesperson, salesperson_token)
		_set_if_has_field(doc, VUNAPOS_FIELD, 1)
		if idempotency_key:
			_set_if_has_field(doc, IDEMPOTENCY_FIELD, str(idempotency_key).strip())
		_apply_checkout_tax_id(doc, tax_id)
		_apply_shipping_address(doc, shipping_address_name)
		doc.flags.ignore_mandatory = False
		doc.insert()
		_materialize_batch_bundles(doc)
		_apply_checkout_tax_id(doc, tax_id, persist=True)
		_apply_shipping_address(doc, shipping_address_name, persist=True)
		doc.submit()
		advance_payments = []
		if payment_rows:
			from vunapos.services.payment_service import receive_customer_payment

			for index, payment in enumerate(payment_rows):
				amount = flt(payment.get("amount"))
				if amount <= 0:
					continue
				advance_payments.append(
					receive_customer_payment(
						pos_profile=profile.name,
						customer=doc.customer,
						amount=amount,
						mode_of_payment=payment.get("mode_of_payment"),
						sales_order=doc.name,
						allocated_amount=amount,
						idempotency_key=f"{idempotency_key}:advance:{index}",
						gateway_payment_link=payment.get("gateway_payment_link"),
					)
				)
		result = invoice_to_dict(doc)
		result["advance_payments"] = advance_payments
		return result
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		raise
