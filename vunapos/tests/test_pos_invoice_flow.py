import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import nowdate

from vunapos.api.sales import add_item, checkout_invoice, create_invoice
from vunapos.tests.helpers import (
	ensure_open_pos_opening_entry,
	ensure_test_item,
	ensure_test_pos_profile,
	set_invoice_mode,
)


class TestVunaPOSPOSInvoiceFlow(IntegrationTestCase):
	def setUp(self):
		profile = ensure_test_pos_profile()
		frappe.db.set_value("POS Profile", profile, "vunapos_allow_credit_sales", 0, update_modified=False)
		frappe.clear_cache(doctype="POS Profile")

	def test_create_draft_pos_invoice_when_pos_settings_uses_pos_invoice(self):
		profile = ensure_test_pos_profile()
		ensure_open_pos_opening_entry(profile)
		set_invoice_mode("POS Invoice")

		response = create_invoice(pos_profile=profile)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["doctype"], "POS Invoice")
		self.assertEqual(response["data"]["docstatus"], 0)

	def test_submits_fully_unpaid_credit_pos_invoice(self):
		profile = ensure_test_pos_profile()
		frappe.db.set_value("POS Profile", profile, "vunapos_allow_credit_sales", 1, update_modified=False)
		frappe.clear_cache(doctype="POS Profile")
		ensure_open_pos_opening_entry(profile)
		set_invoice_mode("POS Invoice")
		invoice = create_invoice(pos_profile=profile)["data"]
		invoice = add_item(invoice["doctype"], invoice["name"], ensure_test_item(), 1)["data"]

		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[],
			is_credit_sale=True,
			due_date=nowdate(),
		)

		self.assertTrue(response["ok"], response)
		self.assertTrue(response["data"]["is_credit_sale"])
		self.assertEqual(response["data"]["totals"]["paid_amount"], 0)
		self.assertGreater(response["data"]["totals"]["outstanding_amount"], 0)
		self.assertEqual(response["data"]["due_date"], nowdate())
