from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api.profile import get_bootstrap_data
from vunapos.services.profile_service import resolve_pos_profile
from vunapos.tests.helpers import ensure_test_pos_profile, set_invoice_mode


class TestVunaPOSProfile(IntegrationTestCase):
	def test_default_profile_prefers_the_cashiers_open_session(self):
		with (
			patch(
				"vunapos.services.profile_service.frappe.get_all",
				side_effect=[
					["Counter 2", "Counter 1"],
					["Counter 1", "Counter 2"],
				],
			),
			patch(
				"vunapos.services.profile_service.frappe.db.get_value",
				return_value="Counter 1",
			) as get_value,
			patch("vunapos.services.profile_service._require_profile_read"),
			patch(
				"vunapos.services.profile_service.frappe.get_cached_doc",
				return_value=frappe._dict(name="Counter 1", disabled=0),
			),
		):
			profile = resolve_pos_profile()

		self.assertEqual(profile.name, "Counter 1")
		get_value.assert_called_once_with(
			"POS Opening Entry",
			{
				"user": frappe.session.user,
				"pos_profile": ["in", ["Counter 1", "Counter 2"]],
				"status": "Open",
				"docstatus": 1,
			},
			"pos_profile",
			order_by="period_start_date desc",
		)

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
		self.assertIsInstance(response["data"]["allow_price_list_switching"], bool)
		self.assertIsInstance(response["data"]["allowed_price_lists"], list)
		self.assertTrue(response["data"]["modes_of_payment"])
		self.assertIsInstance(response["data"]["currency_precision"], int)
		self.assertGreaterEqual(response["data"]["currency_precision"], 0)
		self.assertIsInstance(response["data"]["allow_partial_payment"], bool)
		self.assertIsInstance(response["data"]["allow_credit_sales"], bool)
		self.assertIn(response["data"]["default_sale_type"], ("Cash Sale", "Credit Sale"))
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

	def test_credit_sale_default_is_exposed_only_when_credit_sales_are_allowed(self):
		profile = ensure_test_pos_profile()
		frappe.db.set_value(
			"POS Profile",
			profile,
			{
				"vunapos_allow_credit_sales": 0,
				"vunapos_default_sale_type": "Credit Sale",
			},
			update_modified=False,
		)
		frappe.clear_cache(doctype="POS Profile")

		disabled = get_bootstrap_data(pos_profile=profile)
		self.assertFalse(disabled["data"]["allow_credit_sales"])
		self.assertEqual(disabled["data"]["default_sale_type"], "Cash Sale")

		frappe.db.set_value("POS Profile", profile, "vunapos_allow_credit_sales", 1, update_modified=False)
		frappe.clear_cache(doctype="POS Profile")
		enabled = get_bootstrap_data(pos_profile=profile)
		self.assertTrue(enabled["data"]["allow_credit_sales"])
		self.assertEqual(enabled["data"]["default_sale_type"], "Credit Sale")
