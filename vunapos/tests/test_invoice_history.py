import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api.sales import checkout_invoice
from vunapos.services.invoice_history_service import get_invoice_details, get_invoice_history
from vunapos.services.invoice_return_service import create_invoice_return, get_return_preview
from vunapos.services.invoice_service import update_item
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
		details = get_invoice_details(pos_profile=self.profile, invoice_name=invoice["name"])
		self.assertEqual(details["name"], invoice["name"])
		self.assertEqual(details["cashier"], frappe.session.user)
		self.assertTrue(details["items"])
		self.assertEqual(details["payments"][0]["mode_of_payment"], mode)

	def test_filters_history_by_customer_and_invoice_number(self):
		history = get_invoice_history(
			pos_profile=self.profile,
			customer="customer-that-does-not-exist",
			invoice="missing-invoice",
			current_shift=0,
		)
		self.assertEqual(history["invoices"], [])
		self.assertEqual(history["summary"]["invoice_count"], 0)

	def test_creates_partial_credit_note_and_prevents_over_return(self):
		invoice = create_invoice_with_item("Sales Invoice")
		invoice = update_item(invoice["doctype"], invoice["name"], invoice["items"][0]["row_name"], 3)
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		mode = frappe.get_doc("POS Profile", self.profile).get("payments")[0].mode_of_payment
		response = checkout_invoice(
			invoice["doctype"], invoice["name"], payments=[{"mode_of_payment": mode, "amount": amount}]
		)
		self.assertTrue(response["ok"], response)

		preview = get_return_preview(self.profile, invoice["name"])
		self.assertEqual(preview["items"][0]["returnable_qty"], 3)
		key = frappe.generate_hash(length=20)
		result = create_invoice_return(
			self.profile,
			invoice["name"],
			[{"row_name": invoice["items"][0]["row_name"], "qty": 1}],
			"Customer returned the item",
			key,
		)
		credit_note = frappe.get_doc("Sales Invoice", result["invoice"]["name"])
		self.assertEqual(credit_note.return_against, invoice["name"])
		self.assertEqual(credit_note.items[0].qty, -1)
		self.assertEqual(credit_note.vunapos_opening_entry, self.opening_entry)
		self.assertIn("Customer returned the item", credit_note.remarks)

		preview = get_return_preview(self.profile, invoice["name"])
		self.assertEqual(preview["items"][0]["returnable_qty"], 2)
		duplicate = create_invoice_return(
			self.profile,
			invoice["name"],
			[{"row_name": invoice["items"][0]["row_name"], "qty": 1}],
			"Retry",
			key,
		)
		self.assertTrue(duplicate["duplicate"])
		self.assertEqual(duplicate["invoice"]["name"], credit_note.name)

		with self.assertRaises(frappe.ValidationError) as context:
			create_invoice_return(
				self.profile,
				invoice["name"],
				[{"row_name": invoice["items"][0]["row_name"], "qty": 3}],
				"Too many",
				frappe.generate_hash(length=20),
			)
		self.assertEqual(context.exception.vuna_error_code, "RETURN_QUANTITY_EXCEEDED")

	def test_partial_payment_return_matches_erpnext_desk_refund(self):
		frappe.db.set_value("POS Profile", self.profile, "allow_partial_payment", 1, update_modified=False)
		try:
			invoice = create_invoice_with_item("Sales Invoice")
			invoice = update_item(invoice["doctype"], invoice["name"], invoice["items"][0]["row_name"], 3)
			mode = frappe.get_doc("POS Profile", self.profile).get("payments")[0].mode_of_payment
			response = checkout_invoice(
				invoice["doctype"], invoice["name"], payments=[{"mode_of_payment": mode, "amount": 150}]
			)
			self.assertTrue(response["ok"], response)
			self.assertEqual(frappe.db.get_value("Sales Invoice", invoice["name"], "outstanding_amount"), 150)

			result = create_invoice_return(
				self.profile,
				invoice["name"],
				[{"row_name": invoice["items"][0]["row_name"], "qty": 1}],
				"Partial sale return",
				frappe.generate_hash(length=20),
			)
			credit_note = frappe.get_doc("Sales Invoice", result["invoice"]["name"])
			self.assertEqual(credit_note.grand_total, -100)
			self.assertEqual(credit_note.paid_amount, -100)
			self.assertEqual(credit_note.payments[0].amount, -100)
			self.assertEqual(credit_note.outstanding_amount, 0)
			self.assertEqual(frappe.db.get_value("Sales Invoice", invoice["name"], "outstanding_amount"), 150)
		finally:
			frappe.db.set_value(
				"POS Profile", self.profile, "allow_partial_payment", 0, update_modified=False
			)
