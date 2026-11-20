from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.services import kitchen_lifecycle_service as kitchen
from vunapos.tests import test_kitchen_service as fixtures


class TestPartialPreparation(IntegrationTestCase):
	setUp = fixtures.TestKitchenService.setUp
	tearDown = fixtures.TestKitchenService.tearDown
	_item = fixtures.TestKitchenService._item
	_raw_item = fixtures.TestKitchenService._raw_item
	_station = fixtures.TestKitchenService._station
	_send = fixtures.TestKitchenService._send
	_tickets = fixtures.TestKitchenService._tickets

	def _placed(self, items=None):
		result = self._send(items or [{"item_code": self.item, "qty": 4, "line_id": "main"}])
		self.assertTrue(result["ok"], result)
		return self._tickets(result["data"]["name"])[0]

	def _act(self, ticket, action, quantities=None, key=None, snapshot=None):
		if snapshot is None:
			response = restaurant.get_kitchen_ticket(ticket)
			self.assertTrue(response["ok"], response)
			snapshot = response["data"]
		return restaurant.kitchen_action(
			ticket, action, key or str(uuid4()), snapshot["status"], quantities, str(snapshot["modified"])
		)

	def _ok(self, ticket, action, quantities=None):
		result = self._act(ticket, action, quantities)
		self.assertTrue(result["ok"], result)
		return result["data"]

	def test_four_meals_can_be_waiting_preparing_ready_and_served_together(self):
		ticket = self._placed()
		self._ok(ticket, "Accept")
		self._ok(ticket, "Start", {"main": 3})
		self._ok(ticket, "Ready", {"main": 2})
		result = self._ok(ticket, "Serve", {"main": 1})
		line = result["items"][0]
		self.assertEqual(
			[line[key] for key in ("waiting_qty", "preparing_qty", "ready_to_serve_qty", "served_qty")],
			[1, 1, 1, 1],
		)
		self.assertEqual(result["status"], "Preparing")
		self.assertIn("Ready", result["available_actions"])
		self.assertIn("Serve", result["available_actions"])
		self.assertEqual(frappe.db.get_value("Work Order", line["work_order"], "produced_qty"), 2)
		source = frappe.get_doc("Kitchen Order Ticket", ticket)
		self.assertEqual(
			frappe.db.get_value("Sales Order Item", source.items[0].sales_order_item, "stock_reserved_qty"), 2
		)
		self.assertEqual(frappe.db.get_value("Sales Order Item", source.items[0].sales_order_item, "qty"), 4)
		self.assertEqual(source.items[0].qty, 4)
		self._ok(ticket, "Start", {"main": 1})
		self._ok(ticket, "Ready", {"main": 2})
		final = self._ok(ticket, "Serve", {"main": 3})
		self.assertEqual(final["status"], "Served")
		self.assertEqual(frappe.db.get_value("Work Order", line["work_order"], "produced_qty"), 4)

	def test_addons_follow_the_parent_completion_ratio(self):
		from vunapos.services import kitchen_progress_service as progress

		items = [
			frappe._dict(line_id="meal", qty=4, item_name="Meal", uom="Nos", parent_line_id=None),
			frappe._dict(line_id="extra", qty=8, parent_line_id="meal"),
		]
		events = [
			{"action": action, "item_quantities": {"deltas": {"meal": qty}}}
			for action, qty in (("Accept", 4), ("Start", 3), ("Ready", 2), ("Serve", 1))
		]
		rows = progress.derive(items, "Preparing", events)
		self.assertEqual(rows["extra"]["qty"], 8)
		self.assertEqual(
			[
				rows["extra"][field]
				for field in ("waiting_qty", "preparing_qty", "ready_to_serve_qty", "served_qty")
			],
			[2, 2, 2, 2],
		)
		self.assertEqual(rows["extra"]["available_quantities"], {})
		doc = type("Ticket", (), {"items": items})()
		with self.assertRaises(frappe.ValidationError) as error:
			progress.selection(doc, "Ready", {"extra": 1}, rows)
		self.assertEqual(error.exception.vuna_error_code, "INVALID_KITCHEN_LINE")

	def test_selected_dish_does_not_manufacture_another_line(self):
		other = self._item("Other")
		ticket = self._placed(
			[
				{"item_code": self.item, "qty": 2, "line_id": "main"},
				{"item_code": other, "qty": 2, "line_id": "other"},
			]
		)
		self._ok(ticket, "Accept")
		self._ok(ticket, "Start")
		result = self._ok(ticket, "Ready", {"main": 1})
		lines = {row["line_id"]: row for row in result["items"]}
		self.assertEqual(frappe.db.get_value("Work Order", lines["main"]["work_order"], "produced_qty"), 1)
		self.assertEqual(frappe.db.get_value("Work Order", lines["other"]["work_order"], "produced_qty"), 0)

	def test_quantities_are_bounded_and_cannot_skip_preparation(self):
		ticket = self._placed()
		for values in (
			{"main": -1},
			{"main": 0},
			{"main": float("inf")},
			{"main": True},
			{"foreign": 1},
			{"main": 5},
		):
			response = self._act(ticket, "Accept", values)
			self.assertFalse(response["ok"], response)
		self.assertFalse(self._act(ticket, "Ready", {"main": 1})["ok"])
		self.assertFalse(self._act(ticket, "Serve", {"main": 1})["ok"])
		self.assertFalse(restaurant.kitchen_action(ticket, "Accept", str(uuid4()), "Sent", {"main": 1})["ok"])

	def test_stale_quantity_update_is_rejected_even_when_status_is_unchanged(self):
		ticket = self._placed()
		self._ok(ticket, "Accept")
		self._ok(ticket, "Start")
		original = restaurant.get_kitchen_ticket(ticket)["data"]
		self._ok(ticket, "Ready", {"main": 1})
		response = self._act(ticket, "Ready", {"main": 1}, snapshot=original)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "KITCHEN_STALE_STATE")
		self.assertEqual(restaurant.get_kitchen_ticket(ticket)["data"]["items"][0]["ready_qty"], 1)

	def test_retry_reuses_exact_quantities_and_conflicting_payload_is_rejected(self):
		ticket = self._placed()
		self._ok(ticket, "Accept")
		self._ok(ticket, "Start")
		original = restaurant.get_kitchen_ticket(ticket)["data"]
		key = str(uuid4())
		first = self._act(ticket, "Ready", {"main": 1}, key, original)
		self.assertTrue(first["ok"], first)
		retry = self._act(ticket, "Ready", {"main": 1}, key, original)
		self.assertTrue(retry["ok"], retry)
		conflict = self._act(ticket, "Ready", {"main": 2}, key, original)
		self.assertFalse(conflict["ok"], conflict)
		self.assertEqual(conflict["errors"][0]["code"], "IDEMPOTENCY_CONFLICT")
		self.assertEqual(retry["data"]["items"][0]["ready_qty"], 1)

	def test_native_failure_rolls_back_production_and_progress_then_retries(self):
		ticket = self._placed()
		self._ok(ticket, "Accept")
		self._ok(ticket, "Start")
		original = restaurant.get_kitchen_ticket(ticket)["data"]
		key = str(uuid4())
		with patch.object(kitchen, "_stock_entry", side_effect=RuntimeError("Test production failure")):
			response = self._act(ticket, "Ready", {"main": 1}, key, original)
		self.assertFalse(response["ok"], response)
		self.assertEqual(restaurant.get_kitchen_ticket(ticket)["data"]["items"][0]["ready_qty"], 0)
		self.assertTrue(self._act(ticket, "Ready", {"main": 1}, key, original)["ok"])

	def test_selling_uom_quantities_manufacture_stock_uom_units(self):
		item = frappe.get_doc("Item", self.item)
		if not frappe.db.exists("UOM", "Box"):
			frappe.get_doc({"doctype": "UOM", "uom_name": "Box"}).insert()
		item.append("uoms", {"uom": "Box", "conversion_factor": 6})
		item.sales_uom = "Box"
		item.save()
		ticket = self._placed([{"item_code": self.item, "qty": 2, "uom": "Box", "line_id": "main"}])
		self._ok(ticket, "Accept")
		self._ok(ticket, "Start")
		result = self._ok(ticket, "Ready", {"main": 1})
		self.assertEqual(result["items"][0]["ready_qty"], 1)
		self.assertEqual(
			frappe.db.get_value("Work Order", result["items"][0]["work_order"], "produced_qty"), 6
		)

	def test_imported_whole_ticket_progress_survives_first_quantity_action(self):
		ticket = self._placed()
		frappe.db.set_value("Kitchen Order Ticket", ticket, "status", "Preparing")
		result = self._ok(ticket, "Ready", {"main": 1})
		self.assertEqual(result["items"][0]["started_qty"], 4)
		self.assertEqual(result["items"][0]["ready_qty"], 1)
		final = self._ok(ticket, "Ready", {"main": 3})
		self.assertEqual(final["status"], "Ready")

	def test_wip_transfer_and_partial_manufacture_consume_only_selected_quantities(self):
		warehouse = frappe.copy_doc(frappe.get_doc("Warehouse", self.profile.warehouse))
		warehouse.warehouse_name = f"_Test Partial WIP {self.token}"
		warehouse.insert(ignore_permissions=True)
		station = frappe.get_doc("Kitchen Station", self.station)
		station.wip_warehouse = warehouse.name
		station.save()
		frappe.db.set_single_value(
			"Manufacturing Settings",
			"backflush_raw_materials_based_on",
			"Material Transferred for Manufacture",
		)
		ticket = self._placed()
		self._ok(ticket, "Accept")
		result = self._ok(ticket, "Start", {"main": 2})
		wo = result["items"][0]["work_order"]
		self.assertEqual(frappe.db.get_value("Work Order", wo, "material_transferred_for_manufacturing"), 2)
		self._ok(ticket, "Ready", {"main": 1})
		self.assertEqual(frappe.db.get_value("Work Order", wo, "produced_qty"), 1)
		self.assertEqual(
			frappe.db.get_value(
				"Bin", {"item_code": self.ingredient, "warehouse": warehouse.name}, "actual_qty"
			),
			1,
		)

	def test_manager_can_correct_service_without_manufacturing_or_issuing_again(self):
		from vunapos.tests.helpers import ensure_test_user

		ticket = self._placed()
		for action in ("Accept", "Start", "Ready", "Serve"):
			self._ok(ticket, action)
		snapshot = restaurant.get_kitchen_ticket(ticket)["data"]
		wo = snapshot["items"][0]["work_order"]
		before = frappe.db.count("Stock Entry", {"work_order": wo, "docstatus": 1})
		key = str(uuid4())
		args = (
			ticket,
			"Undo Serve",
			key,
			"Served",
			{"main": 1},
			str(snapshot["modified"]),
			"Marked served before collection",
		)
		response = restaurant.kitchen_action(*args)
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["items"][0]["served_qty"], 3)
		self.assertEqual(response["data"]["items"][0]["ready_to_serve_qty"], 1)
		self.assertEqual(response["data"]["status"], "Ready")
		self.assertTrue(restaurant.kitchen_action(*args)["ok"])
		self.assertEqual(frappe.db.count("Stock Entry", {"work_order": wo, "docstatus": 1}), before)
		self._ok(ticket, "Serve", {"main": 1})
		self.assertEqual(frappe.db.get_value("Work Order", wo, "produced_qty"), 4)
		user = f"partial-waiter-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Waiter",), pos_profile=self.profile.name)
		frappe.set_user(user)
		try:
			latest = restaurant.get_kitchen_ticket(ticket)["data"]
			denied = restaurant.kitchen_action(
				ticket,
				"Undo Serve",
				str(uuid4()),
				"Served",
				{"main": 1},
				str(latest["modified"]),
				"Wrong click",
			)
			self.assertFalse(denied["ok"], denied)
			self.assertEqual(denied["errors"][0]["code"], "PermissionError")
		finally:
			frappe.set_user("Administrator")
