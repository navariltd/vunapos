from frappe.tests import IntegrationTestCase

from vunapos.api.sales import create_invoice
from vunapos.tests.helpers import ensure_open_pos_opening_entry, ensure_test_pos_profile, set_invoice_mode


class TestVunaPOSPOSInvoiceFlow(IntegrationTestCase):
	def test_create_draft_pos_invoice_when_pos_settings_uses_pos_invoice(self):
		profile = ensure_test_pos_profile()
		ensure_open_pos_opening_entry(profile)
		set_invoice_mode("POS Invoice")

		response = create_invoice(pos_profile=profile)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["doctype"], "POS Invoice")
		self.assertEqual(response["data"]["docstatus"], 0)
