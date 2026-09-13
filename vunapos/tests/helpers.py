import frappe
from erpnext.stock.doctype.batch.batch import get_batch_qty
from frappe.utils import flt, get_datetime, now_datetime


def _first_value(doctype, filters, fieldname="name"):
	return frappe.db.get_value(doctype, filters, fieldname)


def _company():
	return _first_value("Company", {"company_name": "_Test Company"}) or _first_value("Company", {})


def _company_abbr(company):
	return frappe.db.get_value("Company", company, "abbr")


def _account(company, root_type=None, account_type=None):
	filters = {"company": company, "is_group": 0}
	if root_type:
		filters["root_type"] = root_type
	if account_type:
		filters["account_type"] = account_type
	return _first_value("Account", filters)


def _cost_center(company):
	return _first_value("Cost Center", {"company": company, "is_group": 0})


def _warehouse(company):
	abbr = _company_abbr(company)
	return _first_value("Warehouse", {"company": company, "is_group": 0}) or _first_value(
		"Warehouse", {"name": ["like", f"% - {abbr}"], "is_group": 0}
	)


def _price_list():
	return _first_value("Price List", {"selling": 1, "enabled": 1}) or _first_value("Price List", {})


def _tax_account(company):
	return (
		_account(company, account_type="Tax")
		or _account(company, root_type="Liability")
		or _account(company, root_type="Income")
		or _account(company)
	)


def _mode_of_payment_account(company):
	mode_of_payment = (
		"Cash" if frappe.db.exists("Mode of Payment", "Cash") else _first_value("Mode of Payment", {})
	)
	if mode_of_payment and not frappe.db.exists(
		"Mode of Payment Account", {"parent": mode_of_payment, "company": company}
	):
		account = _account(company, account_type="Cash") or _account(company, root_type="Asset")
		doc = frappe.get_doc("Mode of Payment", mode_of_payment)
		doc.append("accounts", {"company": company, "default_account": account})
		doc.save(ignore_permissions=True)
	return mode_of_payment


def ensure_test_payment_mode(mode_of_payment="_Test Vuna M-Pesa", payment_type="Phone"):
	company = _company()
	if frappe.db.exists("Mode of Payment", mode_of_payment):
		doc = frappe.get_doc("Mode of Payment", mode_of_payment)
	else:
		doc = frappe.get_doc(
			{"doctype": "Mode of Payment", "mode_of_payment": mode_of_payment, "type": payment_type}
		)
	account = _account(company, account_type="Bank") or _account(company, root_type="Asset")
	if not any(row.company == company for row in doc.get("accounts", [])):
		doc.append("accounts", {"company": company, "default_account": account})
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)
	return doc.name


def ensure_test_customer():
	if frappe.db.exists("Customer", "_Test Customer"):
		return "_Test Customer"
	customer = frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": "_Test Customer",
			"customer_type": "Individual",
			"customer_group": frappe.db.get_value("Customer Group", {"is_group": 0}, "name"),
			"territory": frappe.db.get_value("Territory", {"is_group": 0}, "name"),
		}
	)
	customer.insert(ignore_permissions=True)
	return customer.name


def ensure_test_shipping_address(customer=None):
	"""Create a reusable customer-linked shipping address for POS checkout tests."""
	customer = customer or ensure_test_customer()
	address_title = f"_Test Vuna Shipping Address {customer}"
	address_name = frappe.db.get_value(
		"Address",
		{"address_title": address_title, "address_type": "Shipping"},
		"name",
	)
	if address_name:
		address = frappe.get_doc("Address", address_name)
		if not any(
			link.link_doctype == "Customer" and link.link_name == customer
			for link in address.get("links", [])
		):
			address.append("links", {"link_doctype": "Customer", "link_name": customer})
			address.save(ignore_permissions=True)
		return address.name
	address = frappe.get_doc(
		{
			"doctype": "Address",
			"address_title": address_title,
			"address_type": "Shipping",
			"address_line1": "1 Vuna Way",
			"city": "Nairobi",
			"country": "Kenya",
			"links": [{"link_doctype": "Customer", "link_name": customer}],
		}
	)
	address.insert(ignore_permissions=True)
	return address.name


