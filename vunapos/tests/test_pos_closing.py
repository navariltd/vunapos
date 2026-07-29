import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import flt, nowdate

from vunapos.api.sales import checkout_invoice
from vunapos.services.payment_service import receive_customer_payment
from vunapos.services.pos_closing import close_pos_session, get_closing_preview
from vunapos.services.profile_service import get_pos_session
from vunapos.tests.helpers import (
	create_invoice_with_item,
	ensure_open_pos_opening_entry,
	ensure_test_customer,
	ensure_test_payment_mode,
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

	def test_preview_reconciles_each_split_payment_mode(self):
		second_mode = ensure_test_payment_mode()
		profile_doc = frappe.get_doc("POS Profile", self.profile)
		if not any(row.mode_of_payment == second_mode for row in profile_doc.get("payments", [])):
			profile_doc.append("payments", {"mode_of_payment": second_mode, "default": 0})
			profile_doc.save(ignore_permissions=True)

		invoice = create_invoice_with_item("Sales Invoice")
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		cash_mode = profile_doc.get("payments")[0].mode_of_payment
		cash_amount = flt(amount / 2)
		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[
				{"mode_of_payment": cash_mode, "amount": cash_amount},
				{"mode_of_payment": second_mode, "amount": flt(amount - cash_amount)},
			],
		)
		self.assertTrue(response["ok"], response)

		preview = get_closing_preview(self.profile)
		expected_by_mode = {row["mode_of_payment"]: row["expected_amount"] for row in preview["payments"]}
		self.assertGreaterEqual(flt(expected_by_mode[cash_mode]), cash_amount)
		self.assertGreaterEqual(flt(expected_by_mode[second_mode]), flt(amount - cash_amount))

	def test_preview_separates_customer_receipts_from_shift_sales(self):
		profile = frappe.get_doc("POS Profile", self.profile)
		mode = profile.get("payments")[0].mode_of_payment
		customer = ensure_test_customer()
		payment = receive_customer_payment(
			pos_profile=self.profile,
			customer=customer,
			amount=25,
			mode_of_payment=mode,
			idempotency_key=frappe.generate_hash(length=20),
		)
		self.assertEqual(payment["unallocated_amount"], 25)

		preview = get_closing_preview(self.profile)
		self.assertGreaterEqual(preview["payment_activity"]["customer_advances"], 25)
		self.assertEqual(
			preview["payment_activity"]["cash_received"],
			preview["payment_activity"]["sales_collected"]
			+ preview["payment_activity"]["outstanding_invoice_payments"]
			+ preview["payment_activity"]["customer_advances"],
		)

	def test_preview_reports_credit_sales_without_counting_unpaid_balance_as_cash(self):
		frappe.db.set_value(
			"POS Profile", self.profile, "vunapos_allow_credit_sales", 1, update_modified=False
		)
		frappe.clear_cache(doctype="POS Profile")
		invoice = create_invoice_with_item("Sales Invoice")
		amount = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		response = checkout_invoice(
			invoice["doctype"],
			invoice["name"],
			payments=[],
			is_credit_sale=True,
			due_date=nowdate(),
		)
		self.assertTrue(response["ok"], response)

		preview = get_closing_preview(self.profile)
		self.assertGreaterEqual(preview["payment_activity"]["credit_sales"], amount)
		self.assertGreaterEqual(preview["payment_activity"]["credit_outstanding"], amount)
		self.assertEqual(preview["payment_activity"]["sales_collected"], 0)
		self.assertEqual(preview["payment_activity"]["cash_received"], 0)

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
