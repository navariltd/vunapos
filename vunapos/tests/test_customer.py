from frappe.tests import IntegrationTestCase

from vunapos.api.customer import search_customers
from vunapos.tests.helpers import ensure_test_customer


class TestVunaPOSCustomer(IntegrationTestCase):
	def test_search_customers_by_name(self):
		customer = ensure_test_customer()

		response = search_customers(query="_Test Customer")

		self.assertTrue(response["ok"], response)
		self.assertIn(customer, [row["customer"] for row in response["data"]])