def ensure_test_pos_profile():
	if frappe.db.exists("POS Profile", "_Test VunaPOS Profile"):
		profile = frappe.get_doc("POS Profile", "_Test VunaPOS Profile")
		if profile.meta.has_field("vunapos_allow_service_items") and not profile.vunapos_allow_service_items:
			profile.vunapos_allow_service_items = 1
			profile.save(ignore_permissions=True)
		if not any(row.user == frappe.session.user for row in profile.get("applicable_for_users", [])):
			profile.append("applicable_for_users", {"user": frappe.session.user, "default": 0})
			profile.save(ignore_permissions=True)
		return "_Test VunaPOS Profile"

	company = _company()
	customer = ensure_test_customer()
	mode_of_payment = _mode_of_payment_account(company)
	profile = frappe.get_doc(
		{
			"doctype": "POS Profile",
			"name": "_Test VunaPOS Profile",
			"company": company,
			"customer": customer,
			"currency": frappe.db.get_value("Company", company, "default_currency"),
			"selling_price_list": _price_list(),
			"warehouse": _warehouse(company),
			"write_off_account": _account(company, root_type="Expense") or _account(company),
			"write_off_cost_center": _cost_center(company),
			"income_account": _account(company, root_type="Income"),
			"expense_account": _account(company, root_type="Expense"),
			"cost_center": _cost_center(company),
			"write_off_limit": 1,
			"vunapos_allow_service_items": 1,
		}
	)
	profile.append("payments", {"mode_of_payment": mode_of_payment, "default": 1})
	profile.append("applicable_for_users", {"user": frappe.session.user, "default": 0})
	profile.insert(ignore_permissions=True)
	return profile.name


def ensure_sales_tax_template(rate=16, included_in_print_rate=0):
	company = _company()
	title = f"_Test Vuna {'Inclusive' if included_in_print_rate else 'Exclusive'} Tax {rate}"
	existing = frappe.db.get_value(
		"Sales Taxes and Charges Template", {"title": title, "company": company}, "name"
	)
	if existing:
		template = frappe.get_doc("Sales Taxes and Charges Template", existing)
	else:
		template = frappe.get_doc(
			{
				"doctype": "Sales Taxes and Charges Template",
				"title": title,
				"company": company,
				"disabled": 0,
			}
		)

	template.set("taxes", [])
	template.append(
		"taxes",
		{
			"charge_type": "On Net Total",
			"account_head": _tax_account(company),
			"description": title,
			"rate": rate,
			"included_in_print_rate": included_in_print_rate,
		},
	)
	if template.is_new():
		template.insert(ignore_permissions=True)
	else:
		template.save(ignore_permissions=True)
	return template.name


def ensure_item_tax_template(item_code, rate=10):
	company = _company()
	title = f"_Test Vuna Item Tax {rate}"
	account = _tax_account(company)
	existing = frappe.db.get_value("Item Tax Template", {"title": title, "company": company}, "name")
	if existing:
		template = frappe.get_doc("Item Tax Template", existing)
	else:
		template = frappe.get_doc(
			{
				"doctype": "Item Tax Template",
				"title": title,
				"company": company,
				"disabled": 0,
			}
		)

	template.set("taxes", [])
	template.append("taxes", {"tax_type": account, "tax_rate": rate})
	if template.is_new():
		template.insert(ignore_permissions=True)
	else:
		template.save(ignore_permissions=True)

	item = frappe.get_doc("Item", item_code)
	if not any(row.item_tax_template == template.name for row in item.get("taxes", [])):
		item.append("taxes", {"item_tax_template": template.name})
		item.save(ignore_permissions=True)
	frappe.clear_document_cache("Item", item_code)
	return template.name


def set_profile_tax_template(pos_profile, tax_template=None):
	profile = frappe.get_doc("POS Profile", pos_profile)
	if profile.meta.has_field("taxes_and_charges"):
		profile.taxes_and_charges = tax_template
	profile.save(ignore_permissions=True)
	return profile.name


def ensure_test_item():
	if frappe.db.exists("Item", "_Test VunaPOS Item"):
		item = frappe.get_doc("Item", "_Test VunaPOS Item")
	else:
		item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": "_Test VunaPOS Item",
				"item_name": "_Test VunaPOS Item",
				"item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
				"stock_uom": frappe.db.get_value("UOM", {}, "name"),
				"is_sales_item": 1,
				"is_stock_item": 0,
				"standard_rate": 100,
			}
		)
		item.insert(ignore_permissions=True)

	if not frappe.db.exists("Item Barcode", {"parent": item.name, "barcode": "VUNA-POS-BARCODE"}):
		item.append("barcodes", {"barcode": "VUNA-POS-BARCODE"})
		item.save(ignore_permissions=True)
	return item.name


