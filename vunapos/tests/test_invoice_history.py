import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api.sales import checkout_invoice
from vunapos.services.invoice_history_service import get_invoice_history
from vunapos.tests.helpers import (
	create_invoice_with_item,
	ensure_open_pos_opening_entry,
	ensure_test_customer,
	ensure_test_pos_profile,
)


class TestVunaPOSInvoiceHistory(IntegrationTestCase):
	def setUp(self):
		self.profile = ensure_test_pos_profile()
		self.customer = ensure_test_customer()
		self.opening_entry = ensure_open_pos_opening_entry(self.profile)

	def test_lists_submitted_vunapos_invoice_in_current_shift(self):
		invoice = create_invoice_with_item("Sales Invoice")
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		mode = frappe.get_doc("POS Profile", self.profile).get("payments")[0].mode_of_payment
		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": mode, "amount": amount}],
		)
		self.assertTrue(response["ok"], response)

		history = get_invoice_history(pos_profile=self.profile, current_shift=1)
		row = next(value for value in history["invoices"] if value["name"] == invoice["name"])
		self.assertEqual(row["status"], "Paid")
		self.assertEqual(row["vunapos_opening_entry"], self.opening_entry)
		self.assertEqual(row["payments"][0]["mode_of_payment"], mode)
		self.assertGreaterEqual(history["summary"]["gross_sales"], amount)

	def test_filters_history_by_customer_and_invoice_number(self):
		history = get_invoice_history(
			pos_profile=self.profile,
			customer="customer-that-does-not-exist",
			invoice="missing-invoice",
			current_shift=0,
		)
		self.assertEqual(history["invoices"], [])
		self.assertEqual(history["summary"]["invoice_count"], 0)
