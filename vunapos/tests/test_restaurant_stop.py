from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.tests import test_restaurant_item_cancellation as fixtures


class TestRestaurantStop(IntegrationTestCase):
	def setUp(self):
		from vunapos.tests.helpers import set_invoice_mode

		fixtures.TestRestaurantItemCancellation.setUp(self)
		set_invoice_mode("Sales Invoice")
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_cancellation_charge_item", None)
		frappe.clear_document_cache("POS Profile", self.profile.name)

	tearDown = fixtures.TestRestaurantItemCancellation.tearDown
	_item = fixtures.TestRestaurantItemCancellation._item
	_raw_item = fixtures.TestRestaurantItemCancellation._raw_item
	_station = fixtures.TestRestaurantItemCancellation._station
	_send = fixtures.TestRestaurantItemCancellation._send
	_tickets = fixtures.TestRestaurantItemCancellation._tickets
	_preview = fixtures.TestRestaurantItemCancellation._preview
	_checkout = fixtures.TestRestaurantItemCancellation._checkout
	_placed = fixtures.TestRestaurantItemCancellation._placed
	_action = fixtures.TestRestaurantItemCancellation._action

	def _start(self, ready=0):
		self.order = self._placed()
		self.ticket = self._tickets(self.order)[0]
		self._action(self.order, "Accept")
		self._action(self.order, "Start")
		if ready:
			self._action(self.order, "Ready", ready)
		account = frappe.get_cached_value("Company", self.profile.company, "stock_adjustment_account")
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_waste_expense_account", account)
		frappe.clear_document_cache("POS Profile", self.profile.name)

	def _stop(self, used=0, charge="Remove charge", quote=None, key=None):
		quote = quote or restaurant.preview_preparation_stop(self.ticket)
		self.assertTrue(quote["ok"], quote)
		lines = quote["data"]["lines"]
		self.assertTrue(lines, quote)
		return restaurant.stop_preparation(
			self.ticket,
			[line["line_id"] for line in lines],
			{part["id"]: used for line in lines for part in line["materials"]},
			key or str(uuid4()),
			quote["data"]["fingerprint"],
			"Customer cancelled while cooking",
			charge,
		)

	def _qty(self, code, warehouse=None):
		return (
			frappe.db.get_value(
				"Bin", {"item_code": code, "warehouse": warehouse or self.profile.warehouse}, "actual_qty"
			)
			or 0
		)

	def test_unused_stores_releases_reservations_without_manufacturing_or_consuming(self):
		self._start()
		response = self._stop()
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["status"], "Cancelled")
		self.assertEqual(self._qty(self.ingredient), 1000)
		self.assertEqual(self._qty(self.item), 0)
		self.assertEqual(frappe.db.get_value("Sales Order", self.order, "docstatus"), 2)
		wo = response["data"]["items"][0]["work_order"]
		self.assertEqual(frappe.db.get_value("Work Order", wo, "status"), "Closed")

	def test_used_materials_are_expensed_without_creating_finished_food(self):
		self._start()
		response = self._stop(used=2)
		self.assertTrue(response["ok"], response)
		self.assertEqual(self._qty(self.ingredient), 998)
		self.assertEqual(self._qty(self.item), 0)
		entry = frappe.get_doc(
			"Stock Entry", frappe.db.get_value("Stock Entry", {"vunapos_stopped_ticket": self.ticket}, "name")
		)
		self.assertEqual(entry.purpose, "Material Consumption for Manufacture")
		self.assertEqual(entry.docstatus, 1)
		self.assertTrue(all(not row.is_finished_item and not row.t_warehouse for row in entry.items))

	def test_retains_ready_food_and_bills_only_actual_finished_quantity(self):
		self._start(ready=2)
		response = self._stop(used=1)
		self.assertTrue(response["ok"], response)
		self.assertEqual(frappe.get_doc("Sales Order", self.order).items[0].qty, 2)
		self.assertEqual(response["data"]["items"][0]["ready_qty"], 2)
		self.assertEqual(response["data"]["items"][0]["cancelled_qty"], 2)
		preview = self._preview()
		self.assertTrue(preview["can_checkout"], preview)
		bill = self._checkout(preview)
		self.assertTrue(bill["ok"], bill)
		self.assertEqual(self._qty(self.item), 0)
		self.assertEqual(self._qty(self.ingredient), 997)

	def _charge_item(self):
		from vunapos.tests.helpers import ensure_test_item

		item = frappe.copy_doc(frappe.get_doc("Item", ensure_test_item()))
		item.item_code = f"_Test Cancellation Fee {self.token}"
		item.item_name = item.item_code
		item.is_stock_item = 0
		item.has_batch_no = 0
		item.has_serial_no = 0
		item.set("barcodes", [])
		item.insert(ignore_permissions=True)
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_cancellation_charge_item", item.name)
		frappe.clear_document_cache("POS Profile", self.profile.name)
		return item.name

	def test_retained_charge_is_nonstock_and_does_not_create_finished_food(self):
		fee = self._charge_item()
		self._start()
		response = self._stop(used=2, charge="Keep charge")
		self.assertTrue(response["ok"], response)
		order = frappe.get_doc("Sales Order", self.order)
		self.assertEqual(len(order.items), 1)
		self.assertEqual((order.items[0].item_code, order.items[0].qty, order.items[0].rate), (fee, 1, 400))
		bill = self._checkout()
		self.assertTrue(bill["ok"], bill)
		self.assertEqual(bill["data"]["invoice"]["totals"]["grand_total"], 400)
		self.assertEqual(self._qty(self.item), 0)
		self.assertEqual(self._qty(self.ingredient), 998)

	def test_unused_wip_is_returned_but_used_materials_stay_expensed(self):
		warehouse = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": f"Stop WIP {self.token}",
				"company": self.profile.company,
				"parent_warehouse": frappe.db.get_value(
					"Warehouse", {"company": self.profile.company, "is_group": 1}, "name"
				),
			}
		).insert(ignore_permissions=True)
		station = frappe.get_doc("Kitchen Station", self.station)
		station.wip_warehouse = warehouse.name
		station.save()
		self._start()
		self.assertEqual(self._qty(self.ingredient), 996)
		response = self._stop(used=1)
		self.assertTrue(response["ok"], response)
		self.assertEqual(self._qty(self.ingredient, warehouse.name), 0)
		self.assertEqual(self._qty(self.ingredient), 999)
		self.assertEqual(self._qty(self.item), 0)

	def test_batch_tracked_ingredients_use_the_work_orders_reserved_batch(self):
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

		from vunapos.tests.helpers import ensure_test_batch_item

		self.ingredient = ensure_test_batch_item(f"_Test Stop Raw {self.token}")
		batch = frappe.get_doc(
			{"doctype": "Batch", "batch_id": f"STOP-{self.token}", "item": self.ingredient}
		).insert(ignore_permissions=True)
		make_stock_entry(
			item_code=self.ingredient,
			to_warehouse=self.profile.warehouse,
			qty=10,
			rate=10,
			batch_no=batch.name,
			use_serial_batch_fields=1,
		)
		self.item = self._item("Tracked")
		self._start()
		response = self._stop(used=2)
		self.assertTrue(response["ok"], response)
		self.assertEqual(self._qty(self.ingredient), 8)
		entry = frappe.get_doc(
			"Stock Entry", frappe.db.get_value("Stock Entry", {"vunapos_stopped_ticket": self.ticket}, "name")
		)
		bundle = frappe.get_doc("Serial and Batch Bundle", entry.items[0].serial_and_batch_bundle)
		self.assertEqual({row.batch_no for row in bundle.entries}, {batch.name})

	def test_previous_native_consumption_is_not_issued_again(self):
		from vunapos.services import restaurant_stop_service as stopping

		self._start()
		quote = restaurant.preview_preparation_stop(self.ticket)["data"]
		wo = frappe.get_doc("Work Order", quote["lines"][0]["work_order"])
		part = {**quote["lines"][0]["materials"][0], "used_qty": 1}
		# A native kitchen consumption entry made before the manager's review.
		entry = frappe.new_doc("Stock Entry")
		entry.update(
			{
				"company": wo.company,
				"purpose": "Material Consumption for Manufacture",
				"stock_entry_type": "Material Consumption for Manufacture",
				"work_order": wo.name,
				"fg_completed_qty": 4,
				"from_bom": 0,
			}
		)
		stopping._append_material(entry, part, 1)
		entry.insert(ignore_permissions=True)
		entry.submit()
		quote = restaurant.preview_preparation_stop(self.ticket)
		self.assertEqual(quote["data"]["lines"][0]["materials"][0]["max_qty"], 3)
		self.assertEqual(quote["data"]["lines"][0]["recorded_consumption"][0]["qty"], 1)
		response = self._stop(used=0, quote=quote)
		self.assertTrue(response["ok"], response)
		self.assertEqual(self._qty(self.ingredient), 999)

	def test_stock_addons_are_reviewed_and_consumed_separately_from_recipe_materials(self):
		from vunapos.services.modifier_service import assigned_groups

		item = frappe.get_doc("Item", self.item)
		item.append(
			"vunapos_restaurant_addons",
			{"addon_item": self.ingredient, "addon_qty": 2, "enabled": 1, "label": "Extra ingredient"},
		)
		item.save()
		group = assigned_groups(self.item)[0]
		self.order = self._placed(
			[
				{
					"item_code": self.item,
					"qty": 4,
					"line_id": "meal",
					"modifiers": [{"group": group.name, "option": group.options[0].name}],
				}
			]
		)
		self.ticket = self._tickets(self.order)[0]
		self._action(self.order, "Accept")
		self._action(self.order, "Start")
		account = frappe.get_cached_value("Company", self.profile.company, "stock_adjustment_account")
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_waste_expense_account", account)
		frappe.clear_document_cache("POS Profile", self.profile.name)
		quote = restaurant.preview_preparation_stop(self.ticket)["data"]
		materials = quote["lines"][0]["materials"]
		self.assertEqual({part["kind"]: part["max_qty"] for part in materials}, {"Stores": 4, "Add-on": 8})
		response = restaurant.stop_preparation(
			self.ticket,
			["meal"],
			{part["id"]: 2 if part["kind"] == "Add-on" else 1 for part in materials},
			str(uuid4()),
			quote["fingerprint"],
			"Guest cancelled",
			"Remove charge",
		)
		self.assertTrue(response["ok"], response)
		self.assertEqual(self._qty(self.ingredient), 997)
		self.assertEqual(self._qty(self.item), 0)

	def test_retries_are_idempotent_and_changed_usage_conflicts(self):
		self._start()
		quote = restaurant.preview_preparation_stop(self.ticket)
		key = str(uuid4())
		self.assertTrue(self._stop(used=1, quote=quote, key=key)["ok"])
		self.assertTrue(self._stop(used=1, quote=quote, key=key)["ok"])
		self.assertEqual(
			self._stop(used=2, quote=quote, key=key)["errors"][0]["code"], "IDEMPOTENCY_CONFLICT"
		)
		self.assertEqual(self._qty(self.ingredient), 999)
		self.assertEqual(frappe.db.count("Stock Entry", {"vunapos_stopped_ticket": self.ticket}), 1)

	def test_audit_failure_rolls_back_stock_order_and_work_order_then_can_retry(self):
		self._start()
		quote = restaurant.preview_preparation_stop(self.ticket)
		key = str(uuid4())
		with patch(
			"vunapos.services.kitchen_lifecycle_service._record",
			side_effect=frappe.ValidationError("Audit unavailable"),
		):
			self.assertFalse(self._stop(used=1, quote=quote, key=key)["ok"])
		self.assertEqual(self._qty(self.ingredient), 1000)
		self.assertEqual(frappe.get_doc("Sales Order", self.order).items[0].qty, 4)
		self.assertEqual(restaurant.get_kitchen_ticket(self.ticket)["data"]["status"], "Preparing")
		self.assertTrue(self._stop(used=1, quote=quote, key=key)["ok"])

	def test_ready_progress_invalidates_the_material_review(self):
		self._start()
		quote = restaurant.preview_preparation_stop(self.ticket)
		self._action(self.order, "Ready", 1)
		self.assertEqual(self._stop(used=1, quote=quote)["errors"][0]["code"], "STOP_REVIEW_CHANGED")

	def test_every_ingredient_requires_explicit_review_and_usage_cannot_exceed_available(self):
		self._start()
		quote = restaurant.preview_preparation_stop(self.ticket)["data"]
		missing = restaurant.stop_preparation(
			self.ticket, ["meal"], {}, str(uuid4()), quote["fingerprint"], "Guest left", "Remove charge"
		)
		self.assertEqual(missing["errors"][0]["code"], "STOP_MATERIAL_REVIEW_REQUIRED")
		self.assertEqual(self._stop(used=5)["errors"][0]["code"], "STOP_INVALID_USAGE")
		self.assertEqual(self._qty(self.ingredient), 1000)

	def test_keep_charge_requires_valid_nonstock_item_before_stock_changes(self):
		self._start()
		self.assertEqual(
			self._stop(used=1, charge="Keep charge")["errors"][0]["code"], "STOP_CHARGE_ITEM_REQUIRED"
		)
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_cancellation_charge_item", self.item)
		self.assertEqual(
			self._stop(used=1, charge="Keep charge")["errors"][0]["code"], "STOP_CHARGE_ITEM_INVALID"
		)
		self.assertEqual(self._qty(self.ingredient), 1000)

	def test_only_managers_can_stop_cooking_and_remove_retained_charge(self):
		self._charge_item()
		self._start()
		with patch("frappe.get_roles", return_value=["VunaPOS Waiter"]):
			self.assertEqual(
				restaurant.preview_preparation_stop(self.ticket)["errors"][0]["code"], "PermissionError"
			)
		self.assertTrue(self._stop(charge="Keep charge")["ok"])
		with patch("frappe.get_roles", return_value=["VunaPOS Waiter"]):
			quote = restaurant.preview_item_cancellation(self.order)
			self.assertTrue(quote["ok"], quote)
			self.assertEqual(quote["data"]["lines"][0]["max_cancel_qty"], 0)

	def test_stock_entries_cannot_be_reversed_independently_after_stop(self):
		self._start(ready=1)
		self.assertTrue(self._stop(used=1)["ok"])
		for name in frappe.get_all(
			"Stock Entry",
			filters={
				"work_order": frappe.db.get_value(
					"Kitchen Order Ticket Item", {"parent": self.ticket}, "work_order"
				),
				"docstatus": 1,
			},
			pluck="name",
		):
			with self.assertRaises(frappe.ValidationError):
				frappe.get_doc("Stock Entry", name).cancel()

	def test_pos_invoice_bills_ready_food_and_nonstock_fee_without_finishing_stopped_work(self):
		from vunapos.tests.helpers import set_invoice_mode

		fee = self._charge_item()
		self._start(ready=2)
		self.assertTrue(self._stop(used=1, charge="Keep charge")["ok"])
		set_invoice_mode("POS Invoice")
		bill = self._checkout()
		self.assertTrue(bill["ok"], bill)
		self.assertEqual(bill["data"]["invoice"]["doctype"], "POS Invoice")
		self.assertEqual(
			{row["item_code"]: row["qty"] for row in bill["data"]["invoice"]["items"]}, {self.item: 2, fee: 1}
		)

	def test_waste_ledger_uses_actual_issued_material_value(self):
		self._start()
		self.assertTrue(self._stop(used=2)["ok"])
		name = frappe.db.get_value("Stock Entry", {"vunapos_stopped_ticket": self.ticket}, "name")
		account = frappe.get_cached_value("Company", self.profile.company, "stock_adjustment_account")
		entries = frappe.get_all(
			"GL Entry",
			filters={
				"voucher_type": "Stock Entry",
				"voucher_no": name,
				"account": account,
				"is_cancelled": 0,
			},
			fields=["debit", "credit"],
		)
		self.assertAlmostEqual(sum(row.debit - row.credit for row in entries), 20)
