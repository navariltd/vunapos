"""Real independent transactions. Run separately on a disposable test site.

Unlike rollback-isolated integration tests, these deliberately commit fixture
and worker transactions so a competing request can see the winning result.
CI runs this module last with VUNAPOS_CONCURRENCY_TESTS=1.
"""

import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
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
class TestRestaurantConcurrency(IntegrationTestCase):
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
