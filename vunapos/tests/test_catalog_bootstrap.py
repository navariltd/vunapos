import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api.pos import get_pos_bootstrap, ping
from vunapos.tests.helpers import ensure_test_item, ensure_test_pos_profile, set_invoice_mode


class TestVunaPOSPing(IntegrationTestCase):
	def test_ping_returns_server_time(self):
		response = ping()
		self.assertTrue(response["ok"], response)
		self.assertTrue(response["data"]["server_time"])


class TestVunaPOSCatalogueBootstrap(IntegrationTestCase):
	def test_full_bootstrap_returns_online_dependency_set(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")

		response = get_pos_bootstrap(pos_profile=profile)

		self.assertTrue(response["ok"], response)
		data = response["data"]
		self.assertEqual(data["mode"], "full")
		self.assertTrue(data["server_time"])
		self.assertEqual(data["pos_profile"]["name"], profile)
		self.assertIn(item_code, [row["item_code"] for row in data["items"]])
		self.assertIsInstance(data["customers"], list)
		self.assertIsInstance(data["tax_templates"], list)
		self.assertIsInstance(data["item_tax_templates"], list)
		self.assertTrue(data["payment_modes"])
		self.assertEqual(data["pos_session"]["cashier"], frappe.session.user)
		self.assertNotIn("offline_session_ttl_hours", data)
