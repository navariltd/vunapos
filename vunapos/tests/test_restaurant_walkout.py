from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.tests import test_restaurant_billing as fixtures
from vunapos.tests.helpers import set_invoice_mode


class TestRestaurantWalkout(IntegrationTestCase):
	_item = fixtures.TestRestaurantBilling._item
	_raw_item = fixtures.TestRestaurantBilling._raw_item
	_station = fixtures.TestRestaurantBilling._station
	_send = fixtures.TestRestaurantBilling._send
	_tickets = fixtures.TestRestaurantBilling._tickets
	_ready = fixtures.TestRestaurantBilling._ready
	_preview = fixtures.TestRestaurantBilling._preview
	_checkout = fixtures.TestRestaurantBilling._checkout
	tearDown = fixtures.TestRestaurantBilling.tearDown

	def setUp(self):
		fixtures.TestRestaurantBilling.setUp(self)
		frappe.db.set_value("POS Profile", self.profile.name, "vunapos_allow_credit_sales", 0)
		frappe.clear_document_cache("POS Profile", self.profile.name)
		self._ready()

	def _walkout(self, quote=None, reason="Guests left without paying"):
		quote = quote or self._preview()
		return restaurant.record_walkout(self.session, self.profile.name, quote["fingerprint"], reason)

	def _dine_in(self):
		from vunapos.services.service_type_service import get_profile_service_types

		floor = frappe.get_doc(
			{
				"doctype": "Restaurant Floor",
				"floor_name": f"Walkout {uuid4().hex[:8]}",
				"restaurant": self.profile.vunapos_restaurant,
				"branch": self.profile.vunapos_branch,
			}
		).insert()
		table = frappe.get_doc(
			{"doctype": "Restaurant Table", "floor": floor.name, "table_label": "1"}
		).insert()
		service = next(
			row["name"] for row in get_profile_service_types(self.profile) if row["requires_table"]
		)
		opened = restaurant.open_session(
			self.profile.name, str(uuid4()), tables=[table.name], service_type=service
		)
		self.assertTrue(opened["ok"], opened)
		self.session = opened["data"]["name"]
		self._ready()
		return table.name

	def test_manager_preserves_unpaid_invoice_without_enabling_credit_sales(self):
		customer = frappe.db.get_value("Restaurant Session", self.session, "customer")
		response = self._walkout()
		self.assertTrue(response["ok"], response)
		invoice = response["data"]["invoice"]
		doc = frappe.get_doc(invoice["doctype"], invoice["name"])
		self.assertEqual(doc.docstatus, 1)
		self.assertEqual(doc.customer, customer)
		self.assertEqual(doc.paid_amount, 0)
		self.assertGreater(doc.outstanding_amount, 0)
		self.assertEqual(response["data"]["session"]["status"], "Settled")
		self.assertEqual(response["data"]["session"]["walkout_by"], "Administrator")
		self.assertEqual(response["data"]["session"]["walkout_reason"], "Guests left without paying")
		self.assertTrue(response["data"]["session"]["walkout_at"])
		self.assertFalse(frappe.db.get_value("POS Profile", self.profile.name, "vunapos_allow_credit_sales"))
		self.assertEqual(
			frappe.db.get_value(
				"Bin", {"item_code": self.item, "warehouse": self.profile.warehouse}, "actual_qty"
			),
			0,
		)

	def test_pos_invoice_uses_native_unpaid_billing(self):
		set_invoice_mode("POS Invoice")
		result = self._walkout()
		self.assertTrue(result["ok"], result)
		self.assertEqual(result["data"]["invoice"]["doctype"], "POS Invoice")
		self.assertGreater(result["data"]["invoice"]["totals"]["outstanding_amount"], 0)

	def test_cashier_without_manager_role_cannot_record_walkout(self):
		quote = self._preview()
		with patch("frappe.get_roles", return_value=["Sales User", "VunaPOS Cashier"]):
			response = self._walkout(quote)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "PermissionError")

	def test_manager_without_cashier_role_cannot_bypass_billing_permissions(self):
		quote = self._preview()
		with patch("frappe.get_roles", return_value=["VunaPOS Restaurant Manager"]):
			response = self._walkout(quote)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "PermissionError")

	def test_reason_is_required_and_ordinary_credit_checkout_stays_blocked(self):
		self.assertEqual(self._walkout(reason=" ")["errors"][0]["code"], "WALKOUT_REASON_REQUIRED")
		quote = self._preview()
		response = restaurant.checkout_session(
			self.session,
			self.profile.name,
			quote["fingerprint"],
			[],
			is_credit_sale=True,
			due_date=frappe.utils.nowdate(),
		)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "CREDIT_SALES_NOT_ALLOWED")
		self.assertFalse(frappe.db.get_value("Restaurant Session", self.session, "walkout_reason"))

	def test_retry_returns_original_bill_and_reason_cannot_be_rewritten(self):
		first = self._walkout()
		self.assertTrue(first["ok"], first)
		second = self._walkout({"fingerprint": "previous-review"})
		self.assertTrue(second["ok"], second)
		self.assertEqual(first["data"]["invoice"]["name"], second["data"]["invoice"]["name"])
		self.assertEqual(
			self._walkout({"fingerprint": "old"}, "Different reason")["errors"][0]["code"],
			"WALKOUT_BILL_EXISTS",
		)

	def test_workflow_draft_retains_visit_until_native_submission(self):
		self._dine_in()
		with patch("vunapos.services.workflow_service.workflow_enabled_for", return_value=True):
			response = self._walkout()
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["session"]["status"], "Settling")
		self.assertEqual(response["data"]["invoice"]["docstatus"], 0)
		self.assertFalse(response["data"]["session"]["tables"][0]["released_at"])
		doc = frappe.get_doc("Sales Invoice", response["data"]["invoice"]["name"])
		doc.submit()
		self.assertEqual(frappe.db.get_value("Restaurant Session", self.session, "status"), "Settled")
		self.assertTrue(frappe.get_doc("Restaurant Session", self.session).tables[0].released_at)

	def test_submitted_walkout_releases_the_table_and_keeps_assignment_history(self):
		self._dine_in()
		response = self._walkout()
		self.assertTrue(response["ok"], response)
		self.assertTrue(response["data"]["session"]["tables"][0]["released_at"])

	def test_boolean_flag_cannot_impersonate_server_walkout_authorization(self):
		from vunapos.services.invoice_service import _validate_credit_sale_request

		doc = frappe.get_doc(
			{
				"doctype": "Sales Invoice",
				"customer": self.profile.customer,
				"vunapos_restaurant_session": self.session,
			}
		)
		doc.flags.restaurant_walkout_approval = True
		with self.assertRaises(frappe.ValidationError):
			_validate_credit_sale_request(self.profile, True, self.profile.customer, doc=doc)

	def test_failed_submission_rolls_back_invoice_and_incident(self):
		with patch(
			"frappe.model.document.Document.submit",
			side_effect=frappe.ValidationError("Native submission failed"),
		):
			response = self._walkout()
		self.assertFalse(response["ok"], response)
		self.assertFalse(frappe.db.exists("Sales Invoice", {"vunapos_restaurant_session": self.session}))
		self.assertFalse(frappe.db.get_value("Restaurant Session", self.session, "walkout_reason"))
		self.assertEqual(frappe.db.get_value("Restaurant Session", self.session, "status"), "Open")

	def test_pos_workflow_can_reload_approved_bill_without_enabling_credit(self):
		set_invoice_mode("POS Invoice")
		with patch("vunapos.services.workflow_service.workflow_enabled_for", return_value=True):
			response = self._walkout()
		self.assertTrue(response["ok"], response)
		doc = frappe.get_doc("POS Invoice", response["data"]["invoice"]["name"])
		doc.submit()
		self.assertEqual(frappe.db.get_value("Restaurant Session", self.session, "status"), "Settled")

	def test_changed_orders_require_a_fresh_review(self):
		quote = self._preview()
		self._ready(1)
		response = self._walkout(quote)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "SESSION_BILL_CHANGED")
