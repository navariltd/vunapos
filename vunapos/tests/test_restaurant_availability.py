from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime

from vunapos.api import restaurant
from vunapos.services import restaurant_availability_service as availability
from vunapos.tests import test_kitchen_service as fixtures
from vunapos.tests import test_restaurant_billing as billing


class TestRestaurantAvailability(IntegrationTestCase):
	setUp = fixtures.TestKitchenService.setUp
	tearDown = fixtures.TestKitchenService.tearDown
	_item = fixtures.TestKitchenService._item
	_raw_item = fixtures.TestKitchenService._raw_item
	_station = fixtures.TestKitchenService._station
	_send = fixtures.TestKitchenService._send
	_tickets = fixtures.TestKitchenService._tickets
	_preview = billing.TestRestaurantBilling._preview
	_checkout = billing.TestRestaurantBilling._checkout

	def _pause(self, target_type="Item", target=None, **values):
		return frappe.get_doc(
			{
				"doctype": availability.DOCTYPE,
				"restaurant": self.profile.vunapos_restaurant,
				"branch": self.profile.vunapos_branch,
				"target_type": target_type,
				"item": (target or self.item) if target_type == "Item" else None,
				"kitchen_station": (target or self.station) if target_type == "Kitchen Station" else None,
				"paused": 1,
				"reason": "Equipment unavailable",
				**values,
			}
		).insert(ignore_permissions=True)

	def test_qsr_with_no_finished_stock_still_checks_ingredients_not_pause_state(self):
		self.assertTrue(self._send()["ok"])
		self._pause()
		response = self._send()
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "RESTAURANT_ITEM_PAUSED")

	def test_menu_exposes_the_pause_instead_of_hiding_stock_or_qsr_classification(self):
		from vunapos.services.menu_service import get_menu

		self._pause()
		service = frappe.db.get_value("Restaurant Session", self.session, "service_type")
		menu = get_menu(self.profile.name, service_type=service, query=self.item)
		item = next(row for row in menu["items"] if row["item_code"] == self.item)
		self.assertTrue(item["ordering_paused"])
		self.assertTrue(item["is_qsr"])
		self.assertIn("Equipment unavailable", item["availability_reason"])

	def test_reason_expiry_and_station_location_are_validated(self):
		with self.assertRaises(frappe.ValidationError):
			self._pause(reason="   ")
		with self.assertRaises(frappe.ValidationError):
			self._pause(unavailable_until=add_to_date(now_datetime(), minutes=-1))
		from vunapos.tests.helpers import ensure_test_restaurant

		other_restaurant = ensure_test_restaurant(f"_Test Other Pause {self.token}")
		station = self._station("Other", [], restaurant_name=other_restaurant)
		with self.assertRaises(frappe.ValidationError):
			self._pause("Kitchen Station", target=station)

	def test_pause_blocks_new_round_without_creating_order_ticket_or_work_order(self):
		self._pause()
		before = {
			doctype: frappe.db.count(doctype)
			for doctype in ("Sales Order", "Work Order", "Kitchen Order Ticket")
		}
		response = self._send()
		self.assertEqual(response["errors"][0]["code"], "RESTAURANT_ITEM_PAUSED")
		self.assertEqual(before, {doctype: frappe.db.count(doctype) for doctype in before})

	def test_pause_does_not_change_stock_or_globally_disable_item(self):
		before = frappe.db.get_value(
			"Bin", {"item_code": self.ingredient, "warehouse": self.profile.warehouse}, "actual_qty"
		)
		self._pause()
		self.assertEqual(frappe.db.get_value("Item", self.item, "disabled"), 0)
		self.assertEqual(
			frappe.db.get_value(
				"Bin", {"item_code": self.ingredient, "warehouse": self.profile.warehouse}, "actual_qty"
			),
			before,
		)

	def test_resume_restores_ordering_and_preserves_record_identity(self):
		pause = self._pause()
		name = pause.name
		pause.paused = 0
		pause.reason = "Equipment repaired"
		pause.save()
		self.assertEqual(pause.name, name)
		self.assertTrue(self._send()["ok"])

	def test_expiry_is_evaluated_without_scheduler_or_editing_records(self):
		pause = self._pause(unavailable_until=add_to_date(now_datetime(), minutes=10))
		self.assertTrue(availability.active(pause.restaurant, pause.branch))
		with patch(
			"vunapos.services.restaurant_availability_service.now_datetime",
			return_value=add_to_date(now_datetime(), minutes=11),
		):
			self.assertNotIn(
				pause.name, [row.name for row in availability.active(pause.restaurant, pause.branch)]
			)
			self.assertTrue(self._send()["ok"])
		self.assertEqual(frappe.db.get_value(availability.DOCTYPE, pause.name, "paused"), 1)

	def test_duplicate_target_is_rejected_and_context_cannot_be_moved(self):
		pause = self._pause()
		with self.assertRaises(frappe.ValidationError):
			self._pause()
		other = self._item("Other")
		pause.item = other
		with self.assertRaises(frappe.ValidationError):
			pause.save()

	def test_only_managers_can_change_availability_even_with_ignore_permissions(self):
		with patch("frappe.get_roles", return_value=["VunaPOS Kitchen User"]):
			with self.assertRaises(frappe.PermissionError):
				self._pause()

	def test_station_pause_preserves_routing_and_blocks_new_orders(self):
		self._pause("Kitchen Station")
		response = self._send()
		self.assertEqual(response["errors"][0]["code"], "RESTAURANT_STATION_PAUSED")
		self.assertIn("Equipment unavailable", response["errors"][0]["message"])

	def test_existing_ticket_can_finish_and_retry_returns_original_after_pause(self):
		key = str(uuid4())
		placed = self._send(key=key)
		self.assertTrue(placed["ok"], placed)
		self._pause("Kitchen Station")
		replay = self._send(key=key)
		self.assertTrue(replay["ok"], replay)
		self.assertEqual(replay["data"]["name"], placed["data"]["name"])
		ticket = self._tickets(placed["data"]["name"])[0]
		for action, status in (
			("Accept", "Sent"),
			("Start", "Accepted"),
			("Ready", "Preparing"),
			("Serve", "Ready"),
		):
			response = restaurant.kitchen_action(ticket, action, str(uuid4()), status)
			self.assertTrue(response["ok"], response)
		board = restaurant.get_kitchen_board(self.profile.name)["data"]
		self.assertTrue(
			next(row for row in board["stations"] if row["name"] == self.station)["ordering_paused"]
		)
		bill = self._checkout()
		self.assertTrue(bill["ok"], bill)

	def test_catalogue_annotation_and_expiry_delay_explain_paused_station(self):
		self._pause("Kitchen Station", unavailable_until=add_to_date(now_datetime(), minutes=10))
		items = [{"item_code": self.item}]
		delay = availability.annotate(self.profile.vunapos_restaurant, self.profile.vunapos_branch, items)
		self.assertTrue(items[0]["ordering_paused"])
		self.assertIn("Equipment unavailable", items[0]["availability_reason"])
		self.assertGreater(delay, 0)
		self.assertLessEqual(delay, 601)

	def test_pause_does_not_apply_to_another_branch(self):
		self._pause()
		self.assertFalse(availability.active(self.profile.vunapos_restaurant, "Different Branch"))
		availability.check_items(self.profile.vunapos_restaurant, "Different Branch", [self.item])

	def test_template_pause_covers_variants_and_stock_addons_are_checked(self):
		self._pause()
		# Item relationship is server-owned; the pause must not rely on a cart
		# supplying its template or parent item correctly.
		with (
			patch("frappe.get_all", return_value=[self.item]),
			patch(
				"vunapos.services.restaurant_availability_service.active",
				return_value=[
					frappe._dict(
						target_type="Item", item=self.item, target_label="Template", reason="Unavailable"
					)
				],
			),
		):
			with self.assertRaises(frappe.ValidationError):
				availability.check_items(
					self.profile.vunapos_restaurant, self.profile.vunapos_branch, ["Variant"]
				)
		item = frappe.get_doc("Item", self.item)
		item.append(
			"vunapos_restaurant_addons", {"addon_item": self.ingredient, "addon_qty": 1, "enabled": 1}
		)
		item.save()
		from vunapos.services.modifier_service import assigned_groups

		group = assigned_groups(self.item)[0]
		pause = frappe.get_doc(availability.DOCTYPE, {"item": self.item})
		pause.paused = 0
		pause.reason = "Main available"
		pause.save()
		self._pause(target=self.ingredient)
		response = self._send(
			[
				{
					"item_code": self.item,
					"qty": 1,
					"line_id": "main",
					"modifiers": [{"group": group.name, "option": group.options[0].name}],
				}
			]
		)
		self.assertEqual(response["errors"][0]["code"], "RESTAURANT_ITEM_PAUSED")
