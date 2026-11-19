from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.services import restaurant_cancellation_service as cancellation
from vunapos.tests import test_kitchen_service as fixtures
from vunapos.tests import test_restaurant_billing as billing


class TestRestaurantItemCancellation(IntegrationTestCase):
	setUp = fixtures.TestKitchenService.setUp
	tearDown = fixtures.TestKitchenService.tearDown
	_item = fixtures.TestKitchenService._item
	_raw_item = fixtures.TestKitchenService._raw_item
	_station = fixtures.TestKitchenService._station
	_send = fixtures.TestKitchenService._send
	_tickets = fixtures.TestKitchenService._tickets
	_preview = billing.TestRestaurantBilling._preview
	_checkout = billing.TestRestaurantBilling._checkout

	def _placed(self, items=None):
		response = self._send(items or [{"item_code": self.item, "qty": 4, "line_id": "meal"}])
		self.assertTrue(response["ok"], response)
		return response["data"]["name"]

	def _action(self, order, action, qty=None):
		ticket = self._tickets(order)[0]
		current = restaurant.get_kitchen_ticket(ticket)["data"]
		response = restaurant.kitchen_action(
			ticket,
			action,
			str(uuid4()),
			current["status"],
			{"meal": qty} if qty else None,
			str(current["modified"]),
		)
		self.assertTrue(response["ok"], response)
		return response["data"]

	def _cancel(self, order, quantities, quote=None, key=None):
		quote = quote or restaurant.preview_item_cancellation(order)["data"]
		return restaurant.cancel_order_items(
			order, quantities, key or str(uuid4()), quote["fingerprint"], "Customer changed their mind"
		)

	def test_cancel_one_unprepared_meal_after_two_are_ready_then_bill_three(self):
		order = self._placed()
		self._action(order, "Accept")
		self._action(order, "Start")
		current = self._action(order, "Ready", 2)
		wo = current["items"][0]["work_order"]
		result = self._cancel(order, {"meal": 1})
		self.assertTrue(result["ok"], result)
		self.assertEqual(result["data"]["items"][0]["qty"], 3)
		self.assertEqual(frappe.db.get_value("Work Order", wo, ["qty", "produced_qty"]), (3, 2))
		current = restaurant.get_kitchen_ticket(self._tickets(order)[0])["data"]
		line = current["items"][0]
		self.assertEqual(
			(line["qty"], line["cancelled_qty"], line["ready_qty"], line["preparing_qty"]), (4, 1, 2, 1)
		)
		material = frappe.get_doc("Work Order", wo).required_items[0]
		self.assertEqual(material.required_qty, 3)
		self.assertEqual(material.stock_reserved_qty, 1)
		self._action(order, "Ready", 1)
		preview = self._preview()
		self.assertEqual(preview["invoice"]["items"][0]["qty"], 3)
		result = self._checkout(preview)
		self.assertTrue(result["ok"], result)
		self.assertEqual(frappe.db.get_value("Sales Order", order, "per_billed"), 100)

	def test_cancel_entire_dish_preserves_other_dish_and_original_ticket(self):
		other = self._item("Other")
		order = self._placed(
			[
				{"item_code": self.item, "qty": 2, "line_id": "meal"},
				{"item_code": other, "qty": 2, "line_id": "other"},
			]
		)
		result = self._cancel(order, {"meal": 2})
		self.assertTrue(result["ok"], result)
		self.assertEqual([row["item_code"] for row in result["data"]["items"]], [other])
		current = self._action(order, "Accept")
		self.assertEqual(len(current["items"]), 2)
		self.assertEqual(current["items"][0]["cancelled_qty"], 2)
		self.assertEqual(current["items"][1]["accepted_qty"], 2)
		self._action(order, "Start")
		self._action(order, "Ready")
		result = self._checkout()
		self.assertTrue(result["ok"], result)
		self.assertEqual(len(result["data"]["invoice"]["items"]), 1)

	def test_cancel_all_items_cancels_round_but_keeps_visit_open(self):
		order = self._placed()
		result = self._cancel(order, {"meal": 4})
		self.assertTrue(result["ok"], result)
		self.assertEqual(frappe.db.get_value("Sales Order", order, "docstatus"), 2)
		self.assertEqual(
			frappe.db.get_value("Kitchen Order Ticket", self._tickets(order)[0], "status"), "Cancelled"
		)
		self.assertEqual(frappe.db.get_value("Restaurant Session", self.session, "status"), "Open")

	def test_ready_or_served_quantities_cannot_be_removed(self):
		order = self._placed()
		for action in ("Accept", "Start", "Ready", "Serve"):
			self._action(order, action)
		result = self._cancel(order, {"meal": 1})
		self.assertFalse(result["ok"], result)
		self.assertEqual(frappe.db.get_value("Sales Order Item", {"parent": order}, "qty"), 4)

	def test_same_request_replays_and_changed_payload_conflicts(self):
		order = self._placed()
		quote = restaurant.preview_item_cancellation(order)["data"]
		key = str(uuid4())
		for _ in range(2):
			result = self._cancel(order, {"meal": 1}, quote, key)
			self.assertTrue(result["ok"], result)
		result = self._cancel(order, {"meal": 2}, quote, key)
		self.assertFalse(result["ok"], result)
		self.assertEqual(result["errors"][0]["code"], "IDEMPOTENCY_CONFLICT")
		self.assertEqual(frappe.db.get_value("Sales Order Item", {"parent": order}, "qty"), 3)

	def test_kitchen_progress_change_requires_another_review(self):
		order = self._placed()
		self._action(order, "Accept")
		self._action(order, "Start")
		quote = restaurant.preview_item_cancellation(order)["data"]
		self._action(order, "Ready", 1)
		result = self._cancel(order, {"meal": 1}, quote)
		self.assertFalse(result["ok"], result)
		self.assertEqual(result["errors"][0]["code"], "CANCELLATION_CHANGED")

	def test_transferred_wip_is_preserved_but_untouched_remainder_can_be_cancelled(self):
		warehouse = frappe.copy_doc(frappe.get_doc("Warehouse", self.profile.warehouse))
		warehouse.warehouse_name = f"_Test Cancel WIP {self.token}"
		warehouse.insert(ignore_permissions=True)
		station = frappe.get_doc("Kitchen Station", self.station)
		station.wip_warehouse = warehouse.name
		station.save()
		order = self._placed()
		self._action(order, "Accept")
		self._action(order, "Start", 3)
		self._action(order, "Ready", 2)
		result = self._cancel(order, {"meal": 1})
		self.assertTrue(result["ok"], result)
		quote = restaurant.preview_item_cancellation(order)
		self.assertTrue(quote["ok"], quote)
		self.assertEqual(quote["data"]["lines"][0]["max_cancel_qty"], 0)
		self.assertFalse(self._cancel(order, {"meal": 1})["ok"])
		self._action(order, "Ready", 1)
		self.assertTrue(self._checkout()["ok"])

	def test_cancellation_invalidates_a_bill_reviewed_before_the_change(self):
		order = self._placed()
		preview = self._preview()
		self.assertTrue(self._cancel(order, {"meal": 1})["ok"])
		result = self._checkout(preview)
		self.assertFalse(result["ok"], result)
		self.assertEqual(result["errors"][0]["code"], "SESSION_BILL_CHANGED")

	def test_cancelled_parent_reduces_addon_quantity_and_releases_its_stock(self):
		addon = self._item("Addon")
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

		make_stock_entry(item_code=addon, to_warehouse=self.profile.warehouse, qty=100, rate=10)
		item = frappe.get_doc("Item", self.item)
		item.append(
			"vunapos_restaurant_addons", {"addon_item": addon, "addon_qty": 2, "enabled": 1, "label": "Extra"}
		)
		item.save()
		from vunapos.services.modifier_service import assigned_groups

		group = assigned_groups(self.item)[0]
		order = self._placed(
			[
				{
					"item_code": self.item,
					"qty": 4,
					"line_id": "meal",
					"modifiers": [{"group": group.name, "option": group.options[0].name}],
				}
			]
		)
		result = self._cancel(order, {"meal": 1})
		self.assertTrue(result["ok"], result)
		rows = frappe.get_doc("Sales Order", order).items
		self.assertEqual([row.qty for row in rows], [3, 6])
		self.assertEqual(rows[1].stock_reserved_qty, 6)
		self.assertFalse(self._cancel(order, {rows[1].vunapos_line_id: 1})["ok"])

	def test_waiter_requires_profile_cancellation_pin_and_can_retry_after_it_is_consumed(self):
		from vunapos.services.pin_service import _issue_token
		from vunapos.tests.helpers import ensure_test_user

		order = self._placed()
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_require_manager_pin_order_cancel", 1)
		frappe.clear_document_cache("POS Profile", self.profile.name)
		user = f"cancel-waiter-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Waiter",), pos_profile=self.profile.name)
		frappe.set_user(user)
		quote = restaurant.preview_item_cancellation(order)["data"]
		key = str(uuid4())
		result = self._cancel(order, {"meal": 1}, quote, key)
		self.assertFalse(result["ok"], result)
		self.assertEqual(result["errors"][0]["code"], "PIN_TOKEN_REQUIRED")
		token = _issue_token(self.profile, "manager_order_cancel", "Restaurant Supervisor")
		result = restaurant.cancel_order_items(
			order, {"meal": 1}, key, quote["fingerprint"], "Customer changed their mind", token
		)
		self.assertTrue(result["ok"], result)
		self.assertTrue(self._cancel(order, {"meal": 1}, quote, key)["ok"])

	def test_kitchen_role_cannot_cancel_quantities(self):
		from vunapos.tests.helpers import ensure_test_user

		order = self._placed()
		user = f"cancel-chef-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Kitchen User",), pos_profile=self.profile.name)
		frappe.set_user(user)
		result = restaurant.preview_item_cancellation(order)
		self.assertFalse(result["ok"], result)
		self.assertEqual(result["errors"][0]["code"], "PermissionError")

	def test_failure_rolls_back_work_order_reservations_and_receipt(self):
		order = self._placed()
		with patch.object(
			cancellation, "_trim_reservations", side_effect=frappe.ValidationError("Reservation failed")
		):
			result = self._cancel(order, {"meal": 1})
		self.assertFalse(result["ok"], result)
		self.assertEqual(frappe.db.get_value("Work Order", {"sales_order": order}, "qty"), 4)
		self.assertEqual(frappe.db.get_value("Sales Order Item", {"parent": order}, "qty"), 4)

		self.assertFalse(
			frappe.db.exists("Restaurant Request", {"action": "Cancel Items", "reference_name": order})
		)

	def test_legacy_unselected_dish_keeps_its_preparation_progress(self):
		other = self._item("Legacy Other")
		order = self._placed(
			[
				{"item_code": self.item, "qty": 4, "line_id": "meal"},
				{"item_code": other, "qty": 2, "line_id": "other"},
			]
		)
		ticket = self._tickets(order)[0]
		frappe.db.set_value("Kitchen Order Ticket", ticket, "status", "Preparing")
		result = self._cancel(order, {"meal": 1})
		self.assertTrue(result["ok"], result)
		rows = {row["line_id"]: row for row in restaurant.get_kitchen_ticket(ticket)["data"]["items"]}
		self.assertEqual(rows["other"]["started_qty"], 2)
		self.assertEqual(rows["meal"]["started_qty"], 3)

	def test_maximum_length_retry_key_and_audit_history_are_preserved(self):
		order = self._placed()
		key = "q" * 140
		quote = restaurant.preview_item_cancellation(order)["data"]
		result = self._cancel(order, {"meal": 1}, quote, key)
		self.assertTrue(result["ok"], result)
		self.assertEqual(result["data"]["cancellations"][0]["items"][0]["qty"], 1)
		self.assertEqual(result["data"]["cancellations"][0]["reason"], "Customer changed their mind")
		self.assertTrue(self._cancel(order, {"meal": 1}, quote, key)["ok"])

	def test_advance_payment_requires_review_before_quantities_change(self):
		order = self._placed()
		frappe.db.set_value("Sales Order", order, "advance_paid", 10)
		result = restaurant.preview_item_cancellation(order)
		self.assertFalse(result["ok"], result)
		self.assertEqual(result["errors"][0]["code"], "ORDER_NOT_EDITABLE")
		self.assertFalse(
			frappe.db.exists("Restaurant Request", {"action": "Cancel Items", "reference_name": order})
		)

	def _direct_group(self):
		return (
			frappe.get_doc(
				{
					"doctype": "Item Group",
					"item_group_name": f"Cancel Direct {self.token}",
					"parent_item_group": self.root,
					"is_group": 0,
				}
			)
			.insert()
			.name
		)

	def test_direct_sale_without_kitchen_ticket_releases_stock_and_bills_remaining_quantity(self):
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

		code = self._item("Direct", self._direct_group())
		make_stock_entry(item_code=code, to_warehouse=self.profile.warehouse, qty=10, rate=10)
		order = self._placed([{"item_code": code, "qty": 4, "line_id": "direct"}])
		self.assertEqual(self._tickets(order), [])
		result = self._cancel(order, {"direct": 1})
		self.assertTrue(result["ok"], result)
		self.assertEqual(frappe.db.get_value("Sales Order Item", {"parent": order}, "stock_reserved_qty"), 3)
		result = self._checkout()
		self.assertTrue(result["ok"], result)
		self.assertEqual(result["data"]["invoice"]["items"][0]["qty"], 3)

	def test_batch_direct_sale_keeps_exact_remaining_reservations(self):
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry
		from frappe.utils import add_days, nowdate

		from vunapos.tests.helpers import ensure_test_batch_item

		code = ensure_test_batch_item(f"_Test Cancellation Batch {self.token}")
		item = frappe.get_doc("Item", code)
		item.item_group = self._direct_group()
		item.save()
		frappe.db.set_single_value("Stock Settings", "auto_reserve_serial_and_batch", 1)
		for label, days in (("A", 30), ("B", 60)):
			batch = frappe.get_doc(
				{
					"doctype": "Batch",
					"batch_id": f"CANCEL-{label}-{self.token}",
					"item": code,
					"expiry_date": add_days(nowdate(), days),
				}
			).insert(ignore_permissions=True)
			make_stock_entry(
				item_code=code,
				qty=3,
				to_warehouse=self.profile.warehouse,
				rate=100,
				batch_no=batch.name,
				use_serial_batch_fields=1,
			)
		order = self._placed([{"item_code": code, "qty": 5, "line_id": "direct"}])
		result = self._cancel(order, {"direct": 1})
		self.assertTrue(result["ok"], result)
		sre = frappe.get_doc(
			"Stock Reservation Entry",
			frappe.db.get_value(
				"Stock Reservation Entry",
				{"voucher_type": "Sales Order", "voucher_no": order, "docstatus": 1},
				"name",
			),
		)
		self.assertEqual(sre.reserved_qty, 4)
		self.assertEqual(sum(row.qty for row in sre.sb_entries), 4)
		self.assertEqual(sre.sb_entries[0].qty, 3)
		result = self._checkout()
		self.assertTrue(result["ok"], result)
		self.assertEqual(result["data"]["invoice"]["items"][0]["qty"], 4)

	def test_cancellation_uses_selling_uom_and_retains_the_agreed_rate(self):
		item = frappe.get_doc("Item", self.item)
		if not frappe.db.exists("UOM", "Box"):
			frappe.get_doc({"doctype": "UOM", "uom_name": "Box"}).insert()
		item.append("uoms", {"uom": "Box", "conversion_factor": 6})
		item.sales_uom = "Box"
		item.save()
		order = self._placed([{"item_code": self.item, "qty": 3, "uom": "Box", "line_id": "meal"}])
		rate = frappe.db.get_value("Sales Order Item", {"parent": order}, "rate")
		self._action(order, "Accept")
		self._action(order, "Start")
		self._action(order, "Ready", 1)
		result = self._cancel(order, {"meal": 1})
		self.assertTrue(result["ok"], result)
		self.assertEqual(result["data"]["items"][0]["rate"], rate)
		self.assertEqual(
			frappe.db.get_value("Work Order", {"sales_order": order}, ["qty", "produced_qty"]), (12, 6)
		)
		self._action(order, "Ready", 1)
		result = self._checkout()
		self.assertTrue(result["ok"], result)
		self.assertEqual(result["data"]["invoice"]["items"][0]["qty"], 2)
