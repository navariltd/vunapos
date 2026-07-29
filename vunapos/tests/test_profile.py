import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api.profile import get_bootstrap_data
from vunapos.services.profile_service import resolve_pos_profile
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
		self.assertIsInstance(response["data"]["currency_precision"], int)
		self.assertGreaterEqual(response["data"]["currency_precision"], 0)
		self.assertIsInstance(response["data"]["allow_partial_payment"], bool)
		self.assertIsInstance(response["data"]["item_prices_include_tax"], bool)
		self.assertIn(response["data"]["modes_of_payment"][0]["type"], {"Cash", "Bank", "General", "Phone"})
		self.assertEqual(response["data"]["session"]["cashier"], frappe.session.user)
		self.assertEqual(response["data"]["session"]["pos_profile"], profile)

	def test_explicit_profile_must_be_assigned_to_current_user(self):
		profile_name = ensure_test_pos_profile()
		profile = frappe.get_doc("POS Profile", profile_name)
		profile.set(
			"applicable_for_users",
			[row for row in profile.get("applicable_for_users", []) if row.user != frappe.session.user],
		)
		profile.save(ignore_permissions=True)

		with self.assertRaises(frappe.PermissionError):
			resolve_pos_profile(profile_name)
