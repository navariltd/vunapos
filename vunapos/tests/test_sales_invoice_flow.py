import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, flt, nowdate

from vunapos.api.batch import allocate_batches
from vunapos.api.sales import (
	add_item,
	checkout_invoice,
	clear_invoice,
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
from vunapos.tests.helpers import (
	ensure_batch_stock,
	ensure_item_tax_template,
	ensure_open_pos_opening_entry,
	ensure_sales_tax_template,
	ensure_test_batch_item,
	ensure_test_item,
	ensure_test_pos_profile,
	set_invoice_mode,
	set_profile_tax_template,
)


class TestVunaPOSSalesInvoiceFlow(IntegrationTestCase):
	def setUp(self):
		ensure_open_pos_opening_entry(ensure_test_pos_profile())

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
		finally:
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
