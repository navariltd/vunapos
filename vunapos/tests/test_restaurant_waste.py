from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.tests import test_restaurant_billing as billing_fixtures
from vunapos.tests.helpers import ensure_test_user, set_invoice_mode


class TestRestaurantWaste(IntegrationTestCase):
	# Reuse transactional billing fixtures without running their tests twice.
	tearDown = billing_fixtures.TestRestaurantBilling.tearDown
	_item = billing_fixtures.TestRestaurantBilling._item
	_raw_item = billing_fixtures.TestRestaurantBilling._raw_item
	_station = billing_fixtures.TestRestaurantBilling._station
	_send = billing_fixtures.TestRestaurantBilling._send
	_tickets = billing_fixtures.TestRestaurantBilling._tickets
	_ready = billing_fixtures.TestRestaurantBilling._ready
	_preview = billing_fixtures.TestRestaurantBilling._preview
	_checkout = billing_fixtures.TestRestaurantBilling._checkout

	def setUp(self):
		billing_fixtures.TestRestaurantBilling.setUp(self)
		self.account = (
			frappe.get_doc(
				{
					"doctype": "Account",
					"account_name": f"Restaurant Waste {self.token}",
					"company": self.profile.company,
					"root_type": "Expense",
					"report_type": "Profit and Loss",
					"parent_account": frappe.db.get_value(
						"Account",
						{"company": self.profile.company, "root_type": "Expense", "is_group": 1},
						"name",
					),
				}
			)
			.insert(ignore_permissions=True)
			.name
		)
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_waste_expense_account", self.account)
		frappe.clear_document_cache("POS Profile", self.profile.name)

	def _billed_and_served(self):
		self._ready(2)
		self.ticket = self._tickets()[0]
		result = restaurant.kitchen_action(self.ticket, "Serve", str(uuid4()), "Ready")
		self.assertTrue(result["ok"], result)
		billed = self._checkout()
		self.assertTrue(billed["ok"], billed)
		return billed["data"]["invoice"]

	def _waste(self, quote=None, qty=1, key=None, reason="Dropped at the table"):
		quote = quote or restaurant.preview_restaurant_waste(self.ticket)
		self.assertTrue(quote["ok"], quote)
		return restaurant.record_restaurant_waste(
			self.ticket,
			{quote["data"]["lines"][0]["line_id"]: qty},
			key or str(uuid4()),
			quote["data"]["fingerprint"],
			reason,
		)

	def test_waste_reclassifies_cost_without_issuing_stock_or_changing_bill(self):
		invoice = self._billed_and_served()
		before = frappe.db.count("Stock Ledger Entry", {"item_code": self.item})
		quote = restaurant.preview_restaurant_waste(self.ticket)
		self.assertTrue(quote["ok"], quote)
		self.assertEqual(quote["data"]["lines"][0]["max_qty"], 2)
		response = self._waste(quote)
		self.assertTrue(response["ok"], response)
		action = response["data"]["actions"][0]
		self.assertEqual(action["approved_by"], "Administrator")
		journal = frappe.get_doc("Journal Entry", action["item_quantities"]["journal_entry"])
		self.assertEqual(journal.docstatus, 1)
		self.assertEqual(journal.total_debit, 10)
		self.assertEqual(journal.accounts[0].account, self.account)
		self.assertEqual(frappe.db.count("Stock Ledger Entry", {"item_code": self.item}), before)
		self.assertEqual(
			frappe.db.get_value(invoice["doctype"], invoice["name"], "grand_total"),
			invoice["totals"]["grand_total"],
		)
		self.assertEqual(restaurant.preview_restaurant_waste(self.ticket)["data"]["lines"][0]["max_qty"], 1)

	def test_retry_reuses_journal_and_conflicting_payload_is_rejected(self):
		self._billed_and_served()
		quote = restaurant.preview_restaurant_waste(self.ticket)
		key = str(uuid4())
		first = self._waste(quote, key=key)
		self.assertTrue(first["ok"], first)
		second = self._waste(quote, key=key)
		self.assertTrue(second["ok"], second)
		self.assertEqual(
			first["data"]["actions"][0]["item_quantities"], second["data"]["actions"][0]["item_quantities"]
		)
		conflict = self._waste(quote, qty=2, key=key)
		self.assertEqual(conflict["errors"][0]["code"], "IDEMPOTENCY_CONFLICT")

	def test_unbilled_waste_is_blocked(self):
		self._ready()
		response = restaurant.preview_restaurant_waste(self._tickets()[0])
		self.assertEqual(response["errors"][0]["code"], "WASTE_BILL_FIRST")

	def test_waste_requires_manager_role(self):
		self._billed_and_served()
		user = f"waste-waiter-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Waiter",), pos_profile=self.profile.name)
		frappe.set_user(user)
		response = restaurant.preview_restaurant_waste(self.ticket)
		self.assertEqual(response["errors"][0]["code"], "PermissionError")

	def test_blank_reason_excess_fractional_and_nonfinite_quantities_are_rejected(self):
		self._billed_and_served()
		for qty, reason in (
			(3, "Too much"),
			(0, "Zero"),
			(-1, "Negative"),
			(float("nan"), "Invalid"),
			(True, "Boolean"),
			(1, " "),
		):
			response = self._waste(qty=qty, reason=reason)
			self.assertFalse(response["ok"], response)

	def test_stale_review_cannot_record_the_same_quantity_twice(self):
		self._billed_and_served()
		quote = restaurant.preview_restaurant_waste(self.ticket)
		self.assertTrue(self._waste(quote)["ok"])
		response = self._waste(quote)
		self.assertEqual(response["errors"][0]["code"], "WASTE_REVIEW_CHANGED")

	def test_failure_after_journal_submission_rolls_back_everything(self):
		self._billed_and_served()
		before = frappe.db.count("Journal Entry")
		with patch(
			"vunapos.services.restaurant_waste_service.kitchen._record",
			side_effect=frappe.ValidationError("audit unavailable"),
		):
			response = self._waste()
		self.assertFalse(response["ok"], response)
		self.assertEqual(frappe.db.count("Journal Entry"), before)
		self.assertEqual(restaurant.preview_restaurant_waste(self.ticket)["data"]["lines"][0]["max_qty"], 2)

	def test_cancelled_waste_journal_requires_reconciliation(self):
		self._billed_and_served()
		response = self._waste()
		self.assertTrue(response["ok"], response)
		journal = frappe.get_doc(
			"Journal Entry", response["data"]["actions"][0]["item_quantities"]["journal_entry"]
		)
		journal.cancel()
		response = restaurant.preview_restaurant_waste(self.ticket)
		self.assertEqual(response["errors"][0]["code"], "WASTE_ACCOUNTING_CHANGED")

	def test_pos_invoice_waits_for_actual_stock_and_accounting_postings(self):
		set_invoice_mode("POS Invoice")
		self._billed_and_served()
		response = restaurant.preview_restaurant_waste(self.ticket)
		# Native versions may post POS stock immediately or during consolidation.
		if response["ok"]:
			self.assertTrue(self._waste(response)["ok"])
		else:
			self.assertIn(response["errors"][0]["code"], ("WASTE_STOCK_NOT_POSTED", "WASTE_COST_NOT_POSTED"))

	def test_consolidated_pos_bill_uses_exact_posted_source_row(self):
		from erpnext.accounts.doctype.pos_invoice_merge_log.pos_invoice_merge_log import (
			consolidate_pos_invoices,
		)

		set_invoice_mode("POS Invoice")
		invoice = self._billed_and_served()
		consolidate_pos_invoices([frappe._dict(pos_invoice=invoice["name"], customer="_Test Customer")])
		quote = restaurant.preview_restaurant_waste(self.ticket)
		self.assertTrue(quote["ok"], quote)
		self.assertNotEqual(quote["data"]["posting_invoice"], invoice["name"])
		self.assertTrue(self._waste(quote)["ok"])

	def test_unserved_food_is_not_retrospective_served_waste(self):
		self._ready()
		self.ticket = self._tickets()[0]
		self.assertTrue(self._checkout()["ok"])
		quote = restaurant.preview_restaurant_waste(self.ticket)
		self.assertTrue(quote["ok"], quote)
		self.assertEqual(quote["data"]["lines"][0]["max_qty"], 0)
		self.assertFalse(self._waste(quote)["ok"])

	def test_active_waste_accounting_must_be_reversed_before_bill_reversal(self):
		from vunapos.services.restaurant_waste_service import protect_waste_accounting

		invoice = self._billed_and_served()
		response = self._waste()
		self.assertTrue(response["ok"], response)
		doc = frappe.get_doc(invoice["doctype"], invoice["name"])
		with self.assertRaises(frappe.ValidationError):
			protect_waste_accounting(doc, "before_cancel")
		returned = frappe._dict(doctype="Sales Invoice", return_against=doc.name)
		with self.assertRaises(frappe.ValidationError):
			protect_waste_accounting(returned, "validate")
		journal = frappe.get_doc(
			"Journal Entry", response["data"]["actions"][0]["item_quantities"]["journal_entry"]
		)
		journal.cancel()
		protect_waste_accounting(doc, "before_cancel")

	def test_missing_waste_account_blocks_recording(self):
		self._billed_and_served()
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_waste_expense_account", None)
		response = restaurant.preview_restaurant_waste(self.ticket)
		self.assertEqual(response["errors"][0]["code"], "WASTE_ACCOUNT_REQUIRED")

	def test_partial_waste_allocates_rounding_cents_only_once(self):
		self._billed_and_served()
		amounts = []
		for qty in (0.333333, 0.333333, 0.333334):
			response = self._waste(qty=qty)
			self.assertTrue(response["ok"], response)
			amounts.append(response["data"]["actions"][0]["item_quantities"]["cost"])
		self.assertEqual(amounts, [3.33, 3.34, 3.33])
		self.assertEqual(sum(amounts), 10)

	def test_missing_stock_posting_is_not_estimated_from_recipe(self):
		self._billed_and_served()
		from vunapos.services import restaurant_waste_service as waste

		get_all = frappe.get_all

		def without_stock(doctype, *args, **kwargs):
			return [] if doctype == "Stock Ledger Entry" else get_all(doctype, *args, **kwargs)

		with patch.object(waste.frappe, "get_all", side_effect=without_stock):
			response = restaurant.preview_restaurant_waste(self.ticket)
		self.assertEqual(response["errors"][0]["code"], "WASTE_STOCK_NOT_POSTED")

	def test_wasted_food_cannot_be_returned_to_the_service_queue(self):
		self._billed_and_served()
		self.assertTrue(self._waste()["ok"])
		doc = restaurant.get_kitchen_ticket(self.ticket)["data"]
		response = restaurant.kitchen_action(
			self.ticket,
			"Undo Serve",
			str(uuid4()),
			doc["status"],
			{doc["items"][0]["line_id"]: 2},
			str(doc["modified"]),
			"Wrong service mark",
		)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "WASTE_SERVICE_CORRECTION_REQUIRED")

	def test_stock_addons_follow_the_dish_without_additional_stock_issue(self):
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

		from vunapos.services.modifier_service import assigned_groups

		addon = self._item("Extra")
		make_stock_entry(item_code=addon, to_warehouse=self.profile.warehouse, qty=10, rate=10)
		item = frappe.get_doc("Item", self.item)
		item.append(
			"vunapos_restaurant_addons", {"addon_item": addon, "addon_qty": 2, "enabled": 1, "label": "Extra"}
		)
		item.save()
		group = assigned_groups(self.item)[0]
		placed = self._send(
			items=[
				{
					"item_code": self.item,
					"qty": 2,
					"line_id": "meal",
					"modifiers": [{"group": group.name, "option": group.options[0].name}],
				}
			]
		)
		self.assertTrue(placed["ok"], placed)
		self.ticket = self._tickets()[0]
		for action, expected in (
			("Accept", "Sent"),
			("Start", "Accepted"),
			("Ready", "Preparing"),
			("Serve", "Ready"),
		):
			response = restaurant.kitchen_action(self.ticket, action, str(uuid4()), expected)
			self.assertTrue(response["ok"], response)
		self.assertTrue(self._checkout()["ok"])
		response = self._waste()
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["actions"][0]["item_quantities"]["cost"], 30)
