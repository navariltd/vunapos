import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api.item import search_items
from vunapos.tests.helpers import (
	ensure_test_customer,
	ensure_test_item,
	ensure_test_pos_profile,
	ensure_test_sales_uom_item,
)


class TestVunaPOSItem(IntegrationTestCase):
	def test_search_items_by_name(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()

		response = search_items(query="VunaPOS Item", pos_profile=profile)

		self.assertTrue(response["ok"], response)
		self.assertIn(item_code, [item["item_code"] for item in response["data"]])

	def test_search_items_by_barcode(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()

		response = search_items(query="VUNA-POS-BARCODE", pos_profile=profile)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"][0]["item_code"], item_code)
		self.assertEqual(response["data"][0]["barcode"], "VUNA-POS-BARCODE")

	def test_catalogue_applies_quantity_one_price_rule(self):
		profile_name = ensure_test_pos_profile()
		profile = frappe.get_doc("POS Profile", profile_name)
		item_code = ensure_test_item()
		rule = frappe.get_doc(
			{
				"doctype": "Pricing Rule",
				"title": "_Test VunaPOS Catalogue Discount",
				"company": profile.company,
				"apply_on": "Item Code",
				"items": [{"item_code": item_code}],
				"selling": 1,
				"currency": profile.currency,
				"price_or_product_discount": "Price",
				"rate_or_discount": "Discount Percentage",
				"discount_percentage": 10,
				"priority": 1,
			}
		).insert(ignore_permissions=True)
		self.addCleanup(lambda: frappe.delete_doc("Pricing Rule", rule.name, force=True))

		response = search_items(query=item_code, pos_profile=profile_name)

		self.assertTrue(response["ok"], response)
		item = next(row for row in response["data"] if row["item_code"] == item_code)
		self.assertEqual(item["price_list_rate"], 100)
		self.assertEqual(item["rate"], 90)
		self.assertEqual(item["pricing_rule"]["discount_percentage"], 10)
		self.assertIn(rule.name, item["pricing_rule"]["pricing_rules"])

	def test_catalogue_describes_eligible_product_discount(self):
		profile_name = ensure_test_pos_profile()
		profile = frappe.get_doc("POS Profile", profile_name)
		item_code = ensure_test_item()
		rule = frappe.get_doc(
			{
				"doctype": "Pricing Rule",
				"title": "_Test VunaPOS Catalogue Free Item",
				"company": profile.company,
				"apply_on": "Item Code",
				"items": [{"item_code": item_code}],
				"selling": 1,
				"currency": profile.currency,
				"price_or_product_discount": "Product",
				"same_item": 1,
				"free_qty": 1,
				"rate_or_discount": "Discount Percentage",
				"priority": 1,
			}
		).insert(ignore_permissions=True)
		self.addCleanup(lambda: frappe.delete_doc("Pricing Rule", rule.name, force=True))

		response = search_items(query=item_code, pos_profile=profile_name)

		self.assertTrue(response["ok"], response)
		item = next(row for row in response["data"] if row["item_code"] == item_code)
		self.assertEqual(item["pricing_rule"]["kind"], "product")
		self.assertEqual(item["pricing_rule"]["free_items"][0]["item_code"], item_code)
		self.assertEqual(item["pricing_rule"]["free_items"][0]["qty"], 1)

	def test_catalogue_uses_item_sales_uom_and_conversion(self):
		profile_name = ensure_test_pos_profile()
		item_code = ensure_test_sales_uom_item()

		response = search_items(query=item_code, pos_profile=profile_name)

		self.assertTrue(response["ok"], response)
		item = next(row for row in response["data"] if row["item_code"] == item_code)
		self.assertEqual(item["uom"], "Box")
		self.assertEqual(item["sales_uom"], "Box")
		self.assertEqual(item["conversion_factor"], 18)

	def test_catalogue_applies_customer_pricing_rule_for_sales_uom(self):
		profile_name = ensure_test_pos_profile()
		profile = frappe.get_doc("POS Profile", profile_name)
		customer = ensure_test_customer()
		item_code = ensure_test_sales_uom_item("_Test Vuna Customer Sales UOM Item")
		rule = frappe.get_doc(
			{
				"doctype": "Pricing Rule",
				"title": "_Test VunaPOS Customer UOM Rate",
				"company": profile.company,
				"apply_on": "Item Code",
				"items": [{"item_code": item_code, "uom": "Box"}],
				"selling": 1,
				"applicable_for": "Customer",
				"customer": customer,
				"currency": profile.currency,
				"price_or_product_discount": "Price",
				"rate_or_discount": "Rate",
				"rate": 77,
				"priority": 20,
			}
		).insert(ignore_permissions=True)
		self.addCleanup(lambda: frappe.delete_doc("Pricing Rule", rule.name, force=True))

		response = search_items(query=item_code, pos_profile=profile_name, customer=customer)

		self.assertTrue(response["ok"], response)
		item = next(row for row in response["data"] if row["item_code"] == item_code)
		self.assertEqual(item["rate"], 77)
		self.assertEqual(item["pricing_rule"]["pricing_rules"], [rule.name])

	def test_catalogue_evaluates_dynamic_pricing_rule_condition(self):
		profile_name = ensure_test_pos_profile()
		profile = frappe.get_doc("POS Profile", profile_name)
		customer = ensure_test_customer()
		item_code = ensure_test_item()
		rule = frappe.get_doc(
			{
				"doctype": "Pricing Rule",
				"title": "_Test VunaPOS Dynamic Customer Discount",
				"company": profile.company,
				"apply_on": "Item Code",
				"items": [{"item_code": item_code}],
				"selling": 1,
				"currency": profile.currency,
				"price_or_product_discount": "Price",
				"rate_or_discount": "Discount Percentage",
				"discount_percentage": 15,
				"condition": f"customer == {customer!r}",
				"priority": 1,
			}
		).insert(ignore_permissions=True)
		self.addCleanup(lambda: frappe.delete_doc("Pricing Rule", rule.name, force=True))

		response = search_items(query=item_code, pos_profile=profile_name, customer=customer)

		self.assertTrue(response["ok"], response)
		item = next(row for row in response["data"] if row["item_code"] == item_code)
		self.assertEqual(item["rate"], 85)
		self.assertEqual(item["pricing_rule"]["discount_percentage"], 15)
