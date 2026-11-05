from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.services import kitchen_lifecycle_service as kitchen
from vunapos.setup.utils import KITCHEN_ROLE
from vunapos.tests import test_kitchen_service as fixtures
from vunapos.tests.helpers import ensure_test_user


class TestKitchenLifecycle(IntegrationTestCase):
	setUp = fixtures.TestKitchenService.setUp
	tearDown = fixtures.TestKitchenService.tearDown
	_item = fixtures.TestKitchenService._item
	_raw_item = fixtures.TestKitchenService._raw_item
	_station = fixtures.TestKitchenService._station
	_send = fixtures.TestKitchenService._send
	_tickets = fixtures.TestKitchenService._tickets

	def _placed(self, items=None):
		response = self._send(items=items)
		self.assertTrue(response["ok"], response)
		return self._tickets(response["data"]["name"])[0]

	def _act(self, name, action, key=None, expected=None):
		return restaurant.kitchen_action(
			name,
			action,
			key or str(uuid4()),
			expected or frappe.db.get_value("Kitchen Order Ticket", name, "status"),
		)

	def _advance(self, name):
		for action in ("Accept", "Start", "Ready"):
			response = self._act(name, action)
			self.assertTrue(response["ok"], response)

	def test_full_lifecycle_manufactures_once_and_serving_does_not_consume_again(self):
		name = self._placed()
		self._advance(name)
		ticket = frappe.get_doc("Kitchen Order Ticket", name)
		wo = frappe.get_doc("Work Order", ticket.items[0].work_order)
		self.assertEqual(wo.produced_qty, 2)
		self.assertEqual(
			frappe.db.count("Stock Entry", {"work_order": wo.name, "purpose": "Manufacture", "docstatus": 1}),
			1,
		)
		self.assertEqual(
			frappe.db.get_value("Sales Order Item", ticket.items[0].sales_order_item, "stock_reserved_qty"), 2
		)
		before = frappe.db.get_value(
			"Bin", {"item_code": self.ingredient, "warehouse": self.profile.warehouse}, "actual_qty"
		)
		response = self._act(name, "Serve")
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["status"], "Served")
		self.assertEqual(
			frappe.db.get_value(
				"Bin", {"item_code": self.ingredient, "warehouse": self.profile.warehouse}, "actual_qty"
			),
			before,
		)
		self.assertEqual(
			frappe.db.count("Kitchen Ticket Action", {"kitchen_ticket": name, "outcome": "Succeeded"}), 4
		)

	def test_state_skipping_and_stale_commands_are_rejected(self):
		name = self._placed()
		response = self._act(name, "Ready", expected="Sent")
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "KITCHEN_STALE_STATE")
		self.assertTrue(self._act(name, "Accept")["ok"])
		self.assertFalse(self._act(name, "Start", expected="Sent")["ok"])

	def test_retry_reuses_success_and_never_moves_state_backwards(self):
		name = self._placed()
		key = str(uuid4())
		self.assertTrue(self._act(name, "Accept", key, "Sent")["ok"])
		self.assertTrue(self._act(name, "Start")["ok"])
		response = self._act(name, "Accept", key, "Sent")
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["status"], "Preparing")
		self.assertEqual(
			frappe.db.count("Kitchen Ticket Action", {"request_key": key, "outcome": "Succeeded"}), 1
		)
		conflict = self._act(name, "Ready", key, "Preparing")
		self.assertFalse(conflict["ok"], conflict)
		self.assertEqual(conflict["errors"][0]["code"], "IDEMPOTENCY_CONFLICT")

	def test_kitchen_user_prepares_without_global_manufacturing_permissions(self):
		name = self._placed()
		user = f"chef-{self.token}@example.com"
		ensure_test_user(user, roles=(KITCHEN_ROLE,), pos_profile=self.profile.name)
		frappe.set_user(user)
		self.assertFalse(frappe.has_permission("Stock Entry", "create"))
		self.assertFalse(frappe.has_permission("Work Order", "read"))
		self.assertFalse(frappe.has_permission("Restaurant Session", "read"))
		from vunapos.services.sync_service import get_pos_bootstrap_config

		bootstrap = get_pos_bootstrap_config(self.profile.name)
		self.assertIn(KITCHEN_ROLE, bootstrap["pos_profile"]["restaurant_roles"])
		self._advance(name)
		self.assertFalse(self._act(name, "Serve")["ok"])

	def test_waiter_can_serve_but_cannot_prepare(self):
		name = self._placed()
		user = f"serve-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Waiter",), pos_profile=self.profile.name)
		frappe.set_user(user)
		self.assertFalse(self._act(name, "Accept")["ok"])
		frappe.set_user("Administrator")
		self._advance(name)
		frappe.set_user(user)
		self.assertTrue(self._act(name, "Serve")["ok"])

	def test_failed_manufacture_is_logged_rolled_back_and_retryable(self):
		name = self._placed()
		self.assertTrue(self._act(name, "Accept")["ok"])
		self.assertTrue(self._act(name, "Start")["ok"])
		key = str(uuid4())
		with patch.object(kitchen, "_stock_entry", side_effect=RuntimeError("Finish the Job Card first")):
			response = self._act(name, "Ready", key)
		self.assertFalse(response["ok"], response)
		self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", name, "status"), "Preparing")
		self.assertEqual(
			frappe.db.count("Kitchen Ticket Action", {"request_key": key, "outcome": "Failed"}), 1
		)
		self.assertTrue(self._act(name, "Ready", key)["ok"])
		self.assertEqual(
			frappe.db.count("Kitchen Ticket Action", {"request_key": key, "outcome": "Succeeded"}), 1
		)

	def test_empty_native_permission_error_has_production_context_and_retry(self):
		name = self._placed()
		self.assertTrue(self._act(name, "Accept")["ok"])
		self.assertTrue(self._act(name, "Start")["ok"])
		wo = frappe.db.get_value("Kitchen Order Ticket Item", {"parent": name}, "work_order")
		key = str(uuid4())
		with patch.object(kitchen, "_native_stock_entry", side_effect=frappe.PermissionError):
			response = self._act(name, "Ready", key)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "KITCHEN_PRODUCTION_PERMISSION_DENIED")
		self.assertIn(wo, response["errors"][0]["message"])
		self.assertEqual(response["meta"]["operation"], "Manufacture")
		self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", name, "status"), "Preparing")
		self.assertTrue(self._act(name, "Ready", key)["ok"])

	def test_multi_dish_manufacture_is_atomic(self):
		other = self._item("Second")
		name = self._placed([{"item_code": self.item, "qty": 1}, {"item_code": other, "qty": 1}])
		self.assertTrue(self._act(name, "Accept")["ok"])
		self.assertTrue(self._act(name, "Start")["ok"])
		native = kitchen._stock_entry
		calls = []

		def fail_second(*args):
			calls.append(args)
			if len(calls) == 2:
				raise RuntimeError("Second dish failed")
			return native(*args)

		with patch.object(kitchen, "_stock_entry", side_effect=fail_second):
			response = self._act(name, "Ready")
		self.assertFalse(response["ok"], response)
		for row in frappe.get_doc("Kitchen Order Ticket", name).items:
			self.assertEqual(frappe.db.get_value("Work Order", row.work_order, "produced_qty"), 0)
			self.assertFalse(frappe.db.exists("Stock Entry", {"work_order": row.work_order, "docstatus": 1}))

	def test_wip_transfer_occurs_on_start_and_manufacture_on_ready(self):
		warehouse = frappe.copy_doc(frappe.get_doc("Warehouse", self.profile.warehouse))
		warehouse.warehouse_name = f"_Test Kitchen WIP {self.token}"
		warehouse.insert(ignore_permissions=True)
		station = frappe.get_doc("Kitchen Station", self.station)
		station.wip_warehouse = warehouse.name
		station.save()
		name = self._placed()
		wo = frappe.get_doc("Kitchen Order Ticket", name).items[0].work_order
		self.assertTrue(self._act(name, "Accept")["ok"])
		response = self._act(name, "Start")
		self.assertTrue(response["ok"], response)
		self.assertEqual(frappe.db.get_value("Work Order", wo, "produced_qty"), 0)
		self.assertTrue(
			frappe.db.exists(
				"Stock Entry",
				{"work_order": wo, "purpose": "Material Transfer for Manufacture", "docstatus": 1},
			)
		)
		self.assertTrue(self._act(name, "Ready")["ok"])
		self.assertEqual(frappe.db.get_value("Work Order", wo, "produced_qty"), 2)

	def test_cancellation_releases_reservations_and_keeps_ticket_snapshot(self):
		name = self._placed()
		original = frappe.get_doc("Kitchen Order Ticket", name)
		key = str(uuid4())
		response = restaurant.cancel_kitchen_order(name, key, "Sent", "Customer changed their mind")
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["status"], "Cancelled")
		self.assertEqual(frappe.db.get_value("Sales Order", original.sales_order, "docstatus"), 2)
		self.assertEqual(frappe.db.get_value("Work Order", original.items[0].work_order, "docstatus"), 2)
		self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", name, "docstatus"), 1)
		self.assertEqual(frappe.get_doc("Kitchen Order Ticket", name).items[0].qty, 2)
		self.assertTrue(
			restaurant.cancel_kitchen_order(name, key, "Sent", "Customer changed their mind")["ok"]
		)
		self.assertTrue(restaurant.cancel_empty_session(self.session)["ok"])

	def test_cancellation_does_not_silently_reverse_manufactured_stock(self):
		name = self._placed()
		self._advance(name)
		response = restaurant.cancel_kitchen_order(name, str(uuid4()), "Ready", "Customer left")
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "KITCHEN_REVERSAL_REQUIRED")
		self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", name, "status"), "Ready")

	def test_audit_records_and_ticket_contents_cannot_be_edited(self):
		name = self._placed()
		self.assertTrue(self._act(name, "Accept")["ok"])
		audit = frappe.get_doc(
			"Kitchen Ticket Action",
			frappe.db.get_value("Kitchen Ticket Action", {"kitchen_ticket": name}, "name"),
		)
		audit.reason = "Rewrite history"
		with self.assertRaises(frappe.ValidationError):
			audit.save(ignore_permissions=True)
		with self.assertRaises(frappe.ValidationError):
			audit.delete(ignore_permissions=True)
		ticket = frappe.get_doc("Kitchen Order Ticket", name)
		ticket.status = "Ready"
		ticket.flags.ignore_validate_update_after_submit = True
		with self.assertRaises(frappe.ValidationError):
			ticket.save(ignore_permissions=True)

	def test_board_has_station_filters_and_no_financial_fields(self):
		self._placed()
		response = restaurant.get_kitchen_board(self.profile.name, self.station)
		self.assertTrue(response["ok"], response)
		self.assertEqual(len(response["data"]["tickets"]), 1)
		self.assertIn("Accept", response["data"]["tickets"][0]["available_actions"])
		self.assertNotIn("grand_total", response["data"]["tickets"][0])
		self.assertNotIn("rate", response["data"]["tickets"][0]["items"][0])

	def test_summary_uses_preparation_states_not_document_statuses(self):
		for statuses, expected in [
			([], "No preparation"),
			(["Sent", "Ready"], "Preparing"),
			(["Ready", "Served"], "Ready"),
			(["Served", "Cancelled"], "Served"),
			(["Cancelled"], "Cancelled"),
		]:
			self.assertEqual(
				kitchen.preparation_summary([frappe._dict(status=status) for status in statuses]), expected
			)

	def test_board_shares_station_tickets_between_profiles_in_same_restaurant(self):
		name = self._placed()
		profile = frappe.copy_doc(self.profile)
		profile.set("__newname", f"_Test Kitchen Till {self.token}")
		profile.set("applicable_for_users", [])
		profile.insert(ignore_permissions=True)
		user = f"cross-profile-chef-{self.token}@example.com"
		ensure_test_user(user, roles=(KITCHEN_ROLE,), pos_profile=profile.name)
		frappe.set_user(user)
		response = restaurant.get_kitchen_board(profile.name, self.station)
		self.assertTrue(response["ok"], response)
		self.assertIn(name, [row["name"] for row in response["data"]["tickets"]])
		self.assertTrue(restaurant.get_kitchen_ticket(name)["ok"])

	def test_order_cancel_approval_cannot_reuse_an_item_removal_token(self):
		from vunapos.services.pin_service import _issue_token

		name = self._placed()
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_require_manager_pin_order_cancel", 1)
		user = f"cancel-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Waiter",), pos_profile=self.profile.name)
		frappe.set_user(user)
		wrong = _issue_token(self.profile, "manager", "Manager")
		response = restaurant.cancel_kitchen_order(name, str(uuid4()), "Sent", "No longer needed", wrong)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "PIN_TOKEN_INVALID")
		valid = _issue_token(self.profile, "manager_order_cancel", "Manager")
		response = restaurant.cancel_kitchen_order(name, str(uuid4()), "Sent", "No longer needed", valid)
		self.assertTrue(response["ok"], response)
		self.assertFalse(frappe.cache().get_value(f"vunapos:pin-token:{valid}"))
		self.assertEqual(
			frappe.db.get_value(
				"Kitchen Ticket Action", {"kitchen_ticket": name, "action": "Cancel Order"}, "approved_by"
			),
			"Manager",
		)

	def test_cancellation_covers_all_stations_atomically(self):
		group = (
			frappe.get_doc(
				{
					"doctype": "Item Group",
					"item_group_name": f"_Test Bar {self.token}",
					"parent_item_group": self.root,
				}
			)
			.insert()
			.name
		)
		other = self._item("Drink", group)
		self._station("Bar", [group])
		name = self._placed([{"item_code": self.item, "qty": 1}, {"item_code": other, "qty": 1}])
		order = frappe.db.get_value("Kitchen Order Ticket", name, "sales_order")
		key = str(uuid4())
		response = restaurant.cancel_kitchen_order(name, key, "Sent", "Customer left")
		self.assertTrue(response["ok"], response)
		for ticket in self._tickets(order):
			self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", ticket, "status"), "Cancelled")
			self.assertTrue(restaurant.cancel_kitchen_order(ticket, key, "Sent", "Customer left")["ok"])
		self.assertEqual(
			frappe.db.count("Kitchen Ticket Action", {"request_key": key, "outcome": "Succeeded"}), 2
		)

	def test_existing_partial_manufacture_is_not_produced_again(self):
		from erpnext.manufacturing.doctype.work_order.work_order import make_stock_entry

		name = self._placed()
		self.assertTrue(self._act(name, "Accept")["ok"])
		self.assertTrue(self._act(name, "Start")["ok"])
		wo = frappe.get_doc("Kitchen Order Ticket", name).items[0].work_order
		entry = frappe.get_doc(make_stock_entry(wo, "Manufacture", 1))
		entry.insert(ignore_permissions=True)
		entry.submit()
		response = self._act(name, "Ready")
		self.assertTrue(response["ok"], response)
		self.assertEqual(frappe.db.get_value("Work Order", wo, "produced_qty"), 2)
		self.assertEqual(
			frappe.db.count("Stock Entry", {"work_order": wo, "purpose": "Manufacture", "docstatus": 1}), 2
		)

	def test_station_user_permissions_protect_board_actions_and_audit(self):
		name = self._placed()
		hidden = self._station("Hidden", [])
		user = f"station-{self.token}@example.com"
		ensure_test_user(user, roles=(KITCHEN_ROLE,), pos_profile=self.profile.name)
		frappe.get_doc(
			{
				"doctype": "User Permission",
				"user": user,
				"allow": "Kitchen Station",
				"for_value": hidden,
				"apply_to_all_doctypes": 0,
				"applicable_for": "Kitchen Station",
			}
		).insert(ignore_permissions=True)
		frappe.set_user(user)
		board = restaurant.get_kitchen_board(self.profile.name)
		self.assertTrue(board["ok"], board)
		self.assertEqual(board["data"]["tickets"], [])
		self.assertFalse(self._act(name, "Accept")["ok"])
		self.assertFalse(restaurant.get_kitchen_ticket(name)["ok"])

	def test_ready_ticket_can_be_served_after_future_settlement(self):
		name = self._placed()
		self._advance(name)
		order = frappe.db.get_value("Kitchen Order Ticket", name, "sales_order")
		frappe.db.set_value("Sales Order", order, "per_billed", 100)
		frappe.db.set_value("Restaurant Session", self.session, "status", "Settled")
		response = self._act(name, "Serve")
		self.assertTrue(response["ok"], response)
