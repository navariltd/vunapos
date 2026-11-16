"""Real independent transactions. Run separately on a disposable test site.

Unlike rollback-isolated integration tests, these deliberately commit fixture
and worker transactions so a competing request can see the winning result.
CI runs this module last with VUNAPOS_CONCURRENCY_TESTS=1.
"""

import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from unittest import skipUnless
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.tests import test_kitchen_service as kitchen_fixtures
from vunapos.tests import test_restaurant_billing as billing_fixtures
from vunapos.tests.helpers import (
	ensure_open_pos_opening_entry,
	ensure_test_pos_profile,
	ensure_test_restaurant,
	set_invoice_mode,
)


@skipUnless(os.environ.get("VUNAPOS_CONCURRENCY_TESTS") == "1", "Run separately on a disposable test site")
class RestaurantConcurrencyFixture(IntegrationTestCase):
	_item = kitchen_fixtures.TestKitchenService._item
	_raw_item = kitchen_fixtures.TestKitchenService._raw_item
	_station = kitchen_fixtures.TestKitchenService._station
	_send = kitchen_fixtures.TestKitchenService._send
	_tickets = kitchen_fixtures.TestKitchenService._tickets
	_ready = billing_fixtures.TestRestaurantBilling._ready
	_preview = billing_fixtures.TestRestaurantBilling._preview
	_checkout = billing_fixtures.TestRestaurantBilling._checkout

	def setUp(self):
		super().setUp()
		if frappe.local.site != "test_site" and not frappe.local.site.startswith("ci-"):
			raise RuntimeError("Concurrency tests may only commit on test_site or a ci-* disposable site")
		frappe.set_user("Administrator")
		self.token = uuid4().hex[:8]
		# Never commit a preparation route onto the shared generic restaurant:
		# subsequent direct-sale tests must not suddenly require a recipe.
		name = ensure_test_restaurant(f"_Test Concurrency {self.token}")
		self.profile = frappe.copy_doc(frappe.get_doc("POS Profile", ensure_test_pos_profile()))
		self.profile.set("__newname", f"_Test Concurrent Till {self.token}")
		self.profile.update(
			{
				"vunapos_pos_mode": "Restaurant",
				"vunapos_restaurant": name,
				"vunapos_branch": f"{name} Branch",
				"vunapos_complete_preparation_on_billing": 0,
			}
		)
		self.profile.insert(ignore_permissions=True)
		self.openings_before = frappe.get_all(
			"POS Opening Entry",
			filters={"user": "Administrator", "docstatus": 1, "status": "Open"},
			fields=["name", "period_end_date"],
		)
		ensure_open_pos_opening_entry(self.profile.name)
		self.settings_before = {
			field: frappe.db.get_single_value("Stock Settings", field)
			for field in ("enable_stock_reservation", "auto_reserve_stock")
		}
		self.invoice_type_before = frappe.db.get_single_value("POS Settings", "invoice_type")
		frappe.db.set_single_value("Stock Settings", "enable_stock_reservation", 1)
		frappe.db.set_single_value("Stock Settings", "auto_reserve_stock", 0)
		set_invoice_mode("Sales Invoice")
		self.ingredient = self._raw_item()
		self.item = self._item("Main")
		self.group = frappe.db.get_value("Item", self.item, "item_group")
		self.station = self._station("Main", [self.group])
		from vunapos.services.service_type_service import get_profile_service_types

		service = next(
			row["name"] for row in get_profile_service_types(self.profile) if not row["requires_table"]
		)
		opened = restaurant.open_session(self.profile.name, str(uuid4()), service_type=service)
		self.assertTrue(opened["ok"], opened)
		self.session = opened["data"]["name"]

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()
		for field, value in getattr(self, "settings_before", {}).items():
			frappe.db.set_single_value("Stock Settings", field, value)
		if hasattr(self, "invoice_type_before"):
			set_invoice_mode(self.invoice_type_before)
		if getattr(self, "profile", None) and frappe.db.exists("POS Profile", self.profile.name):
			for name in frappe.get_all(
				"POS Opening Entry",
				filters={"pos_profile": self.profile.name, "status": "Open"},
				pluck="name",
			):
				frappe.db.set_value(
					"POS Opening Entry",
					name,
					{"status": "Closed", "period_end_date": frappe.utils.now_datetime()},
					update_modified=False,
				)
			# Committed fixtures must never become another test's default till.
			frappe.db.set_value("POS Profile", self.profile.name, "disabled", 1)
		for opening in getattr(self, "openings_before", []):
			if frappe.db.exists("POS Opening Entry", opening.name):
				frappe.db.set_value(
					"POS Opening Entry",
					opening.name,
					{"status": "Open", "period_end_date": opening.period_end_date},
					update_modified=False,
				)
		frappe.db.commit()  # nosemgrep - restore shared settings after committed races
		super().tearDown()

	def _race(self, *commands):
		site = frappe.local.site
		sites_path = str(frappe.local.sites_path)
		barrier = Barrier(len(commands))
		# This is intentional: independent transactions cannot see uncommitted
		# fixtures. The module is opt-in and restricted to disposable sites.
		frappe.db.commit()  # nosemgrep

		def worker(command):
			frappe.init(site=site, sites_path=sites_path)
			frappe.connect()
			try:
				frappe.flags.in_test = True
				frappe.set_user("Administrator")
				frappe.db.sql("SET SESSION innodb_lock_wait_timeout = 10")
				barrier.wait(timeout=15)
				response = command()
				if response["ok"]:
					frappe.db.commit()  # nosemgrep
				else:
					frappe.db.rollback()
				return response
			finally:
				frappe.destroy()

		with ThreadPoolExecutor(max_workers=len(commands)) as pool:
			futures = [pool.submit(worker, command) for command in commands]
			results = [future.result(timeout=60) for future in futures]
		frappe.db.rollback()  # start a new read view for assertions
		return results

	def _stop_review(self):
		placed = self._send([{"item_code": self.item, "qty": 4, "line_id": "meal"}])
		self.assertTrue(placed["ok"], placed)
		ticket = self._tickets(placed["data"]["name"])[0]
		for action, status in (("Accept", "Sent"), ("Start", "Accepted")):
			response = restaurant.kitchen_action(ticket, action, str(uuid4()), status)
			self.assertTrue(response["ok"], response)
		account = frappe.get_cached_value("Company", self.profile.company, "stock_adjustment_account")
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_waste_expense_account", account)
		frappe.clear_document_cache("POS Profile", self.profile.name)
		quote = restaurant.preview_preparation_stop(ticket)
		self.assertTrue(quote["ok"], quote)
		return quote["data"]

	def _stop_command(self, quote, key):
		return restaurant.stop_preparation(
			quote["ticket"],
			[line["line_id"] for line in quote["lines"]],
			{part["id"]: 1 for line in quote["lines"] for part in line["materials"]},
			key,
			quote["fingerprint"],
			"Guest cancelled",
			"Remove charge",
		)


