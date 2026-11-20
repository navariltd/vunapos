import os
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

import frappe

from vunapos.api import gateway as gateway_api
from vunapos.api import restaurant
from vunapos.tests import test_restaurant_concurrency as races
from vunapos.tests import test_restaurant_payments as fixtures
from vunapos.tests.helpers import ensure_test_payment_mode


@skipUnless(os.environ.get("VUNAPOS_CONCURRENCY_TESTS") == "1", "Run on a disposable ci-* site")
class TestRestaurantPaymentConcurrency(races.RestaurantConcurrencyFixture):
	# Only payment races belong in this subclass, not the inherited kitchen tests.
	_ensure_payment_gateway = fixtures.TestRestaurantPayments._ensure_payment_gateway
	_make_c2b_payment = fixtures.TestRestaurantPayments._make_c2b_payment
	_start = fixtures.TestRestaurantPayments._start
	_paid = fixtures.TestRestaurantPayments._paid

	def setUp(self):
		super().setUp()
		if not frappe.db.table_exists("KE Payment Request"):
			self.skipTest("Install vuna_payments on the disposable site")
		self.enterContext(patch("frappe.enqueue"))
		self.gateway_account = self._ensure_payment_gateway()
		self.mode = ensure_test_payment_mode()
		self.profile.reload()
		self.profile.append(
			"payments", {"mode_of_payment": self.mode, "payment_gateway": self.gateway_account}
		)
		self.profile.save()
		frappe.clear_document_cache("POS Profile", self.profile.name)
		self._ready()
		self.quote = self._preview()
		self.total = self.quote["invoice"]["totals"]["grand_total"]

	def test_two_browser_keys_create_one_queued_attempt_without_sending_money(self):
		results = self._race(lambda: self._start(), lambda: self._start())
		for result in results:
			self.assertTrue(result["ok"], results)
		self.assertEqual(results[0]["data"]["name"], results[1]["data"]["name"])
		self.assertEqual(
			frappe.db.get_value("KE Payment Request", results[0]["data"]["source_name"], "docstatus"), 0
		)

	def test_durable_worker_claim_prevents_duplicate_send_after_timeout(self):
		from vuna_payments.vuna_payments.doctype.ke_payment_request.ke_payment_request import KEPaymentRequest

		started = self._start()
		self.assertTrue(started["ok"], started)
		from vunapos.services.restaurant_payment_service import dispatch

		def run():
			dispatch(started["data"]["name"])
			return {"ok": True}

		with patch.object(
			KEPaymentRequest, "submit", side_effect=TimeoutError("Unknown provider outcome")
		) as send:
			results = self._race(run, run)
			self.assertTrue(all(result["ok"] for result in results), results)
			self.assertEqual(send.call_count, 1)
		self.assertEqual(
			frappe.db.get_value("VunaPOS Gateway Payment Link", started["data"]["name"], "dispatch_state"),
			"Uncertain",
		)

	def test_two_visits_cannot_reserve_the_same_c2b_receipt(self):
		source = self._make_c2b_payment(
			self.gateway_account,
			self.mode,
			self.total,
			currency=self.quote["invoice"]["price_list_currency"],
			customer=self.quote["session"]["customer"],
			submit=False,
		)
		first = self.session
		second = restaurant.open_session(
			self.profile.name, str(uuid4()), service_type=self.quote["session"]["service_type"]
		)
		self.assertTrue(second["ok"], second)
		self.session = second["data"]["name"]
		self._ready()
		second_quote = self._preview()
		self.session = first

		def attach(visit, quote):
			return gateway_api.attach_c2b_gateway_payment(
				pos_profile=self.profile.name,
				mode_of_payment=self.mode,
				transaction_reference=source.transaction_id,
				amount=self.total,
				customer=self.quote["session"]["customer"],
				currency=source.currency,
				restaurant_session=visit,
				bill_fingerprint=quote["fingerprint"],
				idempotency_key=str(uuid4()),
			)

		results = self._race(
			lambda: attach(first, self.quote), lambda: attach(second["data"]["name"], second_quote)
		)
		self.assertEqual(sum(result["ok"] for result in results), 1, results)
		self.assertEqual(
			next(result for result in results if not result["ok"])["errors"][0]["code"],
			"GATEWAY_PAYMENT_ALREADY_RESERVED",
		)

	def test_same_paid_visit_checkout_reuses_the_invoice_across_transactions(self):
		link = self._paid()

		def checkout():
			return self._checkout(
				self.quote,
				payments=[
					{"mode_of_payment": self.mode, "gateway_payment_link": link.name, "amount": self.total}
				],
			)

		results = self._race(checkout, checkout)
		for result in results:
			self.assertTrue(result["ok"], results)
		self.assertEqual(results[0]["data"]["invoice"]["name"], results[1]["data"]["invoice"]["name"])
