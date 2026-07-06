from frappe.tests import IntegrationTestCase

from vunapos.api.profile import get_bootstrap_data
from vunapos.tests.helpers import ensure_test_pos_profile, set_invoice_mode


class TestVunaPOSProfile(IntegrationTestCase):
	def test_bootstrap_returns_pos_profile_defaults(self):
		profile = ensure_test_pos_profile()
		set_invoice_mode("Sales Invoice")

		response = get_bootstrap_data(pos_profile=profile)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["pos_profile"], profile)
		self.assertEqual(response["data"]["invoice_mode"], "Sales Invoice")
		self.assertTrue(response["data"]["company"])
		self.assertTrue(response["data"]["warehouse"])
		self.assertTrue(response["data"]["price_list"])
		self.assertTrue(response["data"]["modes_of_payment"])
