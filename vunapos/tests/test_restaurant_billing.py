from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.tests import test_kitchen_service as fixtures
from vunapos.tests.helpers import ensure_test_user, set_invoice_mode


class TestRestaurantBilling(IntegrationTestCase):
	tearDown = fixtures.TestKitchenService.tearDown
	_item = fixtures.TestKitchenService._item
	_raw_item = fixtures.TestKitchenService._raw_item
	_station = fixtures.TestKitchenService._station
	_send = fixtures.TestKitchenService._send
	_tickets = fixtures.TestKitchenService._tickets

	def setUp(self):
		fixtures.TestKitchenService.setUp(self)
		set_invoice_mode("Sales Invoice")
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_complete_preparation_on_billing", 0)
		frappe.clear_document_cache("POS Profile", self.profile.name)

	def _ready(self, qty=2):
		placed = self._send(items=[{"item_code": self.item, "qty": qty, "line_id": str(uuid4())}])
		self.assertTrue(placed["ok"], placed)
		for ticket in self._tickets(placed["data"]["name"]):
			for action, expected in (("Accept", "Sent"), ("Start", "Accepted"), ("Ready", "Preparing")):
				result = restaurant.kitchen_action(ticket, action, str(uuid4()), expected)
				self.assertTrue(result["ok"], result)
		return placed["data"]["name"]

	def _preview(self, profile=None):
		response = restaurant.preview_session_bill(self.session, profile or self.profile.name)
		self.assertTrue(response["ok"], response)
		return response["data"]

	def _checkout(self, preview=None, profile=None, payments=None):
		preview = preview or self._preview(profile)
		total = preview["invoice"]["totals"]["rounded_total"] or preview["invoice"]["totals"]["grand_total"]
		return restaurant.checkout_session(
			self.session,
			profile or self.profile.name,
			preview["fingerprint"],
			payments
			if payments is not None
			else [{"mode_of_payment": self.profile.payments[0].mode_of_payment, "amount": total}],
		)

	def test_one_bill_combines_rounds_consumes_own_reservations_and_settles(self):
		orders = [self._ready(2), self._ready(1)]
		preview = self._preview()
		self.assertEqual(len(preview["invoice"]["items"]), 2)
		self.assertEqual(preview["account_reference"], sorted(orders)[0])
		self.assertEqual(frappe.db.get_value("Restaurant Session", self.session, "status"), "Open")
		response = self._checkout(preview)
		self.assertTrue(response["ok"], response)
		invoice = response["data"]["invoice"]
		self.assertEqual(invoice["docstatus"], 1)
		self.assertEqual(response["data"]["session"]["status"], "Settled")
		doc = frappe.get_doc(invoice["doctype"], invoice["name"])
		self.assertEqual(
			(doc.vunapos_restaurant, doc.vunapos_branch),
			(self.profile.vunapos_restaurant, self.profile.vunapos_branch),
		)
		self.assertEqual(
			(invoice["restaurant"], invoice["branch"]), (doc.vunapos_restaurant, doc.vunapos_branch)
		)
		self.assertEqual({row.sales_order for row in doc.items}, set(orders))
		self.assertEqual(len({row.so_detail for row in doc.items}), 2)
		self.assertEqual(
			frappe.db.get_value(
				"Bin", {"item_code": self.item, "warehouse": self.profile.warehouse}, "actual_qty"
			),
			0,
		)
		for order in orders:
			self.assertEqual(frappe.db.get_value("Sales Order", order, "per_billed"), 100)
		self.assertEqual(
			frappe.db.count(
				"Stock Reservation Entry", {"voucher_type": "Sales Invoice", "voucher_no": doc.name}
			),
			0,
		)

	def test_retry_after_unknown_checkout_result_returns_the_same_bill(self):
		self._ready()
		preview = self._preview()
		first = self._checkout(preview)
		self.assertTrue(first["ok"], first)
		second = self._checkout(preview)
		self.assertTrue(second["ok"], second)
		self.assertEqual(first["data"]["invoice"]["name"], second["data"]["invoice"]["name"])
		self.assertEqual(frappe.db.count("Sales Invoice", {"vunapos_restaurant_session": self.session}), 1)

	def test_changed_round_set_requires_a_new_bill_review(self):
		self._ready()
		preview = self._preview()
		self._ready(1)
		response = self._checkout(preview)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "SESSION_BILL_CHANGED")
		self.assertFalse(frappe.db.exists("Sales Invoice", {"vunapos_restaurant_session": self.session}))

	def test_failed_payment_rolls_back_invoice_and_keeps_visit_open(self):
		self._ready()
		response = self._checkout(payments=[])
		self.assertFalse(response["ok"], response)
		self.assertEqual(frappe.db.get_value("Restaurant Session", self.session, "status"), "Open")
		self.assertFalse(frappe.db.exists("Sales Invoice", {"vunapos_restaurant_session": self.session}))

	def test_tax_total_changes_require_another_review_even_when_rounds_are_unchanged(self):
		from vunapos.services import restaurant_billing_service as billing

		self._ready()
		preview = self._preview()
		build = billing._build

		def changed_tax(*args, **kwargs):
			doc = build(*args, **kwargs)
			doc.grand_total += 10
			doc.rounded_total = doc.grand_total
			return doc

		with patch.object(billing, "_build", side_effect=changed_tax):
			response = self._checkout(preview)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "SESSION_BILL_CHANGED")

	def test_unproduced_order_cannot_consume_someone_elses_finished_stock(self):
		self.assertTrue(self._send()["ok"])
		response = self._checkout()
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "SESSION_FINISHED_STOCK_REQUIRED")

	def test_placed_prices_survive_item_price_changes_without_rate_edit_permission(self):
		self._ready()
		before = self._preview()
		frappe.db.set_value("POS Profile", self.profile.name, "allow_rate_change", 0)
		frappe.db.set_value("Item", self.item, "standard_rate", 777)
		frappe.clear_document_cache("Item", self.item)
		after = self._preview()
		self.assertEqual(before["invoice"]["items"][0]["rate"], after["invoice"]["items"][0]["rate"])
		self.assertTrue(self._checkout(after)["ok"])

	def test_desk_production_must_still_be_marked_ready_before_billing(self):
		self._ready()
		frappe.db.set_value("Kitchen Order Ticket", self._tickets()[0], "status", "Preparing")
		preview = self._preview()
		self.assertFalse(preview["can_checkout"])
		response = self._checkout(preview)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "SESSION_FINISHED_STOCK_REQUIRED")

	def test_waiter_can_preview_but_cannot_settle(self):
		self._ready()
		user = f"bill-waiter-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Waiter",), pos_profile=self.profile.name)
		frappe.set_user(user)
		self._preview()
		response = self._checkout()
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "PermissionError")

	def test_workflow_draft_holds_visit_until_native_submission(self):
		self._ready()
		with patch("vunapos.services.workflow_service.workflow_enabled_for", return_value=True):
			response = self._checkout()
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["invoice"]["docstatus"], 0)
		self.assertEqual(response["data"]["session"]["status"], "Settling")
		self.assertFalse(self._send()["ok"])
		doc = frappe.get_doc("Sales Invoice", response["data"]["invoice"]["name"])
		doc.submit()
		self.assertEqual(frappe.db.get_value("Restaurant Session", self.session, "status"), "Settled")

	def test_workflow_bill_rows_cannot_be_edited_after_review(self):
		self._ready()
		with patch("vunapos.services.workflow_service.workflow_enabled_for", return_value=True):
			response = self._checkout()
		self.assertTrue(response["ok"], response)
		doc = frappe.get_doc("Sales Invoice", response["data"]["invoice"]["name"])
		doc.items[0].qty += 1
		with self.assertRaises(frappe.ValidationError):
			doc.save()

	def test_pos_invoice_uses_the_same_visit_and_source_links(self):
		self._ready()
		set_invoice_mode("POS Invoice")
		response = self._checkout()
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["invoice"]["doctype"], "POS Invoice")
		invoice = response["data"]["invoice"]
		doc = frappe.get_doc("POS Invoice", invoice["name"])
		self.assertEqual(
			(doc.vunapos_restaurant, doc.vunapos_branch),
			(self.profile.vunapos_restaurant, self.profile.vunapos_branch),
		)
		self.assertEqual(response["data"]["session"]["status"], "Settled")

	def _enable_billing_preparation(self):
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_complete_preparation_on_billing", 1)
		frappe.clear_document_cache("POS Profile", self.profile.name)

	def test_cashier_can_complete_preparation_only_through_opted_in_billing(self):
		from vunapos.services.pos_entry import create_pos_opening_entry

		placed = self._send()
		self.assertTrue(placed["ok"], placed)
		ticket = self._tickets()[0]
		self._enable_billing_preparation()
		user = f"fast-bill-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Cashier",), pos_profile=self.profile.name)
		frappe.set_user(user)
		create_pos_opening_entry(
			self.profile.name,
			[{"mode_of_payment": row.mode_of_payment, "opening_amount": 0} for row in self.profile.payments],
			user,
		)
		self.assertFalse(frappe.has_permission("Stock Entry", "create"))
		self.assertFalse(restaurant.kitchen_action(ticket, "Accept", str(uuid4()), "Sent")["ok"])
		preview = self._preview()
		self.assertTrue(preview["can_checkout"])
		self.assertTrue(preview["will_complete_preparation"])
		self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", ticket, "status"), "Sent")
		result = self._checkout(preview)
		self.assertTrue(result["ok"], result)
		self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", ticket, "status"), "Ready")
		actions = frappe.get_all(
			"Kitchen Ticket Action",
			filters={"kitchen_ticket": ticket, "outcome": "Succeeded"},
			fields=["action", "actor", "reason"],
		)
		self.assertEqual({row.action for row in actions}, {"Accept", "Start", "Ready"})
		self.assertTrue(all(row.actor == user and self.profile.name in row.reason for row in actions))
		self.assertTrue(self._checkout(preview)["ok"])
		self.assertEqual(
			frappe.db.count("Kitchen Ticket Action", {"kitchen_ticket": ticket, "outcome": "Succeeded"}), 3
		)
		self.assertEqual(
			frappe.db.count(
				"Stock Entry",
				{
					"purpose": "Manufacture",
					"docstatus": 1,
					"work_order": frappe.db.get_value(
						"Kitchen Order Ticket Item", {"parent": ticket}, "work_order"
					),
				},
			),
			1,
		)

	def test_failed_payment_rolls_back_automatic_manufacture_and_kitchen_progress(self):
		self.assertTrue(self._send()["ok"])
		self._enable_billing_preparation()
		response = self._checkout(payments=[])
		self.assertFalse(response["ok"], response)
		ticket = self._tickets()[0]
		wo = frappe.db.get_value("Kitchen Order Ticket Item", {"parent": ticket}, "work_order")
		self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", ticket, "status"), "Sent")
		self.assertEqual(frappe.db.get_value("Work Order", wo, "produced_qty"), 0)
		self.assertFalse(frappe.db.exists("Stock Entry", {"work_order": wo, "docstatus": 1}))
		self.assertFalse(
			frappe.db.exists("Kitchen Ticket Action", {"kitchen_ticket": ticket, "outcome": "Succeeded"})
		)
		self.assertTrue(self._checkout()["ok"])

	def test_billing_only_manufactures_remaining_quantity(self):
		from vunapos.services.kitchen_lifecycle_service import _stock_entry

		self.assertTrue(self._send()["ok"])
		ticket = self._tickets()[0]
		for action, status in (("Accept", "Sent"), ("Start", "Accepted")):
			self.assertTrue(restaurant.kitchen_action(ticket, action, str(uuid4()), status)["ok"])
		wo = frappe.get_doc(
			"Work Order", frappe.db.get_value("Kitchen Order Ticket Item", {"parent": ticket}, "work_order")
		)
		_stock_entry(wo, "Manufacture", 1)
		self._enable_billing_preparation()
		self.assertTrue(self._checkout()["ok"])
		entries = frappe.get_all(
			"Stock Entry",
			filters={"work_order": wo.name, "purpose": "Manufacture", "docstatus": 1},
			pluck="fg_completed_qty",
		)
		self.assertEqual(len(entries), 2)
		self.assertEqual(sum(entries), 2)

	def test_setting_is_taken_from_the_billing_profile_not_the_order_profile(self):
		self.assertTrue(self._send()["ok"])
		self._enable_billing_preparation()
		profile = frappe.copy_doc(frappe.get_doc("POS Profile", self.profile.name))
		profile.set("__newname", f"_Test Manual Kitchen Billing {self.token}")
		profile.vunapos_complete_preparation_on_billing = 0
		profile.insert(ignore_permissions=True)
		preview = self._preview(profile.name)
		self.assertFalse(preview["can_checkout"])
		self.assertFalse(preview["will_complete_preparation"])

	def test_automatic_preparation_does_not_bypass_station_permissions(self):
		from vunapos.services.pos_entry import create_pos_opening_entry

		self.assertTrue(self._send()["ok"])
		self._enable_billing_preparation()
		other = self._station("Other permitted station", [])
		user = f"restricted-billing-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Cashier",), pos_profile=self.profile.name)
		frappe.get_doc(
			{
				"doctype": "User Permission",
				"user": user,
				"allow": "Kitchen Station",
				"for_value": other,
				"apply_to_all_doctypes": 0,
				"applicable_for": "Kitchen Station",
			}
		).insert(ignore_permissions=True)
		frappe.set_user(user)
		create_pos_opening_entry(
			self.profile.name,
			[{"mode_of_payment": row.mode_of_payment, "opening_amount": 0} for row in self.profile.payments],
			user,
		)
		preview = self._preview()
		self.assertFalse(preview["can_checkout"])
		response = self._checkout(preview)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "PermissionError")
		frappe.set_user("Administrator")
		self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", self._tickets()[0], "status"), "Sent")

	def test_native_production_failure_rolls_back_billing_and_preserves_retry(self):
		from vunapos.services import kitchen_lifecycle_service as kitchen

		self.assertTrue(self._send()["ok"])
		self._enable_billing_preparation()
		preview = self._preview()
		with patch.object(
			kitchen,
			"_native_stock_entry",
			side_effect=frappe.ValidationError("Complete the inspection first"),
		):
			response = self._checkout(preview)
		self.assertFalse(response["ok"], response)
		self.assertIn("inspection", response["errors"][0]["message"])
		self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", self._tickets()[0], "status"), "Sent")
		self.assertFalse(frappe.db.exists("Sales Invoice", {"vunapos_restaurant_session": self.session}))
		self.assertTrue(self._checkout(preview)["ok"])

	def test_pos_invoice_can_complete_preparation_during_billing(self):
		self.assertTrue(self._send()["ok"])
		self._enable_billing_preparation()
		set_invoice_mode("POS Invoice")
		response = self._checkout()
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["invoice"]["doctype"], "POS Invoice")
		self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", self._tickets()[0], "status"), "Ready")

	def test_billing_completes_wip_transfer_then_manufacture(self):
		warehouse = frappe.copy_doc(frappe.get_doc("Warehouse", self.profile.warehouse))
		warehouse.warehouse_name = f"Billing WIP {self.token}"
		warehouse.insert(ignore_permissions=True)
		station = frappe.get_doc("Kitchen Station", self.station)
		station.wip_warehouse = warehouse.name
		station.save()
		self.assertTrue(self._send()["ok"])
		self._enable_billing_preparation()
		response = self._checkout()
		self.assertTrue(response["ok"], response)
		wo = frappe.db.get_value("Kitchen Order Ticket Item", {"parent": self._tickets()[0]}, "work_order")
		purposes = frappe.get_all("Stock Entry", filters={"work_order": wo, "docstatus": 1}, pluck="purpose")
		self.assertEqual(set(purposes), {"Material Transfer for Manufacture", "Manufacture"})

	def test_cancelled_round_is_not_billed(self):
		self._ready(1)
		placed = self._send()
		self.assertTrue(placed["ok"], placed)
		ticket = self._tickets(placed["data"]["name"])[0]
		cancelled = restaurant.cancel_kitchen_order(ticket, str(uuid4()), "Sent", "Customer cancelled")
		self.assertTrue(cancelled["ok"], cancelled)
		preview = self._preview()
		self.assertEqual(len(preview["invoice"]["items"]), 1)
		self.assertTrue(self._checkout(preview)["ok"])

	def test_table_is_released_only_after_submission_not_on_preview(self):
		from vunapos.services.service_type_service import get_profile_service_types

		floor = frappe.get_doc(
			{
				"doctype": "Restaurant Floor",
				"restaurant": self.profile.vunapos_restaurant,
				"floor_name": f"Billing {self.token}",
				"branch": self.profile.vunapos_branch,
			}
		).insert()
		table = frappe.get_doc(
			{
				"doctype": "Restaurant Table",
				"floor": floor.name,
				"table_label": "1",
				"seats": 4,
				"width": 80,
				"height": 80,
				"is_active": 1,
			}
		).insert()
		session = frappe.get_doc("Restaurant Session", self.session)
		session.service_type = next(
			row["name"] for row in get_profile_service_types(self.profile) if row["requires_table"]
		)
		session.append(
			"tables",
			{"table": table.name, "assigned_at": frappe.utils.now_datetime(), "assigned_by": "Administrator"},
		)
		session.flags.restaurant_session_write = True
		session.save()
		self._ready()
		preview = self._preview()
		self.assertFalse(preview["session"]["tables"][0]["released_at"])
		with patch("vunapos.services.workflow_service.workflow_enabled_for", return_value=True):
			response = self._checkout(preview)
		self.assertTrue(response["ok"], response)
		self.assertFalse(response["data"]["session"]["tables"][0]["released_at"])
		frappe.get_doc("Sales Invoice", response["data"]["invoice"]["name"]).submit()
		self.assertTrue(restaurant.get_session(self.session)["data"]["tables"][0]["released_at"])

	def test_another_cashier_till_bills_source_prices_and_warehouse(self):
		from vunapos.services.pos_entry import create_pos_opening_entry

		self._ready()
		price_list = frappe.get_doc(
			{
				"doctype": "Price List",
				"price_list_name": f"Billing {self.token}",
				"enabled": 1,
				"selling": 1,
				"currency": self.profile.currency,
			}
		).insert()
		profile = frappe.copy_doc(self.profile)
		profile.set("__newname", f"_Test Billing Till {self.token}")
		profile.selling_price_list = price_list.name
		profile.allow_rate_change = 0
		profile.set("applicable_for_users", [])
		profile.insert(ignore_permissions=True)
		user = f"bill-cashier-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Cashier",), pos_profile=profile.name)
		frappe.set_user(user)
		create_pos_opening_entry(
			profile.name,
			[{"mode_of_payment": row.mode_of_payment, "opening_amount": 0} for row in profile.payments],
			user,
		)
		response = self._checkout(profile=profile.name)
		self.assertTrue(response["ok"], response)
		doc = frappe.get_doc("Sales Invoice", response["data"]["invoice"]["name"])
		self.assertEqual(doc.owner, user)
		self.assertEqual(doc.pos_profile, profile.name)
		self.assertEqual(doc.selling_price_list, self.profile.selling_price_list)
		self.assertEqual(doc.items[0].warehouse, self.profile.warehouse)

	def test_multi_batch_direct_sale_uses_its_exact_native_reservations(self):
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

		from vunapos.tests.helpers import ensure_test_batch_item

		frappe.db.set_single_value("Stock Settings", "auto_reserve_serial_and_batch", 1)
		item = ensure_test_batch_item(f"_Test Bill Batch {self.token}")
		group = frappe.get_doc(
			{
				"doctype": "Item Group",
				"item_group_name": f"Direct {self.token}",
				"parent_item_group": self.root,
			}
		).insert()
		frappe.db.set_value("Item", item, "item_group", group.name)
		frappe.clear_document_cache("Item", item)
		for label, qty in (("A", 3), ("B", 4)):
			batch = frappe.get_doc(
				{
					"doctype": "Batch",
					"batch_id": f"BILL-{label}-{self.token}",
					"item": item,
					"expiry_date": frappe.utils.add_days(frappe.utils.nowdate(), 60),
				}
			).insert(ignore_permissions=True)
			make_stock_entry(
				item_code=item,
				qty=qty,
				to_warehouse=self.profile.warehouse,
				rate=100,
				batch_no=batch.name,
				use_serial_batch_fields=1,
			)
		placed = self._send(items=[{"item_code": item, "qty": 5}])
		self.assertTrue(placed["ok"], placed)
		response = self._checkout()
		self.assertTrue(response["ok"], response)
		doc = frappe.get_doc("Sales Invoice", response["data"]["invoice"]["name"])
		bundle = frappe.get_doc("Serial and Batch Bundle", doc.items[0].serial_and_batch_bundle)
		self.assertEqual(sum(abs(row.qty) for row in bundle.entries), 5)
		self.assertEqual(
			{row.batch_no for row in bundle.entries}, {f"BILL-A-{self.token}", f"BILL-B-{self.token}"}
		)
