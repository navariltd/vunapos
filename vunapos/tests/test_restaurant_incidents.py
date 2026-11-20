"""Composite manager procedures using existing POS actions and native stock.

Native production scenarios concern physically cooked output NOT already posted
under another recipe. Misreported manufacture, returns and tracked/advanced
production require a separate native reconciliation, not another stock issue.
"""

from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.tests import test_restaurant_billing as billing
from vunapos.tests import test_restaurant_item_cancellation as cancellation
from vunapos.tests import test_restaurant_remake as remakes
from vunapos.tests.helpers import ensure_test_user


class TestRestaurantIncidents(IntegrationTestCase):
	setUp = billing.TestRestaurantBilling.setUp
	tearDown = billing.TestRestaurantBilling.tearDown
	_item = billing.TestRestaurantBilling._item
	_raw_item = billing.TestRestaurantBilling._raw_item
	_station = billing.TestRestaurantBilling._station
	_send = billing.TestRestaurantBilling._send
	_tickets = billing.TestRestaurantBilling._tickets
	_ready = billing.TestRestaurantBilling._ready
	_preview = billing.TestRestaurantBilling._preview
	_checkout = billing.TestRestaurantBilling._checkout
	_finish = remakes.TestRestaurantRemake._finish
	_qty = remakes.TestRestaurantRemake._qty
	_placed = cancellation.TestRestaurantItemCancellation._placed
	_action = cancellation.TestRestaurantItemCancellation._action

	def _price(self, item, rate):
		existing = frappe.db.get_value(
			"Item Price", {"item_code": item, "price_list": self.profile.selling_price_list}, "name"
		)
		if existing:
			doc = frappe.get_doc("Item Price", existing)
			doc.price_list_rate = rate
			doc.save()
			return
		frappe.get_doc(
			{
				"doctype": "Item Price",
				"item_code": item,
				"price_list": self.profile.selling_price_list,
				"price_list_rate": rate,
			}
		).insert()

	def _table_visits(self):
		from vunapos.services.service_type_service import get_profile_service_types

		floor = frappe.get_doc(
			{
				"doctype": "Restaurant Floor",
				"floor_name": f"Incident {self.token}",
				"restaurant": self.profile.vunapos_restaurant,
				"branch": self.profile.vunapos_branch,
			}
		).insert()
		service = next(
			row["name"] for row in get_profile_service_types(self.profile) if row["requires_table"]
		)
		visits, tables = [], []
		for label in ("1", "2"):
			table = frappe.get_doc(
				{"doctype": "Restaurant Table", "floor": floor.name, "table_label": label}
			).insert()
			response = restaurant.open_session(
				self.profile.name, str(uuid4()), tables=[table.name], service_type=service
			)
			self.assertTrue(response["ok"], response)
			visits.append(response["data"]["name"])
			tables.append(table.name)
		return visits, tables

	def test_substitution_before_preparation_bills_remaining_original_and_new_round(self):
		other = self._item("Substitute")
		self._price(self.item, 100)
		self._price(other, 175)
		order = self._placed()
		quote = restaurant.preview_item_cancellation(order)["data"]
		key = str(uuid4())
		for _ in range(2):
			cancelled = restaurant.cancel_order_items(
				order, {"meal": 1}, key, quote["fingerprint"], f"Substitute one dish with {other}"
			)
			self.assertTrue(cancelled["ok"], cancelled)
		placed = self._send(
			[
				{
					"item_code": other,
					"qty": 1,
					"line_id": "replacement",
					"note": f"Replaces one cancelled dish on {order}",
				}
			]
		)
		self.assertTrue(placed["ok"], placed)
		self._finish(self._tickets(order)[0])
		self._finish(self._tickets(placed["data"]["name"])[0])
		result = self._checkout()
		self.assertTrue(result["ok"], result)
		items = {row["item_code"]: row for row in result["data"]["invoice"]["items"]}
		self.assertEqual((items[self.item]["qty"], items[self.item]["rate"]), (3, 100))
		self.assertEqual((items[other]["qty"], items[other]["rate"]), (1, 175))
		self.assertEqual(self._qty(self.ingredient), 996)
		self.assertEqual(self._qty(self.item), 0)
		self.assertEqual(self._qty(other), 0)
		visit = restaurant.get_session(self.session)["data"]
		original = next(row for row in visit["rounds"] if row["name"] == order)
		replacement = next(row for row in visit["rounds"] if row["name"] == placed["data"]["name"])
		self.assertEqual(len(original["cancellations"]), 1)
		self.assertIn(other, original["cancellations"][0]["reason"])
		self.assertIn(order, replacement["items"][0]["note"])
		self.assertEqual(
			frappe.db.get_value("Kitchen Order Ticket Item", {"parent": self._tickets(order)[0]}, "qty"), 4
		)
		self.assertFalse(
			frappe.db.exists(
				"Stock Reservation Entry",
				{
					"voucher_type": "Work Order",
					"docstatus": 1,
					"reserved_qty": [">", 0],
					"consumed_qty": 0,
					"voucher_no": [
						"in",
						frappe.get_all(
							"Work Order",
							filters={"sales_order": ["in", [order, placed["data"]["name"]]]},
							pluck="name",
						),
					],
				},
			)
		)

	def test_prepared_substitution_waives_charge_but_consumes_original_food_once(self):
		other = self._item("Prepared Substitute")
		self._price(self.item, 100)
		self._price(other, 175)
		order = self._ready(1)
		ticket = self._tickets(order)[0]
		quote = restaurant.preview_rejection(ticket)["data"]
		response = restaurant.reject_prepared_items(
			ticket,
			{quote["lines"][0]["line_id"]: 1},
			str(uuid4()),
			quote["fingerprint"],
			"Prepared dish rejected; guest chose substitute",
			"Remove charge",
		)
		self.assertTrue(response["ok"], response)
		placed = self._send([{"item_code": other, "qty": 1, "line_id": "replacement"}])
		self.assertTrue(placed["ok"], placed)
		self._finish(self._tickets(placed["data"]["name"])[0])
		result = self._checkout()
		self.assertTrue(result["ok"], result)
		self.assertEqual(result["data"]["invoice"]["totals"]["grand_total"], 175)
		self.assertEqual(len(result["data"]["invoice"]["items"]), 2)
		self.assertEqual(self._qty(self.ingredient), 998)
		self.assertEqual(self._qty(self.item), 0)
		self.assertEqual(self._qty(other), 0)

	def test_wrong_table_service_correction_does_not_move_food_or_charges_between_visits(self):
		self._price(self.item, 100)
		(visit_a, visit_b), (table_a, table_b) = self._table_visits()
		self.session = visit_a
		order_a = self._ready(1)
		ticket_a = self._tickets(order_a)[0]
		served = restaurant.kitchen_action(ticket_a, "Serve", str(uuid4()), "Ready")
		self.assertTrue(served["ok"], served)
		self.session = visit_b
		self._ready(2)
		before_b = self._preview()
		# Moving a visit to an occupied table must not merge its bill.
		moved = restaurant.update_session(visit_a, tables=[table_b])
		self.assertFalse(moved["ok"], moved)
		self.assertEqual(moved["errors"][0]["code"], "TABLE_OCCUPIED")
		self.assertEqual(frappe.get_doc("Restaurant Session", visit_a).tables[0].table, table_a)
		snapshot = restaurant.get_kitchen_ticket(ticket_a)["data"]
		line = snapshot["items"][0]["line_id"]
		corrected = restaurant.kitchen_action(
			ticket_a,
			"Undo Serve",
			str(uuid4()),
			snapshot["status"],
			{line: 1},
			str(snapshot["modified"]),
			"Untouched dish collected from wrong table; not consumed",
		)
		self.assertTrue(corrected["ok"], corrected)
		self.assertEqual(corrected["data"]["items"][0]["ready_to_serve_qty"], 1)
		self.assertEqual(self._preview()["invoice"]["totals"], before_b["invoice"]["totals"])
		self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", ticket_a, "restaurant_session"), visit_a)
		self.assertEqual(self._qty(self.ingredient), 997)
		self.assertTrue(restaurant.kitchen_action(ticket_a, "Serve", str(uuid4()), "Ready")["ok"])
		for visit, qty in ((visit_a, 1), (visit_b, 2)):
			self.session = visit
			result = self._checkout()
			self.assertTrue(result["ok"], result)
			self.assertEqual(sum(row["qty"] for row in result["data"]["invoice"]["items"]), qty)
		self.assertEqual(self._qty(self.item), 0)

	def test_consumed_wrong_table_dish_uses_remake_not_cross_visit_rebilling(self):
		self._price(self.item, 100)
		(visit_a, visit_b), _tables = self._table_visits()
		self.session = visit_a
		order_a = self._ready(1)
		ticket_a = self._tickets(order_a)[0]
		self.assertTrue(restaurant.kitchen_action(ticket_a, "Serve", str(uuid4()), "Ready")["ok"])
		self.session = visit_b
		self._ready(1)
		quote = restaurant.preview_remake(ticket_a)["data"]
		response = restaurant.request_remake(
			ticket_a,
			{quote["lines"][0]["line_id"]: 1},
			str(uuid4()),
			quote["fingerprint"],
			"Consumed at another table; manager retains original bill and provides replacement",
			"Keep for guest",
		)
		self.assertTrue(response["ok"], response)
		event = next(row for row in response["data"]["actions"] if row["action"] == "Request Remake")
		self._finish(event["item_quantities"]["replacement_ticket"])
		for visit in (visit_a, visit_b):
			self.session = visit
			result = self._checkout()
			self.assertTrue(result["ok"], result)
			self.assertEqual(result["data"]["invoice"]["totals"]["grand_total"], 100)
		self.assertEqual(self._qty(self.ingredient), 997)
		self.assertEqual(self._qty(self.item), 0)

	def _native_manufacture(self, item):
		from erpnext.manufacturing.doctype.work_order.work_order import make_stock_entry

		wo = frappe.get_doc(
			{
				"doctype": "Work Order",
				"company": self.profile.company,
				"production_item": item,
				"bom_no": frappe.get_cached_value("Item", item, "default_bom"),
				"qty": 1,
				"source_warehouse": self.profile.warehouse,
				"wip_warehouse": self.profile.warehouse,
				"fg_warehouse": self.profile.warehouse,
				"skip_transfer": 1,
				"from_wip_warehouse": 0,
			}
		)
		wo.insert()
		wo.submit()
		entry = frappe.get_doc(make_stock_entry(wo.name, "Manufacture", 1))
		entry.remarks = f"Manager reviewed unrecorded physical production for visit {self.session}; actual recipe, not an additional sale"
		entry.insert()
		entry.submit()
		return wo, entry

	def _discard_native_output(self, item, manufacture):
		account = frappe.get_cached_value("Company", self.profile.company, "stock_adjustment_account")
		entry = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"stock_entry_type": "Material Issue",
				"purpose": "Material Issue",
				"company": self.profile.company,
				"remarks": f"Manager-approved discard for visit {self.session}; output from {manufacture.name}",
				"items": [
					{
						"item_code": item,
						"s_warehouse": self.profile.warehouse,
						"qty": 1,
						"expense_account": account,
					}
				],
			}
		)
		entry.insert()
		entry.submit()
		return entry

	def test_unrecorded_wrong_dish_uses_actual_recipe_and_not_the_customer_bill(self):
		self._price(self.item, 100)
		original_raw, original_token = self.ingredient, self.token
		self.token = uuid4().hex[:8]
		self.ingredient = self._raw_item()
		wrong_raw = self.ingredient
		wrong_item = self._item("Physically Wrong")
		self.ingredient, self.token = original_raw, original_token
		placed = self._send([{"item_code": self.item, "qty": 1, "line_id": "intended"}])
		self.assertTrue(placed["ok"], placed)
		wo, manufactured = self._native_manufacture(wrong_item)
		self.assertFalse(wo.sales_order)
		self.assertEqual(self._qty(wrong_raw), 999)
		self.assertEqual(self._qty(original_raw), 1000)
		self.assertFalse(self._preview()["can_checkout"])
		self._discard_native_output(wrong_item, manufactured)
		self._finish(self._tickets(placed["data"]["name"])[0])
		result = self._checkout()
		self.assertTrue(result["ok"], result)
		self.assertEqual([row["item_code"] for row in result["data"]["invoice"]["items"]], [self.item])
		self.assertEqual(self._qty(original_raw), 999)
		self.assertEqual(self._qty(wrong_raw), 999)
		self.assertEqual(self._qty(wrong_item), 0)

	def test_unrecorded_extra_production_is_expensed_without_consuming_the_reserved_meal(self):
		self._price(self.item, 100)
		self._ready(1)
		before = self._preview()["invoice"]["totals"]
		_wo, manufactured = self._native_manufacture(self.item)
		self.assertEqual(self._qty(self.item), 2)
		issued = self._discard_native_output(self.item, manufactured)
		self.assertEqual(self._qty(self.item), 1)
		self.assertAlmostEqual(issued.total_outgoing_value, 10)
		result = self._checkout()
		self.assertTrue(result["ok"], result)
		self.assertEqual(result["data"]["invoice"]["totals"]["grand_total"], before["grand_total"])
		self.assertEqual(self._qty(self.ingredient), 998)
		self.assertEqual(self._qty(self.item), 0)

	def test_waiter_cannot_post_native_stock_corrections(self):
		user = f"incident-waiter-{self.token}@example.com"
		ensure_test_user(user, roles=["VunaPOS Waiter"], pos_profile=self.profile.name)
		frappe.set_user(user)
		try:
			with self.assertRaises(frappe.PermissionError):
				frappe.get_doc(
					{
						"doctype": "Stock Entry",
						"stock_entry_type": "Material Issue",
						"company": self.profile.company,
					}
				).insert()
		finally:
			frappe.set_user("Administrator")
