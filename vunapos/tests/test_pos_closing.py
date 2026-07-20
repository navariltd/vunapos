import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api.sales import checkout_invoice
from vunapos.services.pos_closing import close_pos_session, get_closing_preview
from vunapos.services.profile_service import get_pos_session
from vunapos.tests.helpers import (
	create_invoice_with_item,
	ensure_open_pos_opening_entry,
	ensure_test_pos_profile,
)


class TestVunaPOSClosing(IntegrationTestCase):
	def setUp(self):
		self.profile = ensure_test_pos_profile()
		self.opening_entry = ensure_open_pos_opening_entry(self.profile)

	def test_preview_uses_current_users_opening_entry(self):
		preview = get_closing_preview(self.profile)

		self.assertEqual(preview["opening_entry"], self.opening_entry)
		self.assertEqual(preview["cashier"], frappe.session.user)
		self.assertTrue(preview["payments"])

	def test_preview_includes_vunapos_sales_invoice_without_erpnext_pos_origin_flag(self):
		invoice = create_invoice_with_item("Sales Invoice")
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		mode_of_payment = frappe.get_doc("POS Profile", self.profile).get("payments")[0].mode_of_payment
		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": mode_of_payment, "amount": amount}],
		)
		self.assertTrue(response["ok"], response)
		self.assertEqual(frappe.db.get_value("Sales Invoice", invoice["name"], "is_created_using_pos"), 0)

		preview = get_closing_preview(self.profile)

		self.assertGreaterEqual(preview["invoice_count"], 1)
		self.assertGreater(preview["grand_total"], 0)
		self.assertIn(invoice["name"], [row["name"] for row in preview["invoices"]])

	def test_close_submits_native_closing_entry_and_ends_session(self):
		invoice = create_invoice_with_item("Sales Invoice")
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		mode_of_payment = frappe.get_doc("POS Profile", self.profile).get("payments")[0].mode_of_payment
		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[{"mode_of_payment": mode_of_payment, "amount": amount}],
		)
		self.assertTrue(response["ok"], response)

		preview = get_closing_preview(self.profile)
		balances = [
			{
				"mode_of_payment": row["mode_of_payment"],
				"closing_amount": row["expected_amount"],
			}
			for row in preview["payments"]
		]

		result = close_pos_session(self.profile, balances)

		self.assertTrue(frappe.db.exists("POS Closing Entry", result["name"]))
		self.assertEqual(frappe.db.get_value("POS Closing Entry", result["name"], "docstatus"), 1)
		closing_entry = frappe.get_doc("POS Closing Entry", result["name"])
		self.assertIn(invoice["name"], [row.sales_invoice for row in closing_entry.sales_invoices])
		self.assertEqual(
			frappe.db.get_value("Sales Invoice", invoice["name"], "pos_closing_entry"), result["name"]
		)
		self.assertEqual(frappe.db.get_value("Sales Invoice", invoice["name"], "is_created_using_pos"), 0)
		self.assertFalse(get_pos_session(frappe.session.user, self.profile)["ready"])

	def test_close_rejects_missing_or_negative_counts(self):
		with self.assertRaises(frappe.ValidationError):
			close_pos_session(self.profile, [])

		preview = get_closing_preview(self.profile)
		balances = [
			{"mode_of_payment": row["mode_of_payment"], "closing_amount": -1} for row in preview["payments"]
		]
		with self.assertRaises(frappe.ValidationError):
			close_pos_session(self.profile, balances)