def ensure_test_sales_uom_item(item_code="_Test VunaPOS Sales UOM Item"):
	"""Create a stock item whose configured sales UOM is an 18-unit box."""
	stock_uom = frappe.db.get_value("UOM", {"name": "Nos"}, "name") or frappe.db.get_value("UOM", {}, "name")
	box_uom = frappe.db.get_value("UOM", {"name": "Box"}, "name")
	if not box_uom:
		box_uom = frappe.get_doc({"doctype": "UOM", "uom_name": "Box"}).insert(ignore_permissions=True).name
	if frappe.db.exists("Item", item_code):
		item = frappe.get_doc("Item", item_code)
	else:
		item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": item_code,
				"item_name": item_code,
				"item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
				"stock_uom": stock_uom,
				"sales_uom": box_uom,
				"is_sales_item": 1,
				"is_stock_item": 1,
				"standard_rate": 100,
				"uoms": [{"uom": box_uom, "conversion_factor": 18}],
			}
		)
		item.insert(ignore_permissions=True)
	item.sales_uom = box_uom
	item.is_sales_item = 1
	item.is_stock_item = 1
	if not any(row.uom == box_uom for row in item.get("uoms", [])):
		item.append("uoms", {"uom": box_uom, "conversion_factor": 18})
	item.save(ignore_permissions=True)
	frappe.clear_document_cache("Item", item.name)
	return item.name


def ensure_test_stock_item(item_code="_Test VunaPOS Stock Item"):
	if frappe.db.exists("Item", item_code):
		item = frappe.get_doc("Item", item_code)
	else:
		item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": item_code,
				"item_name": item_code,
				"item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
				"stock_uom": frappe.db.get_value("UOM", {}, "name"),
				"is_sales_item": 1,
				"is_stock_item": 1,
				"standard_rate": 100,
			}
		)
		item.insert(ignore_permissions=True)
	item.is_stock_item = 1
	item.has_batch_no = 0
	item.has_serial_no = 0
	item.save(ignore_permissions=True)
	frappe.clear_document_cache("Item", item.name)
	return item.name


def ensure_test_batch_item(item_code="_Test Vuna Batch Item", has_serial_no=0):
	if frappe.db.exists("Item", item_code):
		item = frappe.get_doc("Item", item_code)
	else:
		item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": item_code,
				"item_name": item_code,
				"item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
				"stock_uom": frappe.db.get_value("UOM", {}, "name"),
				"is_sales_item": 1,
				"is_stock_item": 1,
				"has_batch_no": 1,
				"has_serial_no": has_serial_no,
				"standard_rate": 100,
			}
		)
		item.insert(ignore_permissions=True)
	item.has_batch_no = 1
	item.has_serial_no = has_serial_no
	item.is_stock_item = 1
	item.save(ignore_permissions=True)
	frappe.clear_document_cache("Item", item.name)
	return item.name