class TestRestaurantConcurrency(RestaurantConcurrencyFixture):
	def test_simultaneous_stop_retries_consume_ingredients_once(self):
		quote = self._stop_review()
		key = str(uuid4())
		results = self._race(lambda: self._stop_command(quote, key), lambda: self._stop_command(quote, key))
		for result in results:
			self.assertTrue(result["ok"], results)
		self.assertEqual(
			frappe.db.count("Stock Entry", {"vunapos_stopped_ticket": quote["ticket"], "docstatus": 1}), 1
		)
		self.assertEqual(
			frappe.db.get_value(
				"Bin", {"item_code": self.ingredient, "warehouse": self.profile.warehouse}, "actual_qty"
			),
			999,
		)

	def test_ready_and_stop_cannot_both_apply_the_same_unfinished_review(self):
		quote = self._stop_review()
		results = self._race(
			lambda: self._stop_command(quote, str(uuid4())),
			lambda: restaurant.kitchen_action(quote["ticket"], "Ready", str(uuid4()), "Preparing"),
		)
		self.assertEqual(sum(result["ok"] for result in results), 1, results)
		wo = frappe.db.get_value("Kitchen Order Ticket Item", {"parent": quote["ticket"]}, "work_order")
		produced = frappe.db.get_value("Work Order", wo, "produced_qty")
		self.assertEqual(produced, 0 if results[0]["ok"] else 4)

	def test_order_waiting_for_manager_pause_sees_the_committed_pause(self):
		paused = Event()

		def pause():
			frappe.get_doc(
				{
					"doctype": "Restaurant Availability",
					"restaurant": self.profile.vunapos_restaurant,
					"branch": self.profile.vunapos_branch,
					"target_type": "Item",
					"item": self.item,
					"paused": 1,
					"reason": "Oven unavailable",
				}
			).insert()
			paused.set()
			return {"ok": True}

		def place():
			if not paused.wait(timeout=15):
				raise RuntimeError("Pause did not reach the branch lock")
			return self._send()

		results = self._race(pause, place)
		self.assertTrue(results[0]["ok"], results)
		self.assertFalse(results[1]["ok"], results)
		self.assertEqual(results[1]["errors"][0]["code"], "RESTAURANT_ITEM_PAUSED")
		self.assertFalse(self._tickets())

	def test_competing_availability_records_do_not_duplicate_one_target(self):
		def pause():
			try:
				frappe.get_doc(
					{
						"doctype": "Restaurant Availability",
						"restaurant": self.profile.vunapos_restaurant,
						"branch": self.profile.vunapos_branch,
						"target_type": "Item",
						"item": self.item,
						"paused": 1,
						"reason": "Out of service",
					}
				).insert()
				return {"ok": True}
			except frappe.ValidationError:
				return {"ok": False}

		results = self._race(pause, pause)
		self.assertEqual(sum(result["ok"] for result in results), 1, results)
		self.assertEqual(
			frappe.db.count(
				"Restaurant Availability",
				{
					"restaurant": self.profile.vunapos_restaurant,
					"branch": self.profile.vunapos_branch,
					"item": self.item,
				},
			),
			1,
		)

	def test_repausing_existing_record_and_placement_use_the_same_lock_order(self):
		pause = frappe.get_doc(
			{
				"doctype": "Restaurant Availability",
				"restaurant": self.profile.vunapos_restaurant,
				"branch": self.profile.vunapos_branch,
				"target_type": "Item",
				"item": self.item,
				"paused": 0,
				"reason": "Available",
			}
		).insert()
		name = pause.name

		def repause():
			doc = frappe.get_doc("Restaurant Availability", name)
			doc.paused = 1
			doc.reason = "Equipment failed again"
			doc.save()
			return {"ok": True}

		results = self._race(repause, lambda: self._send())
		self.assertTrue(results[0]["ok"], results)
		if not results[1]["ok"]:
			self.assertEqual(results[1]["errors"][0]["code"], "RESTAURANT_ITEM_PAUSED")
		self.assertEqual(len(self._tickets()), 1 if results[1]["ok"] else 0)

	def test_simultaneous_placement_creates_one_order_ticket_and_work_order(self):
		key = str(uuid4())
		items = [{"item_code": self.item, "qty": 2, "line_id": "same-line"}]

		def command():
			return restaurant.create_session_round(self.session, items, key)

		results = self._race(command, command)
		for response in results:
			self.assertTrue(response["ok"], response)
		self.assertEqual(results[0]["data"]["name"], results[1]["data"]["name"])
		order = results[0]["data"]["name"]
		self.assertEqual(frappe.db.count("Sales Order", {"vunapos_idempotency_key": key}), 1)
		self.assertEqual(frappe.db.count("Kitchen Order Ticket", {"sales_order": order}), 1)
		self.assertEqual(frappe.db.count("Work Order", {"sales_order": order}), 1)

	def test_simultaneous_rejection_retry_waives_charge_only_once(self):
		order = self._ready(2)
		ticket = self._tickets(order)[0]
		quote = restaurant.preview_rejection(ticket)
		self.assertTrue(quote["ok"], quote)
		key = str(uuid4())
		before = frappe.get_doc("Sales Order", order).grand_total

		def command():
			return restaurant.reject_prepared_items(
				ticket,
				{quote["data"]["lines"][0]["line_id"]: 1},
				key,
				quote["data"]["fingerprint"],
				"Burnt food",
				"Remove charge",
			)

		results = self._race(command, command)
		for result in results:
			self.assertTrue(result["ok"], result)
		self.assertEqual(frappe.get_doc("Sales Order", order).grand_total, before / 2)
		self.assertEqual(
			frappe.db.count("Kitchen Ticket Action", {"kitchen_ticket": ticket, "action": "Reject Items"}), 1
		)

	def test_different_rejections_cannot_both_use_the_same_review(self):
		order = self._ready(2)
		ticket = self._tickets(order)[0]
		quote = restaurant.preview_rejection(ticket)
		self.assertTrue(quote["ok"], quote)
		before = frappe.get_doc("Sales Order", order).grand_total

		def command():
			return restaurant.reject_prepared_items(
				ticket,
				{quote["data"]["lines"][0]["line_id"]: 1},
				str(uuid4()),
				quote["data"]["fingerprint"],
				"Burnt food",
				"Remove charge",
			)

		results = self._race(command, command)
		self.assertEqual(sum(bool(result["ok"]) for result in results), 1)
		failed = next(result for result in results if not result["ok"])
		self.assertEqual(failed["errors"][0]["code"], "REJECTION_REVIEW_CHANGED")
		self.assertEqual(frappe.get_doc("Sales Order", order).grand_total, before / 2)

	def test_rejection_and_checkout_cannot_use_stale_prices(self):
		order = self._ready(2)
		ticket = self._tickets(order)[0]
		quote = restaurant.preview_rejection(ticket)
		bill = self._preview()

		def rejection():
			return restaurant.reject_prepared_items(
				ticket,
				{quote["data"]["lines"][0]["line_id"]: 1},
				str(uuid4()),
				quote["data"]["fingerprint"],
				"Burnt food",
				"Remove charge",
			)

		results = self._race(rejection, lambda: self._checkout(preview=bill))
		self.assertEqual(sum(bool(result["ok"]) for result in results), 1)
		if results[0]["ok"]:
			self.assertEqual(results[1]["errors"][0]["code"], "SESSION_BILL_CHANGED")
		else:
			self.assertEqual(results[0]["errors"][0]["code"], "ORDER_NOT_EDITABLE")

	def test_simultaneous_visit_opening_returns_one_visit(self):
		key = str(uuid4())
		service = frappe.db.get_value("Restaurant Session", self.session, "service_type")

		def command():
			return restaurant.open_session(self.profile.name, key, service_type=service, guest_count=2)

		results = self._race(command, command)
		for response in results:
			self.assertTrue(response["ok"], response)
		self.assertEqual(results[0]["data"]["name"], results[1]["data"]["name"])
		self.assertEqual(frappe.db.count("Restaurant Session", {"idempotency_key": key}), 1)

	def test_simultaneous_visit_edits_reject_the_stale_terminal(self):
		version = str(restaurant.get_session(self.session)["data"]["modified"])
		results = self._race(
			lambda: restaurant.update_session(self.session, guest_count=3, expected_modified=version),
			lambda: restaurant.update_session(self.session, guest_count=4, expected_modified=version),
		)
		self.assertEqual(sum(response["ok"] for response in results), 1, results)
		failure = next(response for response in results if not response["ok"])
		self.assertEqual(failure["errors"][0]["code"], "SESSION_CHANGED")

	def test_simultaneous_conflicting_payloads_do_not_silently_reuse_an_order(self):
		key = str(uuid4())
		results = self._race(
			lambda: restaurant.create_session_round(self.session, [{"item_code": self.item, "qty": 1}], key),
			lambda: restaurant.create_session_round(self.session, [{"item_code": self.item, "qty": 2}], key),
		)
		self.assertEqual(sum(response["ok"] for response in results), 1, results)
		failure = next(response for response in results if not response["ok"])
		self.assertEqual(failure["errors"][0]["code"], "IDEMPOTENCY_CONFLICT")
		self.assertEqual(frappe.db.count("Sales Order", {"vunapos_idempotency_key": key}), 1)

	def test_simultaneous_distinct_rounds_are_both_preserved(self):
		keys = [str(uuid4()), str(uuid4())]
		results = self._race(
			*[
				lambda key=key: restaurant.create_session_round(
					self.session, [{"item_code": self.item, "qty": 1}], key
				)
				for key in keys
			]
		)
		for response in results:
			self.assertTrue(response["ok"], response)
		self.assertNotEqual(results[0]["data"]["name"], results[1]["data"]["name"])
		self.assertEqual(len(restaurant.get_session(self.session)["data"]["rounds"]), 2)

	def test_simultaneous_ready_commands_manufacture_once(self):
		placed = self._send()
		self.assertTrue(placed["ok"], placed)
		ticket = self._tickets(placed["data"]["name"])[0]
		for action, expected in (("Accept", "Sent"), ("Start", "Accepted")):
			response = restaurant.kitchen_action(ticket, action, str(uuid4()), expected)
			self.assertTrue(response["ok"], response)
		key = str(uuid4())

		def command():
			return restaurant.kitchen_action(ticket, "Ready", key, "Preparing")

		for response in self._race(command, command):
			self.assertTrue(response["ok"], response)
			self.assertEqual(response["data"]["status"], "Ready")
		wo = frappe.db.get_value("Kitchen Order Ticket Item", {"parent": ticket}, "work_order")
		self.assertEqual(frappe.db.get_value("Work Order", wo, "produced_qty"), 2)
		self.assertEqual(
			frappe.db.count("Stock Entry", {"work_order": wo, "purpose": "Manufacture", "docstatus": 1}), 1
		)
		self.assertEqual(
			frappe.db.count("Kitchen Ticket Action", {"request_key": key, "outcome": "Succeeded"}), 1
		)

	def test_simultaneous_billing_submits_one_invoice(self):
		self._ready()
		preview = self._preview()

		def command():
			return self._checkout(preview)

		results = self._race(command, command)
		for response in results:
			self.assertTrue(response["ok"], response)
		self.assertEqual(results[0]["data"]["invoice"]["name"], results[1]["data"]["invoice"]["name"])
		self.assertEqual(frappe.db.count("Sales Invoice", {"vunapos_restaurant_session": self.session}), 1)
		self.assertEqual(frappe.db.get_value("Restaurant Session", self.session, "status"), "Settled")

	def _partial_ready_race(self, same_key):
		placed = self._send(items=[{"item_code": self.item, "qty": 4, "line_id": "meal"}])
		self.assertTrue(placed["ok"], placed)
		ticket = self._tickets(placed["data"]["name"])[0]
		for action, expected in (("Accept", "Sent"), ("Start", "Accepted")):
			response = restaurant.kitchen_action(ticket, action, str(uuid4()), expected)
			self.assertTrue(response["ok"], response)
		version = str(restaurant.get_kitchen_ticket(ticket)["data"]["modified"])
		key = str(uuid4())

		def command():
			return restaurant.kitchen_action(
				ticket,
				"Ready",
				key if same_key else str(uuid4()),
				"Preparing",
				quantities={"meal": 1},
				expected_modified=version,
			)

		results = self._race(command, command)
		self.assertEqual(sum(response["ok"] for response in results), 2 if same_key else 1, results)
		if not same_key:
			failure = next(response for response in results if not response["ok"])
			self.assertEqual(failure["errors"][0]["code"], "KITCHEN_STALE_STATE")
		current = restaurant.get_kitchen_ticket(ticket)["data"]
		self.assertEqual(current["status"], "Preparing")
		self.assertEqual(current["items"][0]["ready_qty"], 1)
		self.assertEqual(
			frappe.db.get_value("Work Order", current["items"][0]["work_order"], "produced_qty"), 1
		)

	def test_same_partial_ready_retry_produces_once_across_transactions(self):
		self._partial_ready_race(same_key=True)

	def test_competing_partial_ready_commands_reject_unchanged_status_with_stale_version(self):
		self._partial_ready_race(same_key=False)

	def test_competing_ready_actions_reject_stale_state_without_extra_production(self):
		placed = self._send()
		self.assertTrue(placed["ok"], placed)
		ticket = self._tickets(placed["data"]["name"])[0]
		for action, expected in (("Accept", "Sent"), ("Start", "Accepted")):
			self.assertTrue(restaurant.kitchen_action(ticket, action, str(uuid4()), expected)["ok"])
		results = self._race(
			lambda: restaurant.kitchen_action(ticket, "Ready", str(uuid4()), "Preparing"),
			lambda: restaurant.kitchen_action(ticket, "Ready", str(uuid4()), "Preparing"),
		)
		self.assertEqual(sum(response["ok"] for response in results), 1, results)

		failure = next(response for response in results if not response["ok"])
		self.assertEqual(failure["errors"][0]["code"], "KITCHEN_STALE_STATE")
		wo = frappe.db.get_value("Kitchen Order Ticket Item", {"parent": ticket}, "work_order")
		self.assertEqual(
			frappe.db.count("Stock Entry", {"work_order": wo, "purpose": "Manufacture", "docstatus": 1}), 1
		)

	def test_simultaneous_item_cancellation_retries_reduce_quantity_once(self):
		placed = self._send(items=[{"item_code": self.item, "qty": 4, "line_id": "meal"}])
		self.assertTrue(placed["ok"], placed)
		order = placed["data"]["name"]
		quote = restaurant.preview_item_cancellation(order)["data"]
		key = str(uuid4())

		def command():
			return restaurant.cancel_order_items(
				order, {"meal": 1}, key, quote["fingerprint"], "Customer changed their mind"
			)

		results = self._race(command, command)
		for result in results:
			self.assertTrue(result["ok"], result)
		self.assertEqual(frappe.db.get_value("Sales Order Item", {"parent": order}, "qty"), 3)
		self.assertEqual(
			frappe.db.count("Restaurant Request", {"action": "Cancel Items", "reference_name": order}), 1
		)

	def test_cancellation_and_kitchen_ready_cannot_both_use_the_old_review(self):
		placed = self._send(items=[{"item_code": self.item, "qty": 4, "line_id": "meal"}])
		self.assertTrue(placed["ok"], placed)
		order = placed["data"]["name"]
		ticket = self._tickets(order)[0]
		for action, status in (("Accept", "Sent"), ("Start", "Accepted")):
			self.assertTrue(restaurant.kitchen_action(ticket, action, str(uuid4()), status)["ok"])
		current = restaurant.get_kitchen_ticket(ticket)["data"]
		quote = restaurant.preview_item_cancellation(order)["data"]
		results = self._race(
			lambda: restaurant.cancel_order_items(
				order, {"meal": 1}, str(uuid4()), quote["fingerprint"], "Customer changed their mind"
			),
			lambda: restaurant.kitchen_action(
				ticket, "Ready", str(uuid4()), "Preparing", {"meal": 4}, str(current["modified"])
			),
		)
		self.assertEqual(sum(result["ok"] for result in results), 1, results)
		failure = next(result for result in results if not result["ok"])
		self.assertIn(failure["errors"][0]["code"], ("CANCELLATION_CHANGED", "KITCHEN_STALE_STATE"))
		qty = frappe.db.get_value("Sales Order Item", {"parent": order}, "qty")
		produced = frappe.db.get_value("Work Order", {"sales_order": order, "docstatus": 1}, "produced_qty")
		self.assertIn((qty, produced), ((3, 0), (4, 4)))

	def test_cancellation_and_billing_cannot_both_commit_the_old_quantities(self):
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_complete_preparation_on_billing", 1)
		frappe.clear_document_cache("POS Profile", self.profile.name)
		placed = self._send(items=[{"item_code": self.item, "qty": 4, "line_id": "meal"}])
		self.assertTrue(placed["ok"], placed)
		order = placed["data"]["name"]
		quote = restaurant.preview_item_cancellation(order)["data"]
		bill = self._preview()
		results = self._race(
			lambda: restaurant.cancel_order_items(
				order, {"meal": 1}, str(uuid4()), quote["fingerprint"], "Customer changed their mind"
			),
			lambda: self._checkout(bill),
		)
		self.assertEqual(sum(result["ok"] for result in results), 1, results)
		qty = frappe.db.get_value("Sales Order Item", {"parent": order}, "qty")
		produced = frappe.db.get_value("Work Order", {"sales_order": order, "docstatus": 1}, "produced_qty")
		self.assertIn((qty, produced), ((3, 0), (4, 4)))

	def test_billing_and_kitchen_completion_cannot_manufacture_twice(self):
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_complete_preparation_on_billing", 1)
		frappe.clear_document_cache("POS Profile", self.profile.name)
		placed = self._send()
		self.assertTrue(placed["ok"], placed)
		ticket = self._tickets(placed["data"]["name"])[0]
		for action, expected in (("Accept", "Sent"), ("Start", "Accepted")):
			self.assertTrue(restaurant.kitchen_action(ticket, action, str(uuid4()), expected)["ok"])
		preview = self._preview()
		results = self._race(
			lambda: self._checkout(preview),
			lambda: restaurant.kitchen_action(ticket, "Ready", str(uuid4()), "Preparing"),
		)
		self.assertTrue(results[0]["ok"], results[0])
		if not results[1]["ok"]:
			self.assertEqual(results[1]["errors"][0]["code"], "KITCHEN_ORDER_NOT_OPEN")
		wo = frappe.db.get_value("Kitchen Order Ticket Item", {"parent": ticket}, "work_order")
		self.assertEqual(
			frappe.db.count("Stock Entry", {"work_order": wo, "purpose": "Manufacture", "docstatus": 1}), 1
		)
		self.assertEqual(frappe.db.get_value("Restaurant Session", self.session, "status"), "Settled")

	def _waste_quote(self):
		account = frappe.get_doc(
			{
				"doctype": "Account",
				"account_name": f"Concurrent Waste {self.token}",
				"company": self.profile.company,
				"root_type": "Expense",
				"report_type": "Profit and Loss",
				"parent_account": frappe.db.get_value(
					"Account",
					{"company": self.profile.company, "root_type": "Expense", "is_group": 1},
					"name",
				),
			}
		).insert(ignore_permissions=True)
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_waste_expense_account", account.name)
		order = self._ready(2)
		ticket = self._tickets(order)[0]
		self.assertTrue(restaurant.kitchen_action(ticket, "Serve", str(uuid4()), "Ready")["ok"])
		self.assertTrue(self._checkout()["ok"])
		response = restaurant.preview_restaurant_waste(ticket)
		self.assertTrue(response["ok"], response)
		return response["data"]

	def test_simultaneous_waste_retries_create_one_journal(self):
		quote = self._waste_quote()
		key = str(uuid4())
		line = quote["lines"][0]["line_id"]

		def command():
			return restaurant.record_restaurant_waste(
				quote["ticket"], {line: 2}, key, quote["fingerprint"], "Dropped food"
			)

		results = self._race(command, command)
		for result in results:
			self.assertTrue(result["ok"], result)
		self.assertEqual(
			frappe.db.count(
				"Kitchen Ticket Action", {"kitchen_ticket": quote["ticket"], "action": "Record Waste"}
			),
			1,
		)

	def test_different_waste_requests_cannot_both_consume_the_old_review(self):
		quote = self._waste_quote()
		line = quote["lines"][0]["line_id"]

		def command():
			return restaurant.record_restaurant_waste(
				quote["ticket"], {line: 2}, str(uuid4()), quote["fingerprint"], "Dropped food"
			)

		results = self._race(command, command)
		self.assertEqual(sum(result["ok"] for result in results), 1, results)
		failure = next(result for result in results if not result["ok"])
		self.assertEqual(failure["errors"][0]["code"], "WASTE_REVIEW_CHANGED")

	def _remake_review(self):
		order = self._ready(1)
		ticket = self._tickets(order)[0]
		response = restaurant.preview_remake(ticket)
		self.assertTrue(response["ok"], response)
		return response["data"]

	def test_simultaneous_remake_retries_create_one_replacement(self):
		quote = self._remake_review()
		key = str(uuid4())
		line = quote["lines"][0]["line_id"]

		def command():
			return restaurant.request_remake(
				quote["ticket"], {line: 1}, key, quote["fingerprint"], "Burnt", "Discard"
			)

		results = self._race(command, command)
		for result in results:
			self.assertTrue(result["ok"], result)
		self.assertEqual(frappe.db.count("Kitchen Order Ticket", {"remake_of": quote["ticket"]}), 1)

	def test_competing_remakes_cannot_both_use_the_same_prepared_quantity(self):
		quote = self._remake_review()
		line = quote["lines"][0]["line_id"]

		def command():
			return restaurant.request_remake(
				quote["ticket"], {line: 1}, str(uuid4()), quote["fingerprint"], "Burnt", "Discard"
			)

		results = self._race(command, command)
		self.assertEqual(sum(result["ok"] for result in results), 1, results)
		self.assertEqual(
			next(result for result in results if not result["ok"])["errors"][0]["code"],
			"REMAKE_REVIEW_CHANGED",
		)

	def test_desk_manufacturing_and_kds_ready_issue_replacement_output_once(self):
		from vunapos.services.kitchen_lifecycle_service import _stock_entry

		quote = self._remake_review()
		response = restaurant.request_remake(
			quote["ticket"],
			{quote["lines"][0]["line_id"]: 1},
			str(uuid4()),
			quote["fingerprint"],
			"Burnt",
			"Discard",
		)
		self.assertTrue(response["ok"], response)
		ticket = response["data"]["actions"][0]["item_quantities"]["replacement_ticket"]
		for action, status in (("Accept", "Sent"), ("Start", "Accepted")):
			self.assertTrue(restaurant.kitchen_action(ticket, action, str(uuid4()), status)["ok"])
		wo_name = frappe.db.get_value("Kitchen Order Ticket Item", {"parent": ticket}, "work_order")

		def desk():
			try:
				_stock_entry(frappe.get_doc("Work Order", wo_name), "Manufacture", 1)
				return {"ok": True}
			except frappe.ValidationError as exc:
				return {"ok": False, "error": str(exc)}

		results = self._race(
			desk, lambda: restaurant.kitchen_action(ticket, "Ready", str(uuid4()), "Preparing")
		)
		self.assertTrue(results[1]["ok"], results)
		self.assertEqual(frappe.db.get_value("Work Order", wo_name, "produced_qty"), 1)
		self.assertEqual(frappe.db.count("Stock Entry", {"vunapos_remake_ticket": ticket, "docstatus": 1}), 1)
		self.assertEqual(
			frappe.db.count("Stock Entry", {"work_order": wo_name, "purpose": "Manufacture", "docstatus": 1}),
			1,
		)
