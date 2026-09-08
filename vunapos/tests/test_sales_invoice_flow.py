from unittest.mock import patch

import frappe
from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, flt, nowdate

from vunapos.api.batch import allocate_batches
from vunapos.api.item import search_items
from vunapos.api.sales import (
	add_item,
	checkout_invoice,
	clear_invoice,
	create_and_submit_invoice,
	create_and_submit_sales_order,
	create_invoice,
	create_invoice_from_cart,
	hold_invoice,
	list_held_invoices,
	preview_invoice,
	remove_item,
	restore_invoice,
	submit_invoice,
	update_invoice_from_cart,
	update_item,
)
from vunapos.services.checkout_queue_service import process_queued_invoice
from vunapos.services.gateway_payment_service import (
	attach_c2b_gateway_payment,
	search_c2b_gateway_payments,
)
from vunapos.services.invoice_service import validate_payment_rows
from vunapos.tests.helpers import (
	ensure_batch_stock,
	ensure_item_tax_template,
	ensure_open_pos_opening_entry,
	ensure_sales_tax_template,
	ensure_test_batch_item,
	ensure_test_customer,
	ensure_test_item,
	ensure_test_pos_profile,
	ensure_test_shipping_address,
	ensure_test_stock_item,
	set_invoice_mode,
	set_profile_tax_template,
)