def ensure_batch_stock(item_code, warehouse, batches):
	for batch_id, qty, expiry_date in batches:
		batch_name = frappe.db.get_value("Batch", {"batch_id": batch_id, "item": item_code}, "name")
		if not batch_name:
			batch = frappe.get_doc(
				{
					"doctype": "Batch",
					"batch_id": batch_id,
					"item": item_code,
					"expiry_date": expiry_date,
				}
			).insert(ignore_permissions=True)
			batch_name = batch.name
		existing = frappe.db.get_value(
			"Stock Ledger Entry",
			{
				"item_code": item_code,
				"warehouse": warehouse,
				"batch_no": batch_name,
				"voucher_no": f"VUNA-{batch_id}",
			},
			"name",
		)
		if existing:
			other_qty = frappe.db.sql(
				"""
				select coalesce(sum(actual_qty), 0)
				from `tabStock Ledger Entry`
				where item_code = %s and warehouse = %s and batch_no = %s
					and name != %s and docstatus < 2 and ifnull(is_cancelled, 0) = 0
				""",
				(item_code, warehouse, batch_name, existing),
			)[0][0]
			fixture_qty = flt(qty) - flt(other_qty)
			frappe.db.set_value(
				"Stock Ledger Entry",
				existing,
				{
					"actual_qty": fixture_qty,
					"qty_after_transaction": qty,
					"stock_value": flt(qty) * 100,
					"stock_value_difference": fixture_qty * 100,
				},
				update_modified=False,
			)
			available_rows = get_batch_qty(item_code=item_code, warehouse=warehouse) or []
			available_qty = next(
				(flt(row.get("qty")) for row in available_rows if row.get("batch_no") == batch_name),
				0,
			)
			if available_qty != flt(qty):
				fixture_qty += flt(qty) - available_qty
				frappe.db.set_value(
					"Stock Ledger Entry",
					existing,
					{
						"actual_qty": fixture_qty,
						"stock_value_difference": fixture_qty * 100,
					},
					update_modified=False,
				)
			continue
		frappe.get_doc(
			{
				"doctype": "Stock Ledger Entry",
				"item_code": item_code,
				"warehouse": warehouse,
				"batch_no": batch_name,
				"posting_date": now_datetime().date(),
				"posting_time": now_datetime().time(),
				"actual_qty": qty,
				"qty_after_transaction": qty,
				"voucher_type": "Stock Entry",
				"voucher_no": f"VUNA-{batch_id}",
				"company": frappe.db.get_value("Warehouse", warehouse, "company"),
				"stock_uom": frappe.db.get_value("Item", item_code, "stock_uom"),
				"incoming_rate": 100,
				"valuation_rate": 100,
				"stock_value": qty * 100,
				"stock_value_difference": qty * 100,
			}
		).insert(ignore_permissions=True, ignore_links=True)

	total_qty = frappe.db.sql(
		"""
		select coalesce(sum(actual_qty), 0)
		from `tabStock Ledger Entry`
		where item_code = %s and warehouse = %s
			and docstatus < 2 and ifnull(is_cancelled, 0) = 0
		""",
		(item_code, warehouse),
	)[0][0]
	latest_sle = frappe.db.get_value(
		"Stock Ledger Entry",
		{"item_code": item_code, "warehouse": warehouse, "docstatus": ["<", 2], "is_cancelled": 0},
		"name",
		order_by="posting_datetime desc, creation desc",
	)
	if latest_sle:
		frappe.db.set_value(
			"Stock Ledger Entry", latest_sle, "qty_after_transaction", flt(total_qty), update_modified=False
		)
	bin_name = frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "name")
	if bin_name:
		frappe.db.set_value("Bin", bin_name, "actual_qty", flt(total_qty), update_modified=False)
	else:
		frappe.get_doc(
			{"doctype": "Bin", "item_code": item_code, "warehouse": warehouse, "actual_qty": flt(total_qty)}
		).insert(ignore_permissions=True)


def set_invoice_mode(invoice_mode):
	frappe.db.set_single_value("POS Settings", "invoice_type", invoice_mode)


def ensure_open_pos_opening_entry(pos_profile, period_start_date=None):
	user = frappe.session.user
	existing = frappe.db.get_value(
		"POS Opening Entry",
		{"user": user, "pos_profile": pos_profile, "status": "Open", "docstatus": 1},
		"name",
	)
	if existing:
		if period_start_date is not None:
			frappe.db.set_value(
				"POS Opening Entry", existing, "period_start_date", period_start_date, update_modified=False
			)
		return existing

	profile = frappe.get_doc("POS Profile", pos_profile)
	entry = frappe.new_doc("POS Opening Entry")
	entry.pos_profile = profile.name
	entry.user = user
	entry.company = profile.company
	entry.period_start_date = period_start_date or get_datetime()
	entry.set(
		"balance_details",
		[frappe._dict({"mode_of_payment": row.mode_of_payment}) for row in profile.get("payments", [])],
	)
	entry.submit()
	return entry.name


def create_invoice_with_item(invoice_mode="Sales Invoice"):
	from vunapos.api.sales import add_item, create_invoice

	profile = ensure_test_pos_profile()
	item_code = ensure_test_item()
	set_invoice_mode(invoice_mode)
	if invoice_mode == "POS Invoice":
		ensure_open_pos_opening_entry(profile)
	response = create_invoice(pos_profile=profile)
	assert response["ok"], response
	invoice = response["data"]
	response = add_item(invoice["doctype"], invoice["name"], item_code, 1)
	assert response["ok"], response
	return response["data"]
