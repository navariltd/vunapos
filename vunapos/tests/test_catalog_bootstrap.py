import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api.pos import get_pos_bootstrap, ping
from vunapos.tests.helpers import (
	ensure_item_tax_template,
	ensure_sales_tax_template,
	ensure_test_item,
	ensure_test_pos_profile,
	set_invoice_mode,
	set_profile_tax_template,
)


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

	def test_catalogue_exposes_item_tax_price_breakdown(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		item_tax_template = ensure_item_tax_template(item_code, rate=10)
		previous = frappe.db.get_value("POS Profile", profile, "vunapos_item_prices_include_tax")
		previous_tax_template = frappe.db.get_value("POS Profile", profile, "taxes_and_charges")
		try:
			set_profile_tax_template(profile, None)
			frappe.db.set_value("POS Profile", profile, "vunapos_item_prices_include_tax", 0)
			frappe.clear_cache(doctype="POS Profile")
			response = get_pos_bootstrap(pos_profile=profile)
			self.assertTrue(response["ok"], response)
			item = next(row for row in response["data"]["items"] if row["item_code"] == item_code)
			self.assertEqual(item["item_tax"]["template"], item_tax_template)
			self.assertFalse(item["item_tax"]["inclusive"])
			self.assertAlmostEqual(item["item_tax"]["gross_rate"], item["rate"] * 1.1, places=2)

			frappe.db.set_value("POS Profile", profile, "vunapos_item_prices_include_tax", 1)
			frappe.clear_cache(doctype="POS Profile")
			inclusive_response = get_pos_bootstrap(pos_profile=profile)
			inclusive_item = next(
				row for row in inclusive_response["data"]["items"] if row["item_code"] == item_code
			)
			self.assertTrue(inclusive_item["item_tax"]["inclusive"])
			self.assertAlmostEqual(inclusive_item["item_tax"]["gross_rate"], inclusive_item["rate"], places=2)

			frappe.db.set_value("POS Profile", profile, "vunapos_item_prices_include_tax", 0)
			set_profile_tax_template(profile, ensure_sales_tax_template(rate=5, included_in_print_rate=1))
			frappe.clear_cache(doctype="POS Profile")
			profile_tax_response = get_pos_bootstrap(pos_profile=profile)
			profile_tax_item = next(
				row for row in profile_tax_response["data"]["items"] if row["item_code"] == item_code
			)
			self.assertTrue(profile_tax_item["item_tax"]["inclusive"])
			self.assertEqual(profile_tax_item["item_tax"]["inclusive_tax_rate"], 10)
			self.assertAlmostEqual(
				profile_tax_item["item_tax"]["gross_rate"], profile_tax_item["rate"], places=2
			)
		finally:
			frappe.db.set_value("POS Profile", profile, "vunapos_item_prices_include_tax", previous)
			set_profile_tax_template(profile, previous_tax_template)
			frappe.clear_cache(doctype="POS Profile")