class TestVunaPOSSalesInvoiceFlow(IntegrationTestCase):
	def setUp(self):
		profile = ensure_test_pos_profile()
		frappe.db.set_value("POS Profile", profile, "allow_partial_payment", 0, update_modified=False)
		frappe.db.set_value("POS Profile", profile, "allow_rate_change", 0, update_modified=False)
		frappe.db.set_value("POS Profile", profile, "allow_discount_change", 0, update_modified=False)
		frappe.db.set_value("POS Profile", profile, "vunapos_allow_credit_sales", 0, update_modified=False)
		frappe.db.set_value(
			"POS Profile", profile, "vunapos_enable_background_submission", 0, update_modified=False
		)
		frappe.db.set_value(
			"POS Profile", profile, "vunapos_default_sale_type", "Cash Sale", update_modified=False
		)
		profile_doc = frappe.get_doc("POS Profile", profile)
		for row in profile_doc.get("payments", []):
			row.payment_gateway = None
		profile_doc.save(ignore_permissions=True)
		frappe.clear_cache(doctype="POS Profile")
		ensure_open_pos_opening_entry(profile)

	def _ensure_payment_gateway(self, gateway="_Test VunaPOS Gateway"):
		company = frappe.defaults.get_defaults().company or frappe.db.get_single_value(
			"Global Defaults", "default_company"
		)
		currency = frappe.db.get_value("Company", company, "default_currency") or "KES"
		account_name = f"{gateway} - {currency} - {frappe.db.get_value('Company', company, 'abbr')}"
		if not frappe.db.exists("Payment Gateway Account", account_name):
			account = frappe.db.get_value(
				"Account",
				{"company": company, "account_type": ["in", ("Cash", "Bank")], "is_group": 0},
				"name",
			)
			if not account:
				self.skipTest("No cash or bank account available for Payment Gateway Account fixture")
			frappe.get_doc(
				{
					"doctype": "Payment Gateway Account",
					"name": gateway,
					"payment_gateway": gateway,
					"company": company,
					"payment_account": account,
					"currency": currency,
				}
			).insert(ignore_permissions=True, ignore_links=True)
		return account_name

	def _set_profile_payment_gateway(self, profile, mode_of_payment, gateway):
		profile_doc = frappe.get_doc("POS Profile", profile)
		for row in profile_doc.get("payments", []):
			if row.mode_of_payment == mode_of_payment:
				row.payment_gateway = gateway
		profile_doc.save(ignore_permissions=True)
		frappe.clear_cache(doctype="POS Profile")

	def _make_ke_payment_request(self, gateway, amount, currency="KES"):
		if not frappe.db.table_exists("KE Payment Request"):
			self.skipTest("navari_ke_payments is not installed")
		doc = frappe.get_doc(
			{
				"doctype": "KE Payment Request",
				"provider": "Mpesa",
				"status": "Completed",
				"payment_gateway": gateway,
				"amount": amount,
				"currency": currency,
				"phone_number": "254700000000",
				"transaction_id": frappe.generate_hash(length=10),
			}
		)
		doc.insert(ignore_permissions=True)
		return doc

	def _make_c2b_payment(self, gateway, mode_of_payment, amount, currency="KES", customer=None, submit=True):
		if not frappe.db.table_exists("KE C2B Payment Register"):
			self.skipTest("navari_ke_payments is not installed")
		profile = frappe.get_doc("POS Profile", ensure_test_pos_profile())
		source = frappe.get_doc(
			{
				"doctype": "KE C2B Payment Register",
				"provider": "Mpesa",
				"transaction_id": frappe.generate_hash(length=10).upper(),
				"transaction_date": nowdate(),
				"amount": amount,
				"currency": currency,
				"party_phone": "254700000000",
				"party_name": "VunaPOS C2B Test Payer",
				"status": "Received",
				"payment_gateway": frappe.db.get_value("Payment Gateway Account", gateway, "payment_gateway"),
				"company": profile.company,
				"mode_of_payment": mode_of_payment,
				"customer": customer,
				"create_payment_entry": 0,
			}
		)
		source.insert(ignore_permissions=True, ignore_links=True)
		if submit and source.meta.is_submittable:
			source.submit()
		return source

	def _make_gateway_payment_link(self, profile, mode_of_payment, gateway, amount, source):
		opening_entry = ensure_open_pos_opening_entry(profile)
		doc = frappe.get_doc(
			{
				"doctype": "VunaPOS Gateway Payment Link",
				"source_doctype": source.doctype,
				"source_name": source.name,
				"payment_gateway": gateway,
				"mode_of_payment": mode_of_payment,
				"status": "Paid",
				"pos_profile": profile,
				"opening_entry": opening_entry,
				"cashier": frappe.session.user,
				"customer": frappe.db.get_value("POS Profile", profile, "customer"),
				"amount": amount,
				"currency": frappe.db.get_value("POS Profile", profile, "currency"),
			}
		)
		doc.insert(ignore_permissions=True)
		return doc.name

	def _batch_profile_and_item(self, item_code="_Test Vuna Batch Item"):
		profile = ensure_test_pos_profile()
		warehouse = frappe.db.get_value("POS Profile", profile, "warehouse")
		item_code = ensure_test_batch_item(item_code)
		return profile, warehouse, item_code

	def test_create_draft_sales_invoice_when_pos_settings_uses_sales_invoice(self):
		profile = ensure_test_pos_profile()
		set_invoice_mode("Sales Invoice")

		response = create_invoice(pos_profile=profile)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["doctype"], "Sales Invoice")
		self.assertEqual(response["data"]["docstatus"], 0)
		self.assertEqual(frappe.db.get_value("Sales Invoice", response["data"]["name"], "is_pos"), 1)

	def test_add_update_remove_invoice_item(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]

		response = add_item(invoice["doctype"], invoice["name"], item_code, 1)
		self.assertTrue(response["ok"], response)
		self.assertEqual(len(response["data"]["items"]), 1)

		row_name = response["data"]["items"][0]["row_name"]
		response = update_item(invoice["doctype"], invoice["name"], row_name, 3)
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["items"][0]["qty"], 3)

		response = remove_item(invoice["doctype"], invoice["name"], row_name)
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["items"], [])

	def test_create_and_submit_sales_order_from_cart(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		customer = ensure_test_customer()
		address = ensure_test_shipping_address(customer)

		response = create_and_submit_sales_order(
			pos_profile=profile,
			customer=customer,
			items=[{"item_code": item_code, "qty": 2}],
			idempotency_key="sales-order-checkout-key",
			shipping_address_name=address,
		)

		self.assertTrue(response["ok"], response)
		order = response["data"]
		self.assertEqual(order["doctype"], "Sales Order")
		self.assertEqual(order["docstatus"], 1)
		self.assertEqual(order["items"][0]["item_code"], item_code)
		self.assertEqual(order["items"][0]["qty"], 2)
		self.assertEqual(order["shipping_address_name"], address)
		self.assertEqual(frappe.db.get_value("Sales Order", order["name"], "vunapos_invoice"), 1)
		self.assertEqual(
			frappe.db.get_value("Sales Order", order["name"], "vunapos_pos_profile"),
			profile,
		)
		self.assertEqual(
			frappe.db.get_value("Sales Order", order["name"], "vunapos_session_cashier"),
			frappe.session.user,
		)

	def test_checkout_persists_customer_shipping_address(self):
		profile = ensure_test_pos_profile()
		customer = ensure_test_customer()
		address = ensure_test_shipping_address(customer)
		item_code = ensure_test_item()

		response = create_and_submit_invoice(
			pos_profile=profile,
			customer=customer,
			items=[{"item_code": item_code, "qty": 1}],
			payments=[{"mode_of_payment": "Cash", "amount": 100}],
			idempotency_key="shipping-address-checkout-key",
			shipping_address_name=address,
		)

		self.assertTrue(response["ok"], response)
		invoice = response["data"]
		self.assertEqual(invoice["shipping_address_name"], address)
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", invoice["name"], "shipping_address_name"),
			address,
		)

	def test_checkout_rejects_shipping_address_for_another_customer(self):
		profile = ensure_test_pos_profile()
		customer = ensure_test_customer()
		other_customer = frappe.db.get_value("Customer", {"name": ["!=", customer]}, "name")
		if not other_customer:
			self.skipTest("A second customer is required for address ownership coverage")
		address = ensure_test_shipping_address(other_customer)
		item_code = ensure_test_item()

		response = create_and_submit_invoice(
			pos_profile=profile,
			customer=customer,
			items=[{"item_code": item_code, "qty": 1}],
			payments=[{"mode_of_payment": "Cash", "amount": 100}],
			idempotency_key="shipping-address-ownership-key",
			shipping_address_name=address,
		)

		self.assertFalse(response["ok"])
		self.assertEqual(response["errors"][0]["code"], "ValidationError")

	def test_sales_order_checkout_with_same_idempotency_key_does_not_duplicate(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()

		first = create_and_submit_sales_order(
			pos_profile=profile,
			items=[{"item_code": item_code, "qty": 1}],
			idempotency_key="same-sales-order-key",
		)
		second = create_and_submit_sales_order(
			pos_profile=profile,
			items=[{"item_code": item_code, "qty": 1}],
			idempotency_key="same-sales-order-key",
		)

		self.assertTrue(first["ok"], first)
		self.assertTrue(second["ok"], second)
		self.assertEqual(first["data"]["name"], second["data"]["name"])

	def test_manual_rate_change_requires_profile_permission(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		frappe.db.set_value("POS Profile", profile, "allow_rate_change", 0, update_modified=False)

		response = preview_invoice(
			pos_profile=profile,
			items=[{"item_code": item_code, "qty": 2, "pricing_override": {"type": "rate", "value": 80}}],
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "RATE_CHANGE_NOT_ALLOWED")

		frappe.db.set_value("POS Profile", profile, "allow_rate_change", 1, update_modified=False)
		response = preview_invoice(
			pos_profile=profile,
			items=[{"item_code": item_code, "qty": 2, "pricing_override": {"type": "rate", "value": 80}}],
		)
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["items"][0]["rate"], 80)

	def test_preview_reprices_cart_when_quantity_crosses_pricing_rule_threshold(self):
		profile_name = ensure_test_pos_profile()
		profile = frappe.get_doc("POS Profile", profile_name)
		item_code = ensure_test_item()
		rule = frappe.get_doc(
			{
				"doctype": "Pricing Rule",
				"title": "_Test VunaPOS Cart Quantity Discount",
				"company": profile.company,
				"apply_on": "Item Code",
				"items": [{"item_code": item_code}],
				"selling": 1,
				"currency": profile.currency,
				"price_or_product_discount": "Price",
				"rate_or_discount": "Discount Percentage",
				"discount_percentage": 20,
				"min_qty": 5,
				"priority": 1,
			}
		).insert(ignore_permissions=True)
		self.addCleanup(lambda: frappe.delete_doc("Pricing Rule", rule.name, force=True))

		below_threshold = preview_invoice(
			pos_profile=profile_name,
			items=[{"item_code": item_code, "qty": 1}],
		)
		qualified = preview_invoice(
			pos_profile=profile_name,
			items=[{"item_code": item_code, "qty": 5}],
		)

		self.assertTrue(below_threshold["ok"], below_threshold)
		self.assertTrue(qualified["ok"], qualified)
		self.assertEqual(below_threshold["data"]["items"][0]["rate"], 100)
		self.assertEqual(qualified["data"]["items"][0]["rate"], 80)
		self.assertEqual(qualified["data"]["items"][0]["discount_percentage"], 20)

	def test_checkout_allows_erpnext_pricing_rule_without_rate_change_permission(self):
		profile_name = ensure_test_pos_profile()
		profile = frappe.get_doc("POS Profile", profile_name)
		item_code = ensure_test_item()
		frappe.db.set_value("POS Profile", profile_name, "allow_rate_change", 0, update_modified=False)
		rule = frappe.get_doc(
			{
				"doctype": "Pricing Rule",
				"title": "_Test VunaPOS Checkout Discount",
				"company": profile.company,
				"apply_on": "Item Code",
				"items": [{"item_code": item_code}],
				"selling": 1,
				"currency": profile.currency,
				"price_or_product_discount": "Price",
				"rate_or_discount": "Discount Percentage",
				"discount_percentage": 20,
				"min_qty": 1,
				"priority": 1,
			}
		).insert(ignore_permissions=True)
		self.addCleanup(lambda: frappe.delete_doc("Pricing Rule", rule.name, force=True))

		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile_name)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": "Cash", "amount": 80}],
		)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["items"][0]["rate"], 80)
		self.assertEqual(response["data"]["items"][0]["discount_percentage"], 20)

	def test_manual_discount_change_requires_profile_permission(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		frappe.db.set_value("POS Profile", profile, "allow_discount_change", 0, update_modified=False)

		response = preview_invoice(
			pos_profile=profile,
			items=[
				{
					"item_code": item_code,
					"qty": 1,
					"pricing_override": {"type": "discount_percentage", "value": 10},
				}
			],
		)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "DISCOUNT_CHANGE_NOT_ALLOWED")

		frappe.db.set_value("POS Profile", profile, "allow_discount_change", 1, update_modified=False)
		response = preview_invoice(
			pos_profile=profile,
			items=[
				{
					"item_code": item_code,
					"qty": 1,
					"pricing_override": {"type": "discount_percentage", "value": 10},
				}
			],
		)
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["items"][0]["discount_percentage"], 10)

	def test_checkout_rejects_a_draft_rate_changed_outside_vunapos(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		row_name = invoice["items"][0]["row_name"]
		frappe.db.set_value("Sales Invoice Item", row_name, "rate", 80, update_modified=False)

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": "Cash", "amount": 100}],
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "RATE_CHANGE_NOT_ALLOWED")

	def test_batch_allocation_api_returns_expected_rows(self):
		profile, warehouse, item_code = self._batch_profile_and_item("_Test Vuna Batch API Item")
		ensure_batch_stock(
			item_code,
			warehouse,
			[
				("VUNA-BATCH-API-A", 2, add_days(nowdate(), 30)),
				("VUNA-BATCH-API-B", 3, add_days(nowdate(), 60)),
			],
		)

		response = allocate_batches(item_code=item_code, qty=5, pos_profile=profile)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["allocated_qty"], 5)
		self.assertEqual(
			[row["batch_no"] for row in response["data"]["allocations"]],
			["VUNA-BATCH-API-A", "VUNA-BATCH-API-B"],
		)

	def test_batch_item_with_one_available_batch_auto_allocates(self):
		profile, warehouse, item_code = self._batch_profile_and_item("_Test Vuna Batch One Item")
		ensure_batch_stock(item_code, warehouse, [("VUNA-BATCH-ONE-A", 5, add_days(nowdate(), 30))])
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]

		response = add_item(invoice["doctype"], invoice["name"], item_code, 2)

		self.assertTrue(response["ok"], response)
		item = response["data"]["items"][0]
		self.assertEqual(item["batch_no"], "VUNA-BATCH-ONE-A")
		self.assertEqual(item["batch_allocations"][0]["batch_no"], "VUNA-BATCH-ONE-A")

	def test_batch_item_splits_allocation_across_multiple_batches(self):
		profile, warehouse, item_code = self._batch_profile_and_item("_Test Vuna Batch Split Item")
		ensure_batch_stock(
			item_code,
			warehouse,
			[
				("VUNA-BATCH-SPLIT-A", 2, add_days(nowdate(), 30)),
				("VUNA-BATCH-SPLIT-B", 3, add_days(nowdate(), 60)),
			],
		)
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]

		response = add_item(invoice["doctype"], invoice["name"], item_code, 5)

		self.assertTrue(response["ok"], response)
		items = response["data"]["items"]
		self.assertEqual(len(items), 1)
		self.assertIsNone(items[0]["batch_no"])
		self.assertEqual(items[0]["qty"], 5)
		self.assertEqual(
			[allocation["batch_no"] for allocation in items[0]["batch_allocations"]],
			["VUNA-BATCH-SPLIT-A", "VUNA-BATCH-SPLIT-B"],
		)

	def test_manual_multi_batch_allocation_creates_native_bundle(self):
		profile, warehouse, item_code = self._batch_profile_and_item("_Test Vuna Manual Batch Item")
		ensure_batch_stock(
			item_code,
			warehouse,
			[
				("VUNA-MANUAL-BATCH-A", 4, add_days(nowdate(), 30)),
				("VUNA-MANUAL-BATCH-B", 6, add_days(nowdate(), 60)),
			],
		)
		set_invoice_mode("Sales Invoice")

		response = create_invoice_from_cart(
			pos_profile=profile,
			items=[
				{
					"item_code": item_code,
					"qty": 5,
					"batch_allocations": [
						{"batch_no": "VUNA-MANUAL-BATCH-A", "qty": 2},
						{"batch_no": "VUNA-MANUAL-BATCH-B", "qty": 3},
					],
				}
			],
		)

		self.assertTrue(response["ok"], response)
		item = response["data"]["items"][0]
		self.assertIsNone(item["batch_no"])
		self.assertTrue(item["serial_and_batch_bundle"])
		bundle = frappe.get_doc("Serial and Batch Bundle", item["serial_and_batch_bundle"])
		self.assertEqual(
			[(row.batch_no, abs(flt(row.qty))) for row in bundle.entries],
			[("VUNA-MANUAL-BATCH-A", 2), ("VUNA-MANUAL-BATCH-B", 3)],
		)

	def test_manual_batch_allocation_rejects_duplicate_batch_rows(self):
		profile, warehouse, item_code = self._batch_profile_and_item("_Test Vuna Duplicate Batch Item")
		ensure_batch_stock(item_code, warehouse, [("VUNA-DUP-BATCH-A", 5, add_days(nowdate(), 30))])

		response = create_invoice_from_cart(
			pos_profile=profile,
			items=[
				{
					"item_code": item_code,
					"qty": 2,
					"batch_allocations": [
						{"batch_no": "VUNA-DUP-BATCH-A", "qty": 1},
						{"batch_no": "VUNA-DUP-BATCH-A", "qty": 1},
					],
				}
			],
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "DUPLICATE_BATCH_ALLOCATION")

	def test_batch_allocation_skips_expired_batch(self):
		profile, warehouse, item_code = self._batch_profile_and_item("_Test Vuna Batch Expiry Item")
		ensure_batch_stock(
			item_code,
			warehouse,
			[
				("VUNA-BATCH-EXP-OLD", 5, add_days(nowdate(), -1)),
				("VUNA-BATCH-EXP-NEW", 5, add_days(nowdate(), 30)),
			],
		)

		response = allocate_batches(item_code=item_code, qty=4, pos_profile=profile)

		self.assertTrue(response["ok"], response)
		self.assertEqual([row["batch_no"] for row in response["data"]["allocations"]], ["VUNA-BATCH-EXP-NEW"])

	def test_batch_allocation_insufficient_stock_returns_clear_error(self):
		profile, warehouse, item_code = self._batch_profile_and_item("_Test Vuna Batch Low Item")
		ensure_batch_stock(item_code, warehouse, [("VUNA-BATCH-LOW-A", 1, add_days(nowdate(), 30))])

		response = allocate_batches(item_code=item_code, qty=5, pos_profile=profile)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "INSUFFICIENT_BATCH_STOCK")

	def test_serial_tracked_item_returns_serial_selection_required(self):
		profile, _warehouse, item_code = self._batch_profile_and_item("_Test Vuna Serial Item")
		ensure_test_batch_item(item_code, has_serial_no=1)

		response = allocate_batches(item_code=item_code, qty=1, pos_profile=profile)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "SERIAL_SELECTION_REQUIRED")

	def test_batch_required_item_cannot_checkout_without_allocation(self):
		profile, warehouse, item_code = self._batch_profile_and_item(
			"_Test Vuna Batch Missing Allocation Item"
		)
		ensure_batch_stock(item_code, warehouse, [("VUNA-BATCH-MISSING-A", 5, add_days(nowdate(), 30))])
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		row_name = invoice["items"][0]["row_name"]
		frappe.db.set_value("Sales Invoice Item", row_name, "batch_no", None)
		frappe.db.set_value("Sales Invoice Item", row_name, "serial_and_batch_bundle", None)

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[
				{
					"mode_of_payment": "Cash",
					"amount": invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"],
				}
			],
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "BATCH_ALLOCATION_REQUIRED")

	def test_checkout_validates_batch_allocation_again(self):
		profile, warehouse, item_code = self._batch_profile_and_item("_Test Vuna Batch Checkout Item")
		ensure_batch_stock(item_code, warehouse, [("VUNA-BATCH-CHECKOUT-A", 1, add_days(nowdate(), 30))])
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		frappe.get_doc(
			{
				"doctype": "Stock Ledger Entry",
				"item_code": item_code,
				"warehouse": warehouse,
				"batch_no": "VUNA-BATCH-CHECKOUT-A",
				"posting_date": nowdate(),
				"posting_time": "23:59:59",
				"actual_qty": -1,
				"qty_after_transaction": 0,
				"voucher_type": "Stock Entry",
				"voucher_no": "VUNA-BATCH-CHECKOUT-CONSUME",
				"company": frappe.db.get_value("Warehouse", warehouse, "company"),
				"stock_uom": frappe.db.get_value("Item", item_code, "stock_uom"),
				"incoming_rate": 100,
				"valuation_rate": 100,
				"stock_value": 0,
				"stock_value_difference": -100,
			}
		).insert(ignore_permissions=True, ignore_links=True)

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[
				{
					"mode_of_payment": "Cash",
					"amount": invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"],
				}
			],
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "INSUFFICIENT_BATCH_STOCK")

	def test_checkout_blocks_over_allocated_batch_across_rows(self):
		profile, warehouse, item_code = self._batch_profile_and_item("_Test Vuna Batch Duplicate Row Item")
		ensure_batch_stock(item_code, warehouse, [("VUNA-BATCH-DUP-A", 1, add_days(nowdate(), 30))])
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]

		response = add_item(invoice["doctype"], invoice["name"], item_code, 1)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "INSUFFICIENT_BATCH_STOCK")

	def test_submit_invoice_with_payment_data(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]

		response = submit_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": "Cash", "amount": amount, "default": 1}],
		)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["docstatus"], 1)
		self.assertEqual(response["data"]["payments"][0]["mode_of_payment"], "Cash")

	def test_checkout_applies_tax_id_for_walkin_customer(self):
		profile = ensure_test_pos_profile()
		customer = frappe.db.get_value("POS Profile", profile, "customer")
		frappe.db.set_value("Customer", customer, "is_walkin", 1, update_modified=False)
		frappe.clear_cache(doctype="Customer")
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": "Cash", "amount": amount, "default": 1}],
			tax_id="P051234567A",
		)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["tax_id"], "P051234567A")
		self.assertEqual(
			frappe.db.get_value(response["data"]["doctype"], response["data"]["name"], "tax_id"),
			"P051234567A",
		)

	def test_checkout_rejects_tax_id_for_non_walkin_customer(self):
		profile = ensure_test_pos_profile()
		customer = frappe.db.get_value("POS Profile", profile, "customer")
		frappe.db.set_value("Customer", customer, "is_walkin", 0, update_modified=False)
		frappe.clear_cache(doctype="Customer")
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": "Cash", "amount": amount, "default": 1}],
			tax_id="P051234567A",
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "CUSTOMER_TAX_ID_NOT_ALLOWED")

	def test_submit_invoice_rejects_missing_payment_rows(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]

		response = submit_invoice(invoice["doctype"], invoice["name"], payments=[])

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "NO_PAYMENT_ROWS")

	def test_checkout_blocks_empty_invoice(self):
		profile = ensure_test_pos_profile()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": "Cash", "amount": 100}],
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "EMPTY_INVOICE")

	def test_checkout_blocks_submitted_invoice_without_idempotency_match(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		submitted = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": "Cash", "amount": amount}],
		)["data"]

		response = checkout_invoice(
			submitted["doctype"],
			submitted["name"],
			payments=[{"mode_of_payment": "Cash", "amount": amount}],
			idempotency_key="different-key",
		)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["name"], submitted["name"])

	def test_checkout_blocks_no_payment_rows(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]

		response = checkout_invoice(invoice["doctype"], invoice["name"], payments=[])

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "NO_PAYMENT_ROWS")

	def test_checkout_blocks_payment_total_mismatch(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": "Cash", "amount": 1}],
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "PAYMENT_TOTAL_MISMATCH")

	def test_checkout_blocks_duplicate_payment_modes(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[
				{"mode_of_payment": "Cash", "amount": amount / 2},
				{"mode_of_payment": "Cash", "amount": amount / 2},
			],
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "DUPLICATE_PAYMENT_MODE")

	def test_checkout_blocks_non_finite_and_invalid_payment_amounts(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]

		for invalid_amount in (
			None,
			True,
			"not-a-number",
			"NaN",
			"Infinity",
			"-Infinity",
			"1e10000",
			0,
			-1,
		):
			with self.subTest(amount=invalid_amount):
				response = checkout_invoice(
					invoice["doctype"],
					invoice["name"],
					payments=[{"mode_of_payment": "Cash", "amount": invalid_amount}],
				)
				self.assertFalse(response["ok"], response)
				self.assertEqual(response["errors"][0]["code"], "INVALID_PAYMENT_AMOUNT")

	def test_checkout_rejects_manual_amount_for_gateway_controlled_mode(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		gateway = self._ensure_payment_gateway()
		mode = frappe.get_doc("POS Profile", profile).get("payments")[0].mode_of_payment
		self._set_profile_payment_gateway(profile, mode, gateway)
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": mode, "amount": amount}],
			idempotency_key="manual-gateway-rejected",
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "GATEWAY_PAYMENT_REQUIRED")

	def test_checkout_consumes_verified_gateway_payment_link(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		gateway = self._ensure_payment_gateway()
		mode = frappe.get_doc("POS Profile", profile).get("payments")[0].mode_of_payment
		self._set_profile_payment_gateway(profile, mode, gateway)
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		source = self._make_ke_payment_request(
			gateway, amount, frappe.db.get_value("POS Profile", profile, "currency")
		)
		link = self._make_gateway_payment_link(profile, mode, gateway, amount, source)

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": mode, "gateway_payment_link": link}],
			idempotency_key="verified-gateway-consumed",
		)

		self.assertTrue(response["ok"], response)
		self.assertEqual(frappe.db.get_value("VunaPOS Gateway Payment Link", link, "consumed"), 1)
		self.assertEqual(
			frappe.db.get_value("VunaPOS Gateway Payment Link", link, "consumed_by_name"),
			response["data"]["name"],
		)

	def test_c2b_search_excludes_reserved_gateway_payment(self):
		profile = ensure_test_pos_profile()
		gateway = self._ensure_payment_gateway()
		mode = frappe.get_doc("POS Profile", profile).get("payments")[0].mode_of_payment
		self._set_profile_payment_gateway(profile, mode, gateway)
		currency = frappe.db.get_value("POS Profile", profile, "currency")
		source = self._make_c2b_payment(gateway, mode, 100, currency=currency)

		before_attach = search_c2b_gateway_payments(
			pos_profile=profile,
			mode_of_payment=mode,
			query=source.transaction_id[:4],
			currency=currency,
		)
		self.assertTrue(any(row["name"] == source.name for row in before_attach), before_attach)

		attach_c2b_gateway_payment(
			pos_profile=profile,
			mode_of_payment=mode,
			transaction_reference=source.transaction_id,
			amount=100,
			currency=currency,
			idempotency_key="reserved-c2b-search-hidden",
		)

		after_attach = search_c2b_gateway_payments(
			pos_profile=profile,
			mode_of_payment=mode,
			query=source.transaction_id[:4],
			currency=currency,
		)
		self.assertFalse(any(row["name"] == source.name for row in after_attach), after_attach)

	def test_checkout_consumes_c2b_source_and_disables_ke_payment_entry_creation(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		gateway = self._ensure_payment_gateway()
		mode = frappe.get_doc("POS Profile", profile).get("payments")[0].mode_of_payment
		self._set_profile_payment_gateway(profile, mode, gateway)
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		currency = frappe.db.get_value("POS Profile", profile, "currency")
		source = self._make_c2b_payment(gateway, mode, amount, currency=currency, submit=False)
		link = attach_c2b_gateway_payment(
			pos_profile=profile,
			mode_of_payment=mode,
			transaction_reference=source.transaction_id,
			amount=amount,
			currency=currency,
			idempotency_key="consume-c2b-source",
		)

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": mode, "gateway_payment_link": link["name"]}],
			idempotency_key="consume-c2b-source-checkout",
		)

		self.assertTrue(response["ok"], response)
		source.reload()
		self.assertEqual(source.docstatus, 1)
		self.assertEqual(source.reference_doctype, response["data"]["doctype"])
		self.assertEqual(source.reference_docname, response["data"]["name"])
		self.assertEqual(source.is_reconciled, 1)
		self.assertEqual(source.reconciliation_status, "Reconciled")
		self.assertEqual(source.create_payment_entry, 0)
		self.assertEqual(flt(source.allocated_amount), flt(amount))
		self.assertEqual(flt(source.unallocated_amount), 0)

	def test_payment_validation_accepts_split_at_currency_precision(self):
		doc = frappe._dict({"rounded_total": 100, "grand_total": 100})
		doc.precision = lambda _fieldname: 2
		profile = frappe._dict(
			{
				"payments": [
					frappe._dict({"mode_of_payment": "Cash"}),
					frappe._dict({"mode_of_payment": "M-Pesa"}),
				]
			}
		)

		rows = validate_payment_rows(
			doc,
			[
				{"mode_of_payment": "Cash", "amount": "25.25"},
				{"mode_of_payment": "M-Pesa", "amount": "74.75"},
			],
			profile,
		)

		self.assertEqual(
			rows,
			[
				{"mode_of_payment": "Cash", "amount": 25.25, "default": None, "gateway_payment_link": None},
				{"mode_of_payment": "M-Pesa", "amount": 74.75, "default": None, "gateway_payment_link": None},
			],
		)

	def test_payment_validation_subtracts_loyalty_redemption_from_amount_due(self):
		doc = frappe._dict({"rounded_total": 100, "grand_total": 100, "loyalty_amount": 25})
		doc.precision = lambda _fieldname: 2
		profile = frappe._dict(
			{"allow_partial_payment": 0, "payments": [frappe._dict({"mode_of_payment": "Cash"})]}
		)

		rows = validate_payment_rows(doc, [{"mode_of_payment": "Cash", "amount": 75}], profile)

		self.assertEqual(rows[0]["amount"], 75)

	def test_payment_validation_accepts_no_rows_when_loyalty_covers_total(self):
		doc = frappe._dict({"rounded_total": 100, "grand_total": 100, "loyalty_amount": 100})
		doc.precision = lambda _fieldname: 2
		profile = frappe._dict(
			{"allow_partial_payment": 0, "payments": [frappe._dict({"mode_of_payment": "Cash"})]}
		)

		self.assertEqual(validate_payment_rows(doc, [], profile), [])

	def test_payment_validation_allows_cash_overpayment_for_change(self):
		doc = frappe._dict({"rounded_total": 654, "grand_total": 654})
		doc.precision = lambda _fieldname: 2
		profile = frappe._dict(
			{"allow_partial_payment": 0, "payments": [frappe._dict({"mode_of_payment": "Cash"})]}
		)

		with patch("vunapos.services.invoice_service._payment_mode_type", return_value="Cash"):
			rows = validate_payment_rows(doc, [{"mode_of_payment": "Cash", "amount": 700}], profile)

		self.assertEqual(rows[0]["amount"], 700)

	def test_payment_validation_rejects_non_cash_overpayment(self):
		doc = frappe._dict({"rounded_total": 654, "grand_total": 654})
		doc.precision = lambda _fieldname: 2
		profile = frappe._dict(
			{"allow_partial_payment": 0, "payments": [frappe._dict({"mode_of_payment": "M-Pesa"})]}
		)

		with patch("vunapos.services.invoice_service._payment_mode_type", return_value="Phone"):
			with self.assertRaises(frappe.ValidationError) as context:
				validate_payment_rows(doc, [{"mode_of_payment": "M-Pesa", "amount": 700}], profile)

		self.assertEqual(context.exception.vuna_error_code, "NON_CASH_OVERPAYMENT")

	def test_payment_validation_allows_underpayment_only_for_partial_payment_profile(self):
		doc = frappe._dict({"rounded_total": 654, "grand_total": 654})
		doc.precision = lambda _fieldname: 2
		profile = frappe._dict(
			{"allow_partial_payment": 1, "payments": [frappe._dict({"mode_of_payment": "Cash"})]}
		)

		with patch("vunapos.services.invoice_service._payment_mode_type", return_value="Cash"):
			rows = validate_payment_rows(doc, [{"mode_of_payment": "Cash", "amount": 500}], profile)

		self.assertEqual(rows[0]["amount"], 500)

	def test_checkout_submits_valid_invoice(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": "Cash", "amount": amount}],
			idempotency_key="valid-checkout-key",
		)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["docstatus"], 1)
		self.assertEqual(response["data"]["payments"][0]["mode_of_payment"], "Cash")

	def test_checkout_cash_overpayment_calculates_change(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": "Cash", "amount": amount + 46}],
		)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["totals"]["paid_amount"], amount + 46)
		self.assertEqual(response["data"]["totals"]["change_amount"], 46)
		self.assertEqual(response["data"]["totals"]["outstanding_amount"], 0)

	def test_checkout_accepts_underpayment_when_profile_allows_partial_payment(self):
		profile = ensure_test_pos_profile()
		frappe.db.set_value("POS Profile", profile, "allow_partial_payment", 1, update_modified=False)
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]

		try:
			response = checkout_invoice(
				invoice["doctype"],
				invoice["name"],
				payments=[{"mode_of_payment": "Cash", "amount": amount - 10}],
			)
		finally:
			frappe.db.set_value("POS Profile", profile, "allow_partial_payment", 0, update_modified=False)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["totals"]["paid_amount"], amount - 10)
		self.assertEqual(response["data"]["totals"]["outstanding_amount"], 10)

	def test_checkout_rejects_credit_sale_when_profile_disallows_it(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[],
			is_credit_sale=True,
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "CREDIT_SALES_NOT_ALLOWED")
		self.assertEqual(frappe.db.get_value(invoice["doctype"], invoice["name"], "docstatus"), 0)

	def test_checkout_submits_fully_unpaid_credit_sale(self):
		profile = ensure_test_pos_profile()
		frappe.db.set_value("POS Profile", profile, "vunapos_allow_credit_sales", 1, update_modified=False)
		frappe.clear_cache(doctype="POS Profile")
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[],
			is_credit_sale=True,
			due_date=nowdate(),
			idempotency_key="fully-unpaid-credit-sale",
		)

		self.assertTrue(response["ok"], response)
		self.assertTrue(response["data"]["is_credit_sale"])
		self.assertEqual(response["data"]["payments"], [])
		self.assertEqual(response["data"]["totals"]["paid_amount"], 0)
		self.assertEqual(response["data"]["totals"]["outstanding_amount"], amount)
		self.assertEqual(frappe.db.get_value(invoice["doctype"], invoice["name"], "vunapos_credit_sale"), 1)
		self.assertEqual(response["data"]["due_date"], nowdate())

	def test_checkout_accepts_credit_sale_deposit_without_partial_payment_setting(self):
		profile = ensure_test_pos_profile()
		frappe.db.set_value("POS Profile", profile, "vunapos_allow_credit_sales", 1, update_modified=False)
		frappe.clear_cache(doctype="POS Profile")
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		deposit = amount / 2

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": "Cash", "amount": deposit}],
			is_credit_sale=True,
			due_date=add_days(nowdate(), 30),
		)

		self.assertTrue(response["ok"], response)
		self.assertTrue(response["data"]["is_credit_sale"])
		self.assertEqual(response["data"]["totals"]["paid_amount"], deposit)
		self.assertEqual(response["data"]["totals"]["outstanding_amount"], amount - deposit)
		self.assertEqual(response["data"]["due_date"], add_days(nowdate(), 30))

	def test_checkout_credit_sale_requires_due_date(self):
		profile = ensure_test_pos_profile()
		frappe.db.set_value("POS Profile", profile, "vunapos_allow_credit_sales", 1, update_modified=False)
		frappe.clear_cache(doctype="POS Profile")
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], ensure_test_item(), 1)["data"]

		response = checkout_invoice(invoice["doctype"], invoice["name"], payments=[], is_credit_sale=True)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "CREDIT_DUE_DATE_REQUIRED")

	def test_checkout_credit_sale_rejects_past_due_date(self):
		profile = ensure_test_pos_profile()
		frappe.db.set_value("POS Profile", profile, "vunapos_allow_credit_sales", 1, update_modified=False)
		frappe.clear_cache(doctype="POS Profile")
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], ensure_test_item(), 1)["data"]

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[],
			is_credit_sale=True,
			due_date=add_days(nowdate(), -1),
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "CREDIT_DUE_DATE_INVALID")

	def test_checkout_credit_sale_requires_customer(self):
		profile = ensure_test_pos_profile()
		frappe.db.set_value("POS Profile", profile, "vunapos_allow_credit_sales", 1, update_modified=False)
		frappe.clear_cache(doctype="POS Profile")
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		frappe.db.set_value(invoice["doctype"], invoice["name"], "customer", None, update_modified=False)

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[],
			is_credit_sale=True,
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "CREDIT_CUSTOMER_REQUIRED")

	def test_checkout_requires_current_open_session(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		opening_entry = ensure_open_pos_opening_entry(profile)
		frappe.db.set_value("POS Opening Entry", opening_entry, "status", "Closed")

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[
				{
					"mode_of_payment": "Cash",
					"amount": invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"],
				}
			],
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "POS_OPENING_REQUIRED")

	def test_checkout_with_same_idempotency_key_does_not_duplicate(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		key = "same-checkout-key"

		first = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": "Cash", "amount": amount}],
			idempotency_key=key,
		)
		second = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": "Cash", "amount": amount}],
			idempotency_key=key,
		)

		self.assertTrue(first["ok"], first)
		self.assertTrue(second["ok"], second)
		self.assertEqual(second["data"]["name"], first["data"]["name"])
		self.assertEqual(frappe.db.count("Sales Invoice", {"vunapos_idempotency_key": key}), 1)

	def test_direct_checkout_resumes_draft_with_same_idempotency_key(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		key = "resume-draft-checkout-key"
		frappe.db.set_value("Sales Invoice", invoice["name"], "vunapos_idempotency_key", key)

		response = create_and_submit_invoice(
			pos_profile=profile,
			customer=invoice["customer"],
			items=[{"item_code": item_code, "qty": 1}],
			payments=[{"mode_of_payment": "Cash", "amount": amount}],
			idempotency_key=key,
		)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["name"], invoice["name"])
		self.assertEqual(frappe.db.count("Sales Invoice", {"vunapos_idempotency_key": key}), 1)

	def test_direct_cash_checkout_accepts_url_encoded_false_credit_flag(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")

		response = create_and_submit_invoice(
			pos_profile=profile,
			items=[{"item_code": item_code, "qty": 1}],
			payments=[{"mode_of_payment": "Cash", "amount": 100}],
			idempotency_key="url-encoded-false-credit-flag",
			is_credit_sale="false",
		)

		self.assertTrue(response["ok"], response)
		self.assertFalse(response["data"]["is_credit_sale"])

	def test_direct_credit_checkout_accepts_url_encoded_true_credit_flag(self):
		profile = ensure_test_pos_profile()
		frappe.db.set_value("POS Profile", profile, "vunapos_allow_credit_sales", 1, update_modified=False)
		frappe.clear_cache(doctype="POS Profile")
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")

		response = create_and_submit_invoice(
			pos_profile=profile,
			items=[{"item_code": item_code, "qty": 1}],
			payments=[],
			idempotency_key="url-encoded-true-credit-flag",
			is_credit_sale="true",
			due_date=nowdate(),
		)

		self.assertTrue(response["ok"], response)
		self.assertTrue(response["data"]["is_credit_sale"])

	@patch("frappe.enqueue")
	def test_background_enabled_checkout_reserves_then_queues_submission(self, enqueue):
		profile_name = ensure_test_pos_profile()
		profile = frappe.get_doc("POS Profile", profile_name)
		frappe.db.set_value("Customer", profile.customer, "is_walkin", 1, update_modified=False)
		frappe.clear_cache(doctype="Customer")
		item_code = ensure_test_stock_item("_Test VunaPOS Reserved Checkout Item")
		set_invoice_mode("Sales Invoice")
		frappe.db.set_single_value("Stock Settings", "enable_stock_reservation", 1)
		frappe.db.set_value(
			"POS Profile",
			profile_name,
			"vunapos_enable_background_submission",
			1,
			update_modified=False,
		)
		frappe.clear_cache(doctype="POS Profile")
		make_stock_entry(item_code=item_code, to_warehouse=profile.warehouse, qty=5, rate=100)

		response = create_and_submit_invoice(
			pos_profile=profile_name,
			items=[{"item_code": item_code, "qty": 2}],
			payments=[{"mode_of_payment": "Cash", "amount": 200}],
			idempotency_key="reserved-synchronous-checkout",
			tax_id="P051234567A",
		)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["docstatus"], 0)
		self.assertEqual(response["data"]["queue_status"], "Queued")
		self.assertEqual(response["data"]["tax_id"], "P051234567A")
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", response["data"]["name"], "tax_id"), "P051234567A"
		)
		reservations = frappe.get_all(
			"Stock Reservation Entry",
			filters={"voucher_type": "Sales Invoice", "voucher_no": response["data"]["name"]},
			fields=["docstatus"],
		)
		self.assertEqual(len(reservations), 1)
		self.assertEqual(reservations[0].docstatus, 1)
		catalogue = search_items(query=item_code, pos_profile=profile_name)
		self.assertTrue(catalogue["ok"], catalogue)
		catalogue_item = next(row for row in catalogue["data"] if row["item_code"] == item_code)
		self.assertEqual(catalogue_item["actual_qty"], 3)
		enqueue.assert_called_once_with(
			"vunapos.services.checkout_queue_service.process_queued_invoice",
			queue="short",
			timeout=300,
			enqueue_after_commit=True,
			job_id=response["data"]["queue_job_id"],
			deduplicate=True,
			invoice_doctype="Sales Invoice",
			invoice_name=response["data"]["name"],
		)

		with patch("frappe.db.commit"):
			processed = process_queued_invoice("Sales Invoice", response["data"]["name"])

		self.assertEqual(processed["status"], "Submitted")
		self.assertEqual(frappe.db.get_value("Sales Invoice", response["data"]["name"], "docstatus"), 1)
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", response["data"]["name"], "tax_id"), "P051234567A"
		)
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", response["data"]["name"], "vunapos_queue_status"),
			"Submitted",
		)
		self.assertEqual(
			frappe.db.get_value(
				"Stock Reservation Entry", {"voucher_no": response["data"]["name"]}, "docstatus"
			),
			2,
		)

	@patch("frappe.enqueue")
	def test_background_checkout_falls_back_to_direct_submission_without_stock_reservation(self, enqueue):
		profile_name = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		frappe.db.set_single_value("Stock Settings", "enable_stock_reservation", 0)
		frappe.db.set_value(
			"POS Profile",
			profile_name,
			"vunapos_enable_background_submission",
			1,
			update_modified=False,
		)
		frappe.clear_cache(doctype="POS Profile")

		response = create_and_submit_invoice(
			pos_profile=profile_name,
			items=[{"item_code": item_code, "qty": 1}],
			payments=[{"mode_of_payment": "Cash", "amount": 100}],
			idempotency_key="direct-checkout-without-stock-reservation",
		)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["docstatus"], 1)
		self.assertFalse(response["data"].get("queue_status"))
		enqueue.assert_not_called()

	def test_hold_list_restore_and_clear_invoice(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]

		response = hold_invoice(invoice["doctype"], invoice["name"])
		self.assertTrue(response["ok"], response)
		self.assertTrue(response["data"]["is_held"])

		response = list_held_invoices(pos_profile=profile)
		self.assertTrue(response["ok"], response)
		held_names = [row["name"] for row in response["data"]]
		self.assertIn(invoice["name"], held_names)

		response = restore_invoice(invoice["doctype"], invoice["name"])
		self.assertTrue(response["ok"], response)
		self.assertFalse(response["data"]["is_held"])
		self.assertEqual(len(response["data"]["items"]), 1)

		response = clear_invoice(invoice["doctype"], invoice["name"])
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["items"], [])
		self.assertEqual(response["data"]["totals"]["grand_total"], 0)

	def test_update_invoice_from_cart_replaces_draft_items(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		response = hold_invoice(invoice["doctype"], invoice["name"])
		self.assertTrue(response["ok"], response)
		response = restore_invoice(invoice["doctype"], invoice["name"])
		self.assertTrue(response["ok"], response)

		response = update_invoice_from_cart(
			invoice["doctype"],
			invoice["name"],
			items=[{"item_code": item_code, "qty": 4}],
		)

		self.assertTrue(response["ok"], response)
		self.assertEqual(len(response["data"]["items"]), 1)
		self.assertEqual(response["data"]["items"][0]["qty"], 4)

	def test_hold_restore_clear_block_submitted_invoice(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], item_code, 1)["data"]
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		invoice = submit_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": "Cash", "amount": amount, "default": 1}],
		)["data"]

		for action in (hold_invoice, restore_invoice, clear_invoice):
			response = action(invoice["doctype"], invoice["name"])
			self.assertFalse(response["ok"], response)

	def test_preview_invoice_with_exclusive_tax_template(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		tax_template = ensure_sales_tax_template(rate=10, included_in_print_rate=0)
		set_profile_tax_template(profile, tax_template)
		set_invoice_mode("Sales Invoice")

		response = preview_invoice(
			pos_profile=profile,
			items=[{"item_code": item_code, "qty": 1}],
			invoice_doctype="Sales Invoice",
		)

		self.assertTrue(response["ok"], response)
		invoice = response["data"]
		self.assertEqual(invoice["doctype"], "Sales Invoice")
		self.assertEqual(invoice["docstatus"], 0)
		self.assertEqual(len(invoice["taxes"]), 1)
		self.assertIn("included_in_print_rate", invoice["taxes"][0])
		self.assertFalse(invoice["taxes"][0]["included_in_print_rate"])
		self.assertAlmostEqual(flt(invoice["totals"]["net_total"]), 100, places=2)
		self.assertAlmostEqual(flt(invoice["totals"]["total_taxes_and_charges"]), 10, places=2)
		self.assertAlmostEqual(flt(invoice["totals"]["grand_total"]), 110, places=2)

	def test_preview_invoice_with_inclusive_tax_template(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		tax_template = ensure_sales_tax_template(rate=10, included_in_print_rate=1)
		set_profile_tax_template(profile, tax_template)
		set_invoice_mode("Sales Invoice")

		response = preview_invoice(
			pos_profile=profile,
			items=[{"item_code": item_code, "qty": 1}],
			invoice_doctype="Sales Invoice",
		)

		self.assertTrue(response["ok"], response)
		invoice = response["data"]
		self.assertEqual(len(invoice["taxes"]), 1)
		self.assertIn("included_in_print_rate", invoice["taxes"][0])
		self.assertTrue(invoice["taxes"][0]["included_in_print_rate"])
		self.assertAlmostEqual(flt(invoice["totals"]["net_total"]), 90.91, places=2)
		self.assertAlmostEqual(flt(invoice["totals"]["total_taxes_and_charges"]), 9.09, places=2)
		self.assertAlmostEqual(flt(invoice["totals"]["grand_total"]), 100, places=2)

	def test_preview_invoice_with_item_tax_template(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		item_tax_template = ensure_item_tax_template(item_code, rate=10)
		set_profile_tax_template(profile, None)
		set_invoice_mode("Sales Invoice")
		previous_item_tax_setting = frappe.db.get_single_value(
			"Accounts Settings", "add_taxes_from_item_tax_template"
		)
		previous_tax_template_setting = frappe.db.get_single_value(
			"Accounts Settings", "add_taxes_from_taxes_and_charges_template"
		)
		previous_inclusive_setting = frappe.db.get_value(
			"POS Profile", profile, "vunapos_item_prices_include_tax"
		)

		try:
			frappe.db.set_single_value("Accounts Settings", "add_taxes_from_item_tax_template", 1)
			frappe.db.set_single_value("Accounts Settings", "add_taxes_from_taxes_and_charges_template", 0)

			response = preview_invoice(
				pos_profile=profile,
				items=[{"item_code": item_code, "qty": 1, "item_tax_template": item_tax_template}],
				invoice_doctype="Sales Invoice",
			)

			self.assertTrue(response["ok"], response)
			invoice = response["data"]
			self.assertEqual(len(invoice["taxes"]), 1)
			self.assertAlmostEqual(flt(invoice["totals"]["net_total"]), 100, places=2)
			self.assertAlmostEqual(flt(invoice["totals"]["total_taxes_and_charges"]), 10, places=2)
			self.assertAlmostEqual(flt(invoice["totals"]["grand_total"]), 110, places=2)

			frappe.db.set_value("POS Profile", profile, "vunapos_item_prices_include_tax", 1)
			frappe.clear_cache(doctype="POS Profile")
			inclusive_response = preview_invoice(
				pos_profile=profile,
				items=[{"item_code": item_code, "qty": 1, "item_tax_template": item_tax_template}],
				invoice_doctype="Sales Invoice",
			)

			self.assertTrue(inclusive_response["ok"], inclusive_response)
			inclusive_invoice = inclusive_response["data"]
			self.assertTrue(inclusive_invoice["taxes"][0]["included_in_print_rate"])
			self.assertAlmostEqual(flt(inclusive_invoice["totals"]["net_total"]), 90.91, places=2)
			self.assertAlmostEqual(
				flt(inclusive_invoice["totals"]["total_taxes_and_charges"]), 9.09, places=2
			)
			self.assertAlmostEqual(flt(inclusive_invoice["totals"]["grand_total"]), 100, places=2)
		finally:
			frappe.db.set_value(
				"POS Profile", profile, "vunapos_item_prices_include_tax", previous_inclusive_setting
			)
			frappe.clear_cache(doctype="POS Profile")
			frappe.db.set_single_value(
				"Accounts Settings",
				"add_taxes_from_item_tax_template",
				previous_item_tax_setting,
			)
			frappe.db.set_single_value(
				"Accounts Settings",
				"add_taxes_from_taxes_and_charges_template",
				previous_tax_template_setting,
			)

	def test_preview_invoice_multiple_items_and_quantity_changes(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		tax_template = ensure_sales_tax_template(rate=10, included_in_print_rate=0)
		set_profile_tax_template(profile, tax_template)
		set_invoice_mode("Sales Invoice")

		response = preview_invoice(
			pos_profile=profile,
			items=[
				{"item_code": item_code, "qty": 2},
				{"item_code": item_code, "qty": 3},
			],
			invoice_doctype="Sales Invoice",
		)

		self.assertTrue(response["ok"], response)
		invoice = response["data"]
		self.assertEqual(len(invoice["items"]), 2)
		self.assertAlmostEqual(flt(invoice["totals"]["net_total"]), 500, places=2)
		self.assertAlmostEqual(flt(invoice["totals"]["total_taxes_and_charges"]), 50, places=2)
		self.assertAlmostEqual(flt(invoice["totals"]["grand_total"]), 550, places=2)

	def test_preview_invoice_matches_actual_draft_invoice_totals(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		tax_template = ensure_sales_tax_template(rate=10, included_in_print_rate=0)
		set_profile_tax_template(profile, tax_template)
		set_invoice_mode("Sales Invoice")
		items = [{"item_code": item_code, "qty": 2}]

		preview = preview_invoice(pos_profile=profile, items=items, invoice_doctype="Sales Invoice")
		draft = create_invoice_from_cart(pos_profile=profile, items=items)

		self.assertTrue(preview["ok"], preview)
		self.assertTrue(draft["ok"], draft)
		for fieldname in ("net_total", "total_taxes_and_charges", "grand_total", "rounded_total"):
			self.assertAlmostEqual(
				flt(preview["data"]["totals"][fieldname]),
				flt(draft["data"]["totals"][fieldname]),
				places=2,
			)

	def test_preview_invoice_does_not_create_database_invoice(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_profile_tax_template(profile, None)
		set_invoice_mode("Sales Invoice")
		before = frappe.db.count("Sales Invoice")

		response = preview_invoice(
			pos_profile=profile,
			items=[{"item_code": item_code, "qty": 1}],
			invoice_doctype="Sales Invoice",
		)

		self.assertTrue(response["ok"], response)
		self.assertEqual(frappe.db.count("Sales Invoice"), before)
