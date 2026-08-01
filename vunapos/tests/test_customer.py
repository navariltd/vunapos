import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api.customer import (
	create_customer,
	get_customer_details,
	get_customer_directory,
	get_customer_loyalty,
	search_customers,
)
from vunapos.tests.helpers import ensure_test_customer, ensure_test_pos_profile


class TestVunaPOSCustomer(IntegrationTestCase):
	def test_loyalty_summary_returns_live_erpnext_shape(self):
		customer = ensure_test_customer()
		profile = ensure_test_pos_profile()

		response = get_customer_loyalty(pos_profile=profile, customer=customer)

		self.assertTrue(response["ok"], response)
		data = response["data"]
		self.assertEqual(data["customer"], customer)
		self.assertIsInstance(data["enrolled"], bool)
		self.assertGreaterEqual(data["points"], 0)
		self.assertGreaterEqual(data["redemption_value"], 0)

	def test_search_customers_by_name(self):
		customer = ensure_test_customer()

		response = search_customers(query="_Test Customer")

		self.assertTrue(response["ok"], response)
		self.assertIn(customer, [row["customer"] for row in response["data"]])

	def test_create_customer_respects_profile_operation_setting(self):
		profile = ensure_test_pos_profile()
		frappe.db.set_value(
			"POS Profile", profile, "vunapos_allow_customer_creation", 0, update_modified=False
		)
		frappe.clear_cache(doctype="POS Profile")

		response = create_customer(customer_name="_Test VunaPOS Blocked Customer", pos_profile=profile)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "PermissionError")

	def test_directory_returns_paginated_customer_summaries_and_filter_options(self):
		customer = ensure_test_customer()
		profile = ensure_test_pos_profile()

		response = get_customer_directory(pos_profile=profile, query="_Test Customer", limit=10)

		self.assertTrue(response["ok"], response)
		data = response["data"]
		self.assertIn(customer, [row["customer"] for row in data["customers"]])
		self.assertGreaterEqual(data["total_count"], 1)
		self.assertEqual(data["start"], 0)
		self.assertEqual(data["limit"], 10)
		self.assertIn("customer_groups", data)
		self.assertIn("territories", data)
		self.assertTrue(data["as_of"])

	def test_directory_respects_profile_operation_setting(self):
		profile = ensure_test_pos_profile()
		frappe.db.set_value(
			"POS Profile", profile, "vunapos_allow_customer_management", 0, update_modified=False
		)
		frappe.clear_cache(doctype="POS Profile")

		response = get_customer_directory(pos_profile=profile, query="_Test Customer", limit=10)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "PermissionError")

	def test_details_returns_native_balance_and_customer_history_sections(self):
		customer = ensure_test_customer()
		profile = ensure_test_pos_profile()

		response = get_customer_details(pos_profile=profile, customer=customer)

		self.assertTrue(response["ok"], response)
		data = response["data"]
		self.assertEqual(data["customer"]["customer"], customer)
		self.assertIn("balance", data)
		self.assertIn("loyalty", data)
		self.assertIsInstance(data["invoices"], list)
		self.assertIsInstance(data["payments"], list)
		self.assertTrue(data["as_of"])
