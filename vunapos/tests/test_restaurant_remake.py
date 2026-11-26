from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.tests import test_restaurant_billing as fixtures
from vunapos.tests.helpers import ensure_test_user


class TestRestaurantRemake(IntegrationTestCase):
	setUp = fixtures.TestRestaurantBilling.setUp
	tearDown = fixtures.TestRestaurantBilling.tearDown
	_item = fixtures.TestRestaurantBilling._item
	_raw_item = fixtures.TestRestaurantBilling._raw_item
	_station = fixtures.TestRestaurantBilling._station
	_send = fixtures.TestRestaurantBilling._send
	_tickets = fixtures.TestRestaurantBilling._tickets
	_ready = fixtures.TestRestaurantBilling._ready
	_preview = fixtures.TestRestaurantBilling._preview
	_checkout = fixtures.TestRestaurantBilling._checkout

	def _source(self, qty=2, served=False, billed=False):
		self.order = self._ready(qty)
		self.ticket = self._tickets(self.order)[0]
		if served:
			self.assertTrue(restaurant.kitchen_action(self.ticket, "Serve", str(uuid4()), "Ready")["ok"])
		if billed:
			self.assertTrue(self._checkout()["ok"])
		return self.ticket

	def _request(self, qty=1, disposition="Discard", quote=None, key=None, ticket=None):
		ticket = ticket or self.ticket
		quote = quote or restaurant.preview_remake(ticket)
		self.assertTrue(quote["ok"], quote)
		return restaurant.request_remake(
			ticket,
			{quote["data"]["lines"][0]["line_id"]: qty},
			key or str(uuid4()),
			quote["data"]["fingerprint"],
			"Burnt meal",
			disposition,
		)

	def _replacement(self, response):
		self.assertTrue(response["ok"], response)
		event = next(row for row in response["data"]["actions"] if row["action"] == "Request Remake")
		return event["item_quantities"]["replacement_ticket"]

	def _finish(self, ticket):
		for action in ("Accept", "Start", "Ready", "Serve"):
			doc = restaurant.get_kitchen_ticket(ticket)["data"]
			response = restaurant.kitchen_action(ticket, action, str(uuid4()), doc["status"])
			self.assertTrue(response["ok"], response)
		return response

	def _qty(self, code):
		return frappe.db.get_value(
			"Bin", {"item_code": code, "warehouse": self.profile.warehouse}, "actual_qty"
		)

	def test_unbilled_remake_is_extra_production_not_an_extra_sale(self):
		self._source()
		before = self._preview()["invoice"]["totals"]["grand_total"]
		replacement = self._replacement(self._request())
		self.assertFalse(self._preview()["can_checkout"])
		doc = frappe.get_doc("Kitchen Order Ticket", replacement)
		wo = frappe.get_doc("Work Order", doc.items[0].work_order)
		self.assertFalse(wo.sales_order)
		self.assertEqual(wo.qty, 1)
		self.assertEqual(wo.required_items[0].stock_reserved_qty, 1)
		self._finish(replacement)
		self.assertEqual(self._qty(self.item), 2)
		self.assertEqual(self._qty(self.ingredient), 997)
		bill = self._checkout()
		self.assertTrue(bill["ok"], bill)
		self.assertEqual(bill["data"]["invoice"]["totals"]["grand_total"], before)
		self.assertEqual(bill["data"]["invoice"]["items"][0]["qty"], 2)
		self.assertEqual(self._qty(self.item), 0)
		self.assertEqual(frappe.db.count("Sales Order", {"vunapos_restaurant_session": self.session}), 1)
		self.assertEqual(frappe.get_doc("Kitchen Order Ticket", self.ticket).items[0].qty, 2)

	def test_original_is_removed_from_service_queue_without_claiming_it_was_served(self):
		self._source()
		response = self._request(qty=2)
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["status"], "Completed")
		line = response["data"]["items"][0]
		self.assertEqual((line["served_qty"], line["retired_qty"], line["ready_to_serve_qty"]), (0, 2, 0))
		self.assertNotIn("Serve", response["data"]["available_actions"])

	def test_after_billing_keep_for_guest_does_not_return_stock_or_rebill(self):
		self._source(served=True, billed=True)
		before = frappe.db.count("Sales Invoice", {"vunapos_restaurant_session": self.session})
		replacement = self._replacement(self._request(disposition="Keep for guest"))
		self._finish(replacement)
		self.assertEqual(self._qty(self.item), 0)
		self.assertEqual(self._qty(self.ingredient), 997)
		self.assertEqual(
			frappe.db.count("Sales Invoice", {"vunapos_restaurant_session": self.session}), before
		)

	def test_identical_retry_returns_original_replacement_and_conflict_is_rejected(self):
		self._source()
		quote = restaurant.preview_remake(self.ticket)
		key = str(uuid4())
		first = self._request(quote=quote, key=key)
		second = self._request(quote=quote, key=key)
		self.assertEqual(self._replacement(first), self._replacement(second))
		conflict = self._request(qty=2, quote=quote, key=key)
		self.assertEqual(conflict["errors"][0]["code"], "IDEMPOTENCY_CONFLICT")
		stale = self._request(quote=quote)
		self.assertEqual(stale["errors"][0]["code"], "REMAKE_REVIEW_CHANGED")

	def test_remake_announces_one_new_ticket_after_commit_and_not_on_retry(self):
		self._source()
		quote = restaurant.preview_remake(self.ticket)
		key = str(uuid4())
		with patch("frappe.publish_realtime") as publish:
			first = self._request(quote=quote, key=key)
			second = self._request(quote=quote, key=key)
		name = self._replacement(first)
		self.assertEqual(self._replacement(second), name)
		calls = [call for call in publish.call_args_list if call.args[0] == "vunapos_kitchen_ticket_created"]
		self.assertEqual(len(calls), 1)
		self.assertEqual(calls[0].args[1]["name"], name)
		self.assertEqual(calls[0].kwargs["doctype"], "Kitchen Station")
		self.assertEqual(calls[0].kwargs["docname"], self.station)
		self.assertTrue(calls[0].kwargs["after_commit"])

	def test_replacement_can_itself_be_remade_with_auditable_lineage(self):
		self._source(qty=1)
		first = self._replacement(self._request())
		self._finish(first)
		second = self._replacement(self._request(ticket=first))
		self._finish(second)
		self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", second, "remake_of"), first)
		self.assertEqual(self._qty(self.item), 1)
		self.assertEqual(self._qty(self.ingredient), 997)

	def test_failure_issuing_output_rolls_back_manufacture_and_preserves_retry(self):
		self._source()
		replacement = self._replacement(self._request())
		for action, status in (("Accept", "Sent"), ("Start", "Accepted")):
			self.assertTrue(restaurant.kitchen_action(replacement, action, str(uuid4()), status)["ok"])
		key = str(uuid4())
		with patch(
			"vunapos.services.restaurant_remake_service.issue_replacement_output",
			side_effect=frappe.ValidationError("Issue denied"),
		):
			response = restaurant.kitchen_action(replacement, "Ready", key, "Preparing")
		self.assertFalse(response["ok"], response)
		wo = frappe.db.get_value("Kitchen Order Ticket Item", {"parent": replacement}, "work_order")
		self.assertEqual(frappe.db.get_value("Work Order", wo, "produced_qty"), 0)
		response = restaurant.kitchen_action(replacement, "Ready", key, "Preparing")
		self.assertTrue(response["ok"], response)
		self.assertEqual(
			frappe.db.count("Stock Entry", {"vunapos_remake_ticket": replacement, "docstatus": 1}), 1
		)

	def test_waiter_cannot_approve_a_remake(self):
		self._source()
		user = f"remake-waiter-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Waiter",), pos_profile=self.profile.name)
		frappe.set_user(user)
		response = restaurant.preview_remake(self.ticket)
		self.assertEqual(response["errors"][0]["code"], "PermissionError")

	def test_unprepared_quantities_and_invalid_disposition_are_rejected(self):
		placed = self._send()
		self.assertTrue(placed["ok"])
		self.ticket = self._tickets()[0]
		response = self._request()
		self.assertEqual(response["errors"][0]["code"], "KITCHEN_QUANTITY_EXCEEDED")
		response = self._request(disposition="Return to stock")
		self.assertEqual(response["errors"][0]["code"], "REMAKE_DISPOSITION_REQUIRED")

	def test_stock_addons_are_reserved_and_consumed_in_the_extra_recipe(self):
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
		self.ticket = self._tickets()[0]
		self._finish(self.ticket)
		replacement = self._replacement(self._request())
		self._finish(replacement)
		self.assertTrue(self._checkout()["ok"])
		self.assertEqual(self._qty(self.ingredient), 991)
		# A second remake uses the base recipe plus these same add-ons once,
		# not the first replacement's already-expanded recipe plus them again.
		second = self._replacement(self._request(ticket=replacement))
		self._finish(second)
		self.assertEqual(self._qty(self.ingredient), 988)

	def test_partial_ready_issues_only_the_new_replacement_quantity(self):
		self._source(qty=3)
		replacement = self._replacement(self._request(qty=2))
		for action, status in (("Accept", "Sent"), ("Start", "Accepted")):
			self.assertTrue(restaurant.kitchen_action(replacement, action, str(uuid4()), status)["ok"])
		for target in (1, 2):
			doc = restaurant.get_kitchen_ticket(replacement)["data"]
			response = restaurant.kitchen_action(
				replacement,
				"Ready",
				str(uuid4()),
				doc["status"],
				{doc["items"][0]["line_id"]: 1},
				str(doc["modified"]),
			)
			self.assertTrue(response["ok"], response)
			self.assertEqual(self._qty(self.item), 3)
			self.assertEqual(self._qty(self.ingredient), 997 - target)
		self.assertEqual(
			frappe.db.count("Stock Entry", {"vunapos_remake_ticket": replacement, "docstatus": 1}), 2
		)

	def test_cancel_unstarted_remake_releases_ingredients_and_can_be_requested_again(self):
		self._source(qty=1)
		replacement = self._replacement(self._request())
		doc = restaurant.get_kitchen_ticket(replacement)["data"]
		key = str(uuid4())
		response = restaurant.kitchen_action(
			replacement,
			"Cancel Remake",
			key,
			doc["status"],
			expected_modified=str(doc["modified"]),
			reason="Guest no longer needs replacement",
		)
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["status"], "Cancelled")
		self.assertEqual(frappe.db.get_value("Work Order", doc["items"][0]["work_order"], "docstatus"), 2)
		self.assertTrue(
			restaurant.kitchen_action(
				replacement,
				"Cancel Remake",
				key,
				doc["status"],
				expected_modified=str(doc["modified"]),
				reason="Guest no longer needs replacement",
			)["ok"]
		)
		source = restaurant.get_kitchen_ticket(self.ticket)["data"]
		self.assertEqual(source["items"][0]["retired_qty"], 1)
		self.assertEqual(source["items"][0]["served_qty"], 0)
		self.assertEqual(source["items"][0]["ready_to_serve_qty"], 0)
		self.assertEqual(source["items"][0]["available_quantities"]["Undo Serve"], 0)
		second = self._replacement(self._request())
		self._finish(second)
		self.assertEqual(self._qty(self.item), 1)

	def test_prepared_replacement_cannot_be_silently_cancelled(self):
		self._source()
		replacement = self._replacement(self._request())
		self._finish(replacement)
		doc = restaurant.get_kitchen_ticket(replacement)["data"]
		response = restaurant.kitchen_action(
			replacement,
			"Cancel Remake",
			str(uuid4()),
			doc["status"],
			expected_modified=str(doc["modified"]),
			reason="Cancel extra meal",
		)
		self.assertFalse(response["ok"], response)
		self.assertEqual(frappe.db.get_value("Work Order", doc["items"][0]["work_order"], "docstatus"), 1)

	def test_batch_tracked_output_issues_its_own_batch_not_the_original_meal(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.create_new_batch = 1
		item.batch_number_series = "REM-.#####"
		item.save()
		self._source(qty=1)
		original_sre = frappe.get_all(
			"Stock Reservation Entry",
			filters={"voucher_type": "Sales Order", "voucher_no": self.order, "docstatus": 1},
			pluck="name",
		)
		self.assertTrue(original_sre)
		original_batch = frappe.get_doc("Stock Reservation Entry", original_sre[0]).sb_entries[0].batch_no
		replacement = self._replacement(self._request())
		self._finish(replacement)
		entry = frappe.get_doc(
			"Stock Entry", frappe.db.get_value("Stock Entry", {"vunapos_remake_ticket": replacement}, "name")
		)
		bundle = frappe.get_doc("Serial and Batch Bundle", entry.items[0].serial_and_batch_bundle)
		self.assertNotEqual(bundle.entries[0].batch_no, original_batch)
		self.assertEqual(self._qty(self.item), 1)

	def test_pos_consolidation_consumes_only_original_reservations_after_a_remake(self):
		from erpnext.accounts.doctype.pos_invoice_merge_log.pos_invoice_merge_log import (
			consolidate_pos_invoices,
		)

		from vunapos.tests.helpers import set_invoice_mode

		set_invoice_mode("POS Invoice")
		self._source()
		self._finish(self._replacement(self._request()))
		bill = self._checkout()
		self.assertTrue(bill["ok"], bill)
		invoice = bill["data"]["invoice"]["name"]
		before_billed = frappe.db.get_value("Sales Order", self.order, "per_billed")
		consolidate_pos_invoices([frappe._dict(pos_invoice=invoice, customer="_Test Customer")])
		self.assertEqual(self._qty(self.item), 0)
		self.assertEqual(frappe.db.get_value("Sales Order", self.order, "per_billed"), before_billed)
		consolidated = frappe.db.get_value("POS Invoice", invoice, "consolidated_invoice")
		self.assertTrue(consolidated)
		self.assertFalse(frappe.db.get_value("Sales Invoice Item", {"parent": consolidated}, "sales_order"))

	def test_desk_production_issues_extra_output_atomically_before_mark_ready(self):
		from vunapos.services.kitchen_lifecycle_service import _stock_entry

		self._source()
		replacement = self._replacement(self._request())
		self.assertTrue(restaurant.kitchen_action(replacement, "Accept", str(uuid4()), "Sent")["ok"])
		self.assertTrue(restaurant.kitchen_action(replacement, "Start", str(uuid4()), "Accepted")["ok"])
		doc = restaurant.get_kitchen_ticket(replacement)["data"]
		wo = frappe.get_doc("Work Order", doc["items"][0]["work_order"])
		_stock_entry(wo, "Manufacture", 1)
		self.assertEqual(self._qty(self.item), 2)
		response = restaurant.kitchen_action(replacement, "Ready", str(uuid4()), "Preparing")
		self.assertTrue(response["ok"], response)
		self.assertEqual(
			frappe.db.count("Stock Entry", {"vunapos_remake_ticket": replacement, "docstatus": 1}), 1
		)

	def test_explicit_native_reversal_blocks_service_until_replacement_is_cancelled(self):
		self._source()
		replacement = self._replacement(self._request())
		for action, status in (("Accept", "Sent"), ("Start", "Accepted"), ("Ready", "Preparing")):
			self.assertTrue(restaurant.kitchen_action(replacement, action, str(uuid4()), status)["ok"])
		issue = frappe.get_doc(
			"Stock Entry", frappe.db.get_value("Stock Entry", {"vunapos_remake_ticket": replacement}, "name")
		)
		manufacture = issue.vunapos_remake_manufacture_entry
		issue.cancel()
		response = restaurant.kitchen_action(replacement, "Serve", str(uuid4()), "Ready")
		self.assertEqual(response["errors"][0]["code"], "REMAKE_STOCK_REVIEW_REQUIRED")
		response = restaurant.preview_session_bill(self.session, self.profile.name)
		self.assertFalse(response["ok"], response)
		frappe.get_doc("Stock Entry", manufacture).cancel()
		doc = restaurant.get_kitchen_ticket(replacement)["data"]
		response = restaurant.kitchen_action(
			replacement,
			"Cancel Remake",
			str(uuid4()),
			doc["status"],
			expected_modified=str(doc["modified"]),
			reason="Production explicitly reversed",
		)
		self.assertTrue(response["ok"], response)
		self.assertTrue(self._preview()["can_checkout"])

	def test_remake_uses_native_wip_transfers_before_consuming_extra_output(self):
		warehouse = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": f"Remake WIP {self.token}",
				"company": self.profile.company,
				"parent_warehouse": frappe.db.get_value(
					"Warehouse", {"company": self.profile.company, "is_group": 1}, "name"
				),
			}
		).insert(ignore_permissions=True)
		frappe.db.set_value("Kitchen Station", self.station, "wip_warehouse", warehouse.name)
		frappe.clear_document_cache("Kitchen Station", self.station)
		self._source()
		replacement = self._replacement(self._request())
		self._finish(replacement)
		self.assertEqual(self._qty(self.ingredient), 997)
		self.assertEqual(
			frappe.db.get_value(
				"Bin", {"item_code": self.ingredient, "warehouse": warehouse.name}, "actual_qty"
			),
			0,
		)
		self.assertEqual(self._qty(self.item), 2)

	def test_selling_uom_is_preserved_and_only_stock_uom_quantities_are_consumed(self):
		if not frappe.db.exists("UOM", "Box"):
			frappe.get_doc({"doctype": "UOM", "uom_name": "Box", "must_be_whole_number": 1}).insert(
				ignore_permissions=True
			)
		item = frappe.get_doc("Item", self.item)
		item.sales_uom = "Box"
		item.append("uoms", {"uom": "Box", "conversion_factor": 6})
		item.save()
		self._source()
		replacement = self._replacement(self._request())
		doc = frappe.get_doc("Kitchen Order Ticket", replacement)
		self.assertEqual((doc.items[0].qty, doc.items[0].uom, doc.items[0].stock_qty), (1, "Box", 6))
		self._finish(replacement)
		self.assertEqual(self._qty(self.item), 12)
		self.assertEqual(self._qty(self.ingredient), 982)
		self.assertTrue(self._checkout()["ok"])
		self.assertEqual(self._qty(self.item), 0)
