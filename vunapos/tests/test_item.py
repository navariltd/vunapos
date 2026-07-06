from frappe.tests import IntegrationTestCase

from vunapos.api.item import search_items
from vunapos.tests.helpers import ensure_test_item, ensure_test_pos_profile


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
