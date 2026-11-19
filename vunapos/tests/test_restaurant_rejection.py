from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.tests import test_restaurant_remake as fixtures
from vunapos.tests.helpers import (
	ensure_sales_tax_template,
	ensure_test_user,
	set_invoice_mode,
	set_profile_tax_template,
)


class TestRestaurantRejection(IntegrationTestCase):
	setUp = fixtures.TestRestaurantRemake.setUp
	tearDown = fixtures.TestRestaurantRemake.tearDown
	_item = fixtures.TestRestaurantRemake._item
	_raw_item = fixtures.TestRestaurantRemake._raw_item
	_station = fixtures.TestRestaurantRemake._station
	_send = fixtures.TestRestaurantRemake._send
	_tickets = fixtures.TestRestaurantRemake._tickets
	_ready = fixtures.TestRestaurantRemake._ready
	_preview = fixtures.TestRestaurantRemake._preview
	_checkout = fixtures.TestRestaurantRemake._checkout
	_source = fixtures.TestRestaurantRemake._source
	_qty = fixtures.TestRestaurantRemake._qty
	_finish = fixtures.TestRestaurantRemake._finish

	def _reject(self, qty=1, charge="Remove charge", quote=None, key=None):
		quote = quote or restaurant.preview_rejection(self.ticket)
		self.assertTrue(quote["ok"], quote)
		return restaurant.reject_prepared_items(
			self.ticket,
			{quote["data"]["lines"][0]["line_id"]: qty},
			key or str(uuid4()),
			quote["data"]["fingerprint"],
			"Guest rejected burnt food",
			charge,
		)

	def test_charge_waiver_keeps_production_qty_and_consumes_food_once(self):
		self._source(qty=2)
		before = self._preview()["invoice"]["totals"]["grand_total"]
		response = self._reject()
		self.assertTrue(response["ok"], response)
		line = response["data"]["items"][0]
		self.assertEqual((line["served_qty"], line["rejected_qty"], line["ready_to_serve_qty"]), (0, 1, 1))
		self.assertEqual(frappe.get_doc("Sales Order", self.order).items[0].qty, 2)
		self.assertEqual(self._qty(self.item), 2)
		self.assertEqual(self._preview()["invoice"]["totals"]["grand_total"], before / 2)
		billed = self._checkout()
		self.assertTrue(billed["ok"], billed)
		self.assertEqual(billed["data"]["invoice"]["items"][0]["qty"], 2)
		self.assertEqual(self._qty(self.item), 0)
		self.assertEqual(frappe.db.get_value("Sales Order", self.order, "per_billed"), 100)

	def test_keep_charge_is_explicit_and_does_not_mark_rejected_food_served(self):
		self._source(qty=2)
		before = self._preview()["invoice"]["totals"]["grand_total"]
		response = self._reject(qty=2, charge="Keep charge")
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["status"], "Completed")
		self.assertEqual(response["data"]["items"][0]["served_qty"], 0)
		self.assertEqual(self._preview()["invoice"]["totals"]["grand_total"], before)
		self.assertFalse(response["data"]["can_remake"])
		self.assertFalse(response["data"]["can_reject"])

	def test_full_waiver_can_checkout_without_fake_payment(self):
		self._source(qty=1)
		self.assertTrue(self._reject()["ok"])
		self.assertEqual(self._preview()["invoice"]["totals"]["grand_total"], 0)
		response = self._checkout(payments=[])
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["session"]["status"], "Settled")
		self.assertEqual(response["data"]["invoice"]["totals"]["paid_amount"], 0)
		self.assertEqual(self._qty(self.item), 0)

	def test_repeated_partial_waivers_use_original_not_already_discounted_rate(self):
		self._source(qty=4)
		before = self._preview()["invoice"]["totals"]["grand_total"]
		for _index in range(2):
			self.assertTrue(self._reject()["ok"])
		self.assertEqual(self._preview()["invoice"]["totals"]["grand_total"], before / 2)

	def test_one_of_three_uses_exact_money_not_a_rounded_average_rate(self):
		self._source(qty=3)
		before = self._preview()["invoice"]["totals"]["grand_total"]
		self.assertTrue(self._reject()["ok"])
		self.assertEqual(self._preview()["invoice"]["totals"]["grand_total"], before * 2 / 3)
		self.assertEqual(frappe.get_doc("Sales Order", self.order).items[0].rate, 100)
		self.assertTrue(self._checkout()["ok"])
		self.assertEqual(self._qty(self.item), 0)

	def test_inclusive_tax_and_selling_uom_waive_money_not_stock_quantity(self):
		# Frappe rolls back at class cleanup; cached profile documents outlive
		# that rollback. Restore this shared setting before the next test/class.
		self.addCleanup(set_profile_tax_template, self.profile.name, self.profile.get("taxes_and_charges"))
		if not frappe.db.exists("UOM", "Box"):
			frappe.get_doc({"doctype": "UOM", "uom_name": "Box", "must_be_whole_number": 1}).insert(
				ignore_permissions=True
			)
		item = frappe.get_doc("Item", self.item)
		item.sales_uom = "Box"
		item.append("uoms", {"uom": "Box", "conversion_factor": 6})
		item.save()
		set_profile_tax_template(self.profile.name, ensure_sales_tax_template(included_in_print_rate=1))
		self._source(qty=3)
		before = self._preview()["invoice"]["totals"]["grand_total"]
		response = self._reject()
		self.assertTrue(response["ok"], response)
		preview = self._preview()
		self.assertAlmostEqual(preview["invoice"]["totals"]["grand_total"], before * 2 / 3, places=2)
		self.assertGreater(preview["invoice"]["items"][0]["distributed_discount_amount"], 0)
		self.assertEqual(self._qty(self.item), 18)
		bill = self._checkout()
		self.assertTrue(bill["ok"], bill)
		self.assertEqual(bill["data"]["invoice"]["items"][0]["uom"], "Box")
		self.assertEqual(self._qty(self.item), 0)

	def test_served_rejection_cannot_be_undone_or_remade_again(self):
		self._source(qty=2, served=True)
		response = self._reject(qty=2)
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["items"][0]["rejected_served_qty"], 2)
		self.assertNotIn("Undo Serve", response["data"]["available_actions"])
		self.assertFalse(response["data"]["can_remake"])

	def test_retries_conflicts_stale_review_and_recovery_after_billing(self):
		self._source(qty=2)
		quote = restaurant.preview_rejection(self.ticket)
		key = str(uuid4())
		self.assertTrue(self._reject(quote=quote, key=key)["ok"])
		self.assertTrue(self._reject(quote=quote, key=key)["ok"])
		conflict = self._reject(qty=2, quote=quote, key=key)
		self.assertEqual(conflict["errors"][0]["code"], "IDEMPOTENCY_CONFLICT")
		self.assertEqual(self._reject(quote=quote)["errors"][0]["code"], "REJECTION_REVIEW_CHANGED")
		self.assertTrue(self._checkout()["ok"])
		self.assertTrue(self._reject(quote=quote, key=key)["ok"])
		self.assertFalse(restaurant.preview_rejection(self.ticket)["ok"])

	def test_waiter_cannot_approve_and_missing_decision_does_not_change_prices(self):
		self._source()
		before = frappe.get_doc("Sales Order", self.order).grand_total
		self.assertEqual(self._reject(charge="")["errors"][0]["code"], "REJECTION_CHARGE_REQUIRED")
		self.assertEqual(frappe.get_doc("Sales Order", self.order).grand_total, before)
		user = f"reject-waiter-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Waiter",), pos_profile=self.profile.name)
		frappe.set_user(user)
		self.assertEqual(restaurant.preview_rejection(self.ticket)["errors"][0]["code"], "PermissionError")

	def test_failed_audit_rolls_back_charge_waiver_and_progress(self):
		self._source()
		before = self._preview()["invoice"]["totals"]["grand_total"]
		with patch(
			"vunapos.services.kitchen_lifecycle_service._record",
			side_effect=frappe.ValidationError("Audit unavailable"),
		):
			response = self._reject()
		self.assertFalse(response["ok"], response)
		self.assertEqual(self._preview()["invoice"]["totals"]["grand_total"], before)
		self.assertEqual(restaurant.get_kitchen_ticket(self.ticket)["data"]["items"][0]["rejected_qty"], 0)

	def test_pos_invoice_preserves_waiver_and_source_links(self):
		set_invoice_mode("POS Invoice")
		self._source(qty=2)
		self.assertTrue(self._reject()["ok"])
		response = self._checkout()
		self.assertTrue(response["ok"], response)
		invoice = response["data"]["invoice"]
		self.assertEqual(invoice["doctype"], "POS Invoice")
		self.assertEqual(frappe.get_doc("POS Invoice", invoice["name"]).items[0].sales_order, self.order)

	def test_cancelling_unprepared_quantity_preserves_the_absolute_waiver(self):
		placed = self._send(items=[{"item_code": self.item, "qty": 4, "line_id": "meal"}])
		self.assertTrue(placed["ok"], placed)
		self.order = placed["data"]["name"]
		self.ticket = self._tickets(self.order)[0]
		for action, qty in (("Accept", 4), ("Start", 2), ("Ready", 2)):
			current = restaurant.get_kitchen_ticket(self.ticket)["data"]
			response = restaurant.kitchen_action(
				self.ticket,
				action,
				str(uuid4()),
				current["status"],
				{"meal": qty},
				expected_modified=str(current["modified"]),
			)
			self.assertTrue(response["ok"], response)
		original_rate = frappe.get_doc("Sales Order", self.order).items[0].rate
		self.assertTrue(self._reject()["ok"])
		quote = restaurant.preview_item_cancellation(self.order)
		self.assertTrue(quote["ok"], quote)
		response = restaurant.cancel_order_items(
			self.order,
			{"meal": 2},
			str(uuid4()),
			quote["data"]["fingerprint"],
			"Guest reduced unprepared meals",
		)
		self.assertTrue(response["ok"], response)
		order = frappe.get_doc("Sales Order", self.order)
		self.assertEqual(order.items[0].qty, 2)
		self.assertAlmostEqual(order.items[0].net_amount, original_rate)
		self.assertTrue(self._checkout()["ok"])
		self.assertEqual(self._qty(self.item), 0)

	def test_addon_waiver_is_proportional_and_stock_is_not_returned(self):
		from vunapos.services.modifier_service import assigned_groups

		item = frappe.get_doc("Item", self.item)
		item.append(
			"vunapos_restaurant_addons",
			{"addon_item": self.ingredient, "addon_qty": 2, "enabled": 1, "label": "Extra ingredient"},
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
		self.order = placed["data"]["name"]
		self.ticket = self._tickets(self.order)[0]
		self._finish(self.ticket)
		before = {
			row.name: (row.qty, row.net_amount) for row in frappe.get_doc("Sales Order", self.order).items
		}
		response = self._reject()
		self.assertTrue(response["ok"], response)
		for row in frappe.get_doc("Sales Order", self.order).items:
			self.assertEqual(row.qty, before[row.name][0])
			self.assertEqual(row.net_amount, before[row.name][1] / 2)
		self.assertTrue(self._checkout()["ok"])
		self.assertEqual(self._qty(self.ingredient), 994)
		self.assertEqual(self._qty(self.item), 0)

	def test_unprepared_food_cannot_be_rejected_and_arbitrary_price_edit_stays_blocked(self):
		placed = self._send(items=[{"item_code": self.item, "qty": 2, "line_id": "meal"}])
		self.assertTrue(placed["ok"], placed)
		self.order = placed["data"]["name"]
		self.ticket = self._tickets(self.order)[0]
		self.assertEqual(self._reject()["errors"][0]["code"], "KITCHEN_QUANTITY_EXCEEDED")
		order = frappe.get_doc("Sales Order", self.order)
		order.items[0].rate = 1
		order.flags.ignore_validate_update_after_submit = True
		with self.assertRaises(frappe.ValidationError):
			order.save()
