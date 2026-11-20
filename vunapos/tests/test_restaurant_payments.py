from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import now_datetime

from vunapos.api import gateway as gateway_api
from vunapos.api import restaurant
from vunapos.services import gateway_payment_service as gateway
from vunapos.services import restaurant_payment_service as payments
from vunapos.tests import test_restaurant_billing as fixtures
from vunapos.tests import test_sales_invoice_flow as gateway_fixtures
from vunapos.tests.helpers import ensure_open_pos_opening_entry, ensure_test_payment_mode


class TestRestaurantPayments(IntegrationTestCase):
	_item = fixtures.TestRestaurantBilling._item
	_raw_item = fixtures.TestRestaurantBilling._raw_item
	_station = fixtures.TestRestaurantBilling._station
	_send = fixtures.TestRestaurantBilling._send
	_tickets = fixtures.TestRestaurantBilling._tickets
	_ready = fixtures.TestRestaurantBilling._ready
	_preview = fixtures.TestRestaurantBilling._preview
	_checkout = fixtures.TestRestaurantBilling._checkout
	tearDown = fixtures.TestRestaurantBilling.tearDown
	_ensure_payment_gateway = gateway_fixtures.TestVunaPOSSalesInvoiceFlow._ensure_payment_gateway
	_make_c2b_payment = gateway_fixtures.TestVunaPOSSalesInvoiceFlow._make_c2b_payment

	def setUp(self):
		fixtures.TestRestaurantBilling.setUp(self)
		if not frappe.db.table_exists("KE Payment Request"):
			self.skipTest("Install vuna_payments on the disposable payment test site")
		self.enqueue = self.enterContext(patch("frappe.enqueue"))
		self.gateway_account = self._ensure_payment_gateway()
		self.profile.reload()
		self.cash_mode = self.profile.payments[0].mode_of_payment
		self.mode = ensure_test_payment_mode()
		if not any(row.mode_of_payment == self.mode for row in self.profile.payments):
			self.profile.append("payments", {"mode_of_payment": self.mode})
		for row in self.profile.payments:
			row.payment_gateway = self.gateway_account if row.mode_of_payment == self.mode else None
		self.profile.save()
		frappe.clear_document_cache("POS Profile", self.profile.name)
		self._ready()
		self.quote = self._preview()
		self.total = self.quote["invoice"]["totals"]["grand_total"]

	def _start(self, amount=None, **changes):
		return gateway_api.initiate_stk_gateway_payment(
			**{
				"pos_profile": self.profile.name,
				"mode_of_payment": self.mode,
				"amount": self.total if amount is None else amount,
				"phone_number": "254700000000",
				"customer": self.quote["session"]["customer"],
				"currency": self.quote["invoice"]["price_list_currency"],
				"restaurant_session": self.session,
				"bill_fingerprint": self.quote["fingerprint"],
				"idempotency_key": str(uuid4()),
				**changes,
			}
		)

	def _paid(self, amount=None):
		response = self._start(amount)
		self.assertTrue(response["ok"], response)
		link = frappe.get_doc(payments.LINK, response["data"]["name"])
		frappe.db.set_value(
			"KE Payment Request",
			link.source_name,
			{
				"status": "Completed",
				"transaction_id": f"TEST-{uuid4().hex[:10]}",
				"callback_received_on": now_datetime(),
			},
		)
		return gateway._sync_link_from_source(link)

	def test_restaurant_payment_requires_visit_and_current_bill_review(self):
		self.assertEqual(
			self._start(restaurant_session=None)["errors"][0]["code"], "SESSION_PAYMENT_CONTEXT_REQUIRED"
		)
		self.assertEqual(self._start(bill_fingerprint="stale")["errors"][0]["code"], "SESSION_BILL_CHANGED")

	def test_walkout_cannot_ignore_a_pending_payment(self):
		self.assertTrue(self._start()["ok"])
		response = restaurant.record_walkout(
			self.session, self.profile.name, self.quote["fingerprint"], "Guests left"
		)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "WALKOUT_PAYMENT_UNCONFIRMED")

	def test_walkout_preserves_confirmed_partial_receipt(self):
		link = self._paid(self.total / 2)
		response = restaurant.record_walkout(
			self.session, self.profile.name, self.quote["fingerprint"], "Guests left with a balance"
		)
		self.assertTrue(response["ok"], response)
		self.assertAlmostEqual(response["data"]["invoice"]["totals"]["outstanding_amount"], self.total / 2)
		self.assertTrue(frappe.db.get_value(payments.LINK, link.name, "consumed"))

	def test_fully_received_payment_cannot_be_recorded_as_a_walkout(self):
		self._paid()
		response = restaurant.record_walkout(
			self.session, self.profile.name, self.quote["fingerprint"], "Guests left"
		)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "WALKOUT_NOT_UNPAID")

	def test_attempt_commits_before_dispatch_and_reload_reuses_it_despite_new_browser_key(self):
		first, second = self._start(), self._start()
		self.assertTrue(first["ok"], first)
		self.assertTrue(second["ok"], second)
		self.assertEqual(first["data"]["name"], second["data"]["name"])
		self.assertEqual(first["data"]["dispatch_state"], "Queued")
		self.assertEqual(
			frappe.db.get_value("KE Payment Request", first["data"]["source_name"], "docstatus"), 0
		)
		self.assertTrue(any(call.kwargs.get("enqueue_after_commit") for call in self.enqueue.call_args_list))

	def test_pending_payment_cannot_be_ignored_by_cash_checkout_or_cancelled_after_send(self):
		started = self._start()
		name = started["data"]["name"]
		response = self._checkout(self.quote)
		self.assertEqual(response["errors"][0]["code"], "SESSION_PAYMENT_UNRESOLVED")
		frappe.db.set_value(payments.LINK, name, "dispatch_state", "Started")
		self.assertEqual(
			gateway_api.cancel_gateway_payment_link(name)["errors"][0]["code"], "SESSION_PAYMENT_UNCONFIRMED"
		)

	def test_paid_receipt_is_required_and_checkout_failure_does_not_erase_it(self):
		link = self._paid()
		self.assertEqual(self._checkout(self.quote)["errors"][0]["code"], "SESSION_PAYMENT_UNRESOLVED")
		self.assertEqual(self._preview()["gateway_links"][0]["name"], link.name)
		self.assertEqual(frappe.db.get_value(payments.LINK, link.name, "consumed"), 0)

	def test_partial_gateway_receipt_recovers_and_bills_with_cash_remainder(self):
		link = self._paid(self.total / 2)
		quote = self._preview()
		self.assertEqual(quote["gateway_links"][0]["amount"], self.total / 2)
		response = self._checkout(
			quote,
			payments=[
				{"mode_of_payment": self.mode, "amount": self.total / 2, "gateway_payment_link": link.name},
				{"mode_of_payment": self.cash_mode, "amount": self.total / 2},
			],
		)
		self.assertTrue(response["ok"], response)
		self.assertEqual(frappe.db.get_value(payments.LINK, link.name, "consumed"), 1)

	def test_receipt_cannot_be_spent_on_another_visit_with_same_customer_and_profile(self):
		link = self._paid()
		other = restaurant.open_session(
			self.profile.name, str(uuid4()), service_type=self.quote["session"]["service_type"]
		)
		self.assertTrue(other["ok"], other)
		other_session = frappe.get_doc("Restaurant Session", other["data"]["name"])
		with self.assertRaises(frappe.ValidationError) as caught:
			payments.validate_checkout(other_session, self.profile, [{"gateway_payment_link": link.name}])
		self.assertEqual(caught.exception.vuna_error_code, "SESSION_PAYMENT_CONTEXT_MISMATCH")

	def test_late_success_revives_expired_or_cancelled_stk(self):
		link = self._paid()
		for state in ("Expired", "Cancelled", "Failed"):
			link.db_set("status", state)
			self.assertEqual(gateway._sync_link_from_source(link).status, "Paid")

	def test_failed_native_submission_keeps_received_money_for_safe_retry(self):
		link = self._paid()
		from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice

		rows = [{"mode_of_payment": self.mode, "amount": self.total, "gateway_payment_link": link.name}]
		with patch.object(SalesInvoice, "submit", side_effect=frappe.ValidationError("Submission failed")):
			result = self._checkout(self.quote, payments=rows)
		self.assertFalse(result["ok"], result)
		link.reload()
		self.assertFalse(link.consumed)
		self.assertFalse(frappe.db.get_value("KE Payment Request", link.source_name, "reference_docname"))
		self.assertTrue(self._checkout(self.quote, payments=rows)["ok"])

	def test_extra_late_receipt_cannot_be_silently_ignored(self):
		first = self._start()
		self.assertTrue(gateway_api.cancel_gateway_payment_link(first["data"]["name"])["ok"])
		second = self._paid()
		frappe.db.set_value(
			"KE Payment Request",
			first["data"]["source_name"],
			{
				"status": "Completed",
				"transaction_id": "EXTRA-RECEIPT",
				"callback_received_on": now_datetime(),
			},
		)
		quote = self._preview()
		self.assertEqual(len(quote["gateway_links"]), 2)
		result = self._checkout(
			quote,
			payments=[
				{"mode_of_payment": self.mode, "amount": self.total, "gateway_payment_link": second.name}
			],
		)
		self.assertEqual(result["errors"][0]["code"], "SESSION_PAYMENT_UNRESOLVED")

	def test_confirmed_payment_before_worker_start_is_never_prompted_again(self):
		link = self._paid()
		from vuna_payments.vuna_payments.doctype.ke_payment_request.ke_payment_request import KEPaymentRequest

		with patch.object(KEPaymentRequest, "submit") as send:
			payments.dispatch(link.name)
			send.assert_not_called()

	def test_released_c2b_reservation_is_not_reclaimed_by_status_refresh(self):
		source = self._make_c2b_payment(
			self.gateway_account,
			self.mode,
			self.total,
			currency=self.quote["invoice"]["price_list_currency"],
			customer=self.quote["session"]["customer"],
			submit=False,
		)
		link = gateway._create_gateway_link(
			source_doc=source,
			profile=self.profile,
			opening_entry=frappe.get_doc("POS Opening Entry", self.quote["session"]["opening_entry"])
			if self.quote["session"].get("opening_entry")
			else frappe.get_doc("POS Opening Entry", ensure_open_pos_opening_entry(self.profile.name)),
			mode_of_payment=self.mode,
			payment_gateway=self.gateway_account,
			customer=self.quote["session"]["customer"],
			amount=self.total,
			currency=source.currency,
		)
		link.db_set("status", "Expired")
		self.assertEqual(gateway._sync_link_from_source(link).status, "Expired")

	def test_other_shift_can_see_payment_but_needs_explicit_manager_handover(self):
		link = self._paid()
		original = (link.cashier, link.opening_entry, link.pos_profile)
		frappe.db.set_value("POS Opening Entry", link.opening_entry, "status", "Closed")
		ensure_open_pos_opening_entry(self.profile.name)
		quote = self._preview()
		self.assertTrue(quote["gateway_links"][0]["handover_required"])
		self.assertEqual(self._checkout(quote)["errors"][0]["code"], "SESSION_PAYMENT_HANDOVER_REQUIRED")
		result = restaurant.handover_session_payment(
			link.name, self.session, self.profile.name, "Taking over the previous shift's receipt"
		)
		self.assertTrue(result["ok"], result)
		link.reload()
		self.assertEqual((link.cashier, link.opening_entry, link.pos_profile), original)
		self.assertFalse(self._preview()["gateway_links"][0]["handover_required"])
		self.assertTrue(frappe.parse_json(link.handover_history))

	def test_other_cashier_can_review_but_cannot_approve_their_own_handover(self):
		from vunapos.tests.helpers import ensure_test_user

		link = self._paid()
		user = ensure_test_user(
			f"payment-cashier-{self.token}@example.test",
			roles=["Sales User", "VunaPOS Cashier"],
			pos_profile=self.profile.name,
		)
		frappe.set_user(user)
		try:
			quote = self._preview()
			self.assertEqual(quote["gateway_links"][0]["name"], link.name)
			self.assertTrue(quote["gateway_links"][0]["handover_required"])
			response = restaurant.handover_session_payment(
				link.name, self.session, self.profile.name, "Take over"
			)
			self.assertEqual(response["errors"][0]["code"], "PermissionError")
		finally:
			frappe.set_user("Administrator")

	def test_approved_other_till_can_bill_without_rewriting_the_original_shift(self):
		link = self._paid()
		self.profile.reload()
		other = frappe.copy_doc(self.profile)
		other.set("__newname", f"_Test Payment Receiver {self.token}")
		other.insert(ignore_permissions=True)
		ensure_open_pos_opening_entry(other.name)
		response = restaurant.handover_session_payment(
			link.name, self.session, other.name, "Receiver till taking over this bill"
		)
		self.assertTrue(response["ok"], response)
		quote = self._preview(other.name)
		result = self._checkout(
			quote,
			profile=other.name,
			payments=[
				{"mode_of_payment": self.mode, "amount": self.total, "gateway_payment_link": link.name}
			],
		)
		self.assertTrue(result["ok"], result)
		link.reload()
		self.assertEqual(link.pos_profile, self.profile.name)
		self.assertEqual(link.settlement_profile, other.name)

	def test_c2b_attachment_is_visit_owned_and_recovered_after_reload(self):
		source = self._make_c2b_payment(
			self.gateway_account,
			self.mode,
			self.total,
			currency=self.quote["invoice"]["price_list_currency"],
			customer=self.quote["session"]["customer"],
			submit=False,
		)
		result = gateway_api.attach_c2b_gateway_payment(
			pos_profile=self.profile.name,
			mode_of_payment=self.mode,
			transaction_reference=source.transaction_id,
			amount=self.total,
			customer=self.quote["session"]["customer"],
			currency=source.currency,
			restaurant_session=self.session,
			bill_fingerprint=self.quote["fingerprint"],
			idempotency_key=str(uuid4()),
		)
		self.assertTrue(result["ok"], result)
		self.assertEqual(self._preview()["gateway_links"][0]["source_doctype"], "KE C2B Payment Register")
		name = result["data"]["name"]
		self.assertEqual(
			gateway_api.cancel_gateway_payment_link(name)["errors"][0]["code"],
			"GATEWAY_PAYMENT_NOT_CANCELLABLE",
		)
		frappe.db.set_value(payments.LINK, name, "creation", "2020-01-01 00:00:00")
		gateway.expire_stale_gateway_payment_links()
		self.assertEqual(frappe.db.get_value(payments.LINK, name, "status"), "Paid")

	def test_dispatch_unknown_result_is_not_automatically_sent_again(self):
		started = self._start()
		self.assertTrue(started["ok"], started)
		from vuna_payments.vuna_payments.doctype.ke_payment_request.ke_payment_request import KEPaymentRequest

		with (
			patch("frappe.db.commit") as commit,
			patch.object(
				KEPaymentRequest, "submit", side_effect=TimeoutError("Provider result unknown")
			) as send,
		):
			payments.dispatch(started["data"]["name"])
			self.assertTrue(commit.called)
			payments.dispatch(started["data"]["name"])
			self.assertEqual(send.call_count, 1)
		self.assertEqual(
			frappe.db.get_value(payments.LINK, started["data"]["name"], "dispatch_state"), "Uncertain"
		)

	def test_queued_unsent_payment_can_be_cancelled_without_making_a_provider_call(self):
		started = self._start()
		result = gateway_api.cancel_gateway_payment_link(started["data"]["name"])
		self.assertTrue(result["ok"], result)
		self.assertEqual(result["data"]["status"], "Cancelled")

	def test_workflow_draft_keeps_receipt_bound_and_does_not_collect_again(self):
		link = self._paid()
		with patch("vunapos.services.workflow_service.workflow_enabled_for", return_value=True):
			result = self._checkout(
				self.quote,
				payments=[
					{"mode_of_payment": self.mode, "gateway_payment_link": link.name, "amount": self.total}
				],
			)
		self.assertTrue(result["ok"], result)
		self.assertEqual(result["data"]["session"]["status"], "Settling")
		self.assertEqual(
			frappe.db.get_value(payments.LINK, link.name, "consumed_by_name"),
			result["data"]["invoice"]["name"],
		)
		self.assertEqual(self._start()["errors"][0]["code"], "SESSION_NOT_OPEN")
