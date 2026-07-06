from frappe.tests import IntegrationTestCase

from vunapos.api.print import render_invoice
from vunapos.tests.helpers import create_invoice_with_item


class TestVunaPOSPrint(IntegrationTestCase):
	def test_render_invoice_print_html(self):
		invoice = create_invoice_with_item("Sales Invoice")

		response = render_invoice(invoice["doctype"], invoice["name"])

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["invoice_doctype"], invoice["doctype"])
		self.assertEqual(response["data"]["invoice_name"], invoice["name"])
		self.assertIn("<", response["data"]["html"])
