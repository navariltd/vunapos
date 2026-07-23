from frappe.tests import IntegrationTestCase

from vunapos.api.customer import get_customer_directory, search_customers
from vunapos.tests.helpers import ensure_test_customer, ensure_test_pos_profile


class TestVunaPOSCustomer(IntegrationTestCase):
	def test_search_customers_by_name(self):
		customer = ensure_test_customer()

		response = search_customers(query="_Test Customer")

		self.assertTrue(response["ok"], response)
		self.assertIn(customer, [row["customer"] for row in response["data"]])

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
