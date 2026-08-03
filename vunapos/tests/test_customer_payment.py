from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api.payment import receive_customer_payment
from vunapos.api.sales import checkout_invoice
from vunapos.services.payment_service import (
	allocate_customer_payments,
	get_payment_history,
	reconcile_customer_payment,
	render_payment_receipt,
)
from vunapos.services.payment_service import (
	receive_customer_payment as receive_customer_payment_service,
)
from vunapos.tests.helpers import (
	create_invoice_with_item,
	ensure_open_pos_opening_entry,
	ensure_test_customer,
	ensure_test_pos_profile,
)


class TestVunaPOSCustomerPayment(IntegrationTestCase):
	def setUp(self):
		self.profile = ensure_test_pos_profile()
		frappe.db.set_value(
			"POS Profile",
			self.profile,
			{
				"vunapos_allow_customer_payments": 1,
				"vunapos_allow_payment_reconciliation": 1,
				"vunapos_allow_payment_history": 1,
			},
			update_modified=False,
		)
		profile_doc = frappe.get_doc("POS Profile", self.profile)
		for row in profile_doc.get("payments", []):
			row.payment_gateway = None
		profile_doc.save(ignore_permissions=True)
		frappe.clear_cache(doctype="POS Profile")
		self.customer = ensure_test_customer()
		self.opening_entry = ensure_open_pos_opening_entry(self.profile)
		self.mode = frappe.get_doc("POS Profile", self.profile).get("payments")[0].mode_of_payment

	def test_creates_submitted_unallocated_customer_payment(self):
		key = frappe.generate_hash(length=20)
		response = receive_customer_payment(
			pos_profile=self.profile,
			customer=self.customer,
			amount=100,
			mode_of_payment=self.mode,
			idempotency_key=key,
		)

		self.assertTrue(response["ok"], response)
		payment = frappe.get_doc("Payment Entry", response["data"]["name"])
		self.assertEqual(payment.docstatus, 1)
		self.assertEqual(payment.payment_type, "Receive")
		self.assertEqual(payment.party, self.customer)
		self.assertEqual(payment.vunapos_opening_entry, self.opening_entry)
		self.assertEqual(payment.vunapos_session_cashier, frappe.session.user)
		self.assertEqual(payment.vunapos_idempotency_key, key)
		self.assertEqual(payment.unallocated_amount, 100)
		self.assertEqual(payment.vunapos_receipt_type, "Customer Advance")
		history = get_payment_history(pos_profile=self.profile, customer=self.customer)
		self.assertIn(payment.name, [row["name"] for row in history["payments"]])
		self.assertIn("<html", render_payment_receipt(payment.name)["html"].lower())

	def test_gateway_controlled_customer_payment_requires_verified_link(self):
		payment_row = next(
			row
			for row in frappe.get_doc("POS Profile", self.profile).get("payments", [])
			if row.mode_of_payment == self.mode
		)
		frappe.db.set_value(
			"POS Payment Method",
			payment_row.name,
			"payment_gateway",
			"_Test VunaPOS Gateway Account",
			update_modified=False,
		)
		frappe.clear_cache(doctype="POS Profile")

		response = receive_customer_payment(
			pos_profile=self.profile,
			customer=self.customer,
			amount=100,
			mode_of_payment=self.mode,
			idempotency_key=frappe.generate_hash(length=20),
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "GATEWAY_PAYMENT_REQUIRED")

	def test_receive_payment_respects_profile_operation_setting(self):
		frappe.db.set_value(
			"POS Profile", self.profile, "vunapos_allow_customer_payments", 0, update_modified=False
		)
		frappe.clear_cache(doctype="POS Profile")

		response = receive_customer_payment(
			pos_profile=self.profile,
			customer=self.customer,
			amount=100,
			mode_of_payment=self.mode,
			idempotency_key=frappe.generate_hash(length=20),
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "CUSTOMER_PAYMENTS_DISABLED")

	def test_repeated_idempotency_key_returns_the_same_payment(self):
		key = frappe.generate_hash(length=20)
		params = {
			"pos_profile": self.profile,
			"customer": self.customer,
			"amount": 25,
			"mode_of_payment": self.mode,
			"idempotency_key": key,
		}

		first = receive_customer_payment(**params)
		second = receive_customer_payment(**params)

		self.assertTrue(first["ok"], first)
		self.assertTrue(second["ok"], second)
		self.assertEqual(first["data"]["name"], second["data"]["name"])
		self.assertTrue(second["data"]["duplicate"])
		self.assertEqual(frappe.db.count("Payment Entry", {"vunapos_idempotency_key": key}), 1)

	def test_requires_an_open_cashier_session(self):
		frappe.db.set_value("POS Opening Entry", self.opening_entry, "status", "Closed")
		response = receive_customer_payment(
			pos_profile=self.profile,
			customer=self.customer,
			amount=10,
			mode_of_payment=self.mode,
			idempotency_key=frappe.generate_hash(length=20),
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "POS_OPENING_REQUIRED")

	def test_bank_payment_requires_reference_number_and_date(self):
		company = frappe.db.get_value("POS Profile", self.profile, "company")
		bank_account = frappe.db.get_value(
			"Account", {"company": company, "account_type": "Bank", "is_group": 0}, "name"
		)
		if not bank_account:
			self.skipTest("Test company has no Bank account")
		with patch("vunapos.services.payment_service._mode_account", return_value=bank_account):
			with self.assertRaises(frappe.ValidationError):
				receive_customer_payment_service(
					pos_profile=self.profile,
					customer=self.customer,
					amount=10,
					mode_of_payment=self.mode,
					idempotency_key=frappe.generate_hash(length=20),
				)

	def test_reconciles_one_advance_across_an_outstanding_invoice(self):
		invoice = create_invoice_with_item("Sales Invoice")
		total = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		frappe.db.set_value("POS Profile", self.profile, "allow_partial_payment", 1, update_modified=False)
		try:
			checkout = checkout_invoice(
				invoice["doctype"],
				invoice["name"],
				payments=[{"mode_of_payment": self.mode, "amount": total - 10}],
			)
		finally:
			frappe.db.set_value(
				"POS Profile", self.profile, "allow_partial_payment", 0, update_modified=False
			)
		self.assertTrue(checkout["ok"], checkout)

		advance = receive_customer_payment(
			pos_profile=self.profile,
			customer=self.customer,
			amount=10,
			mode_of_payment=self.mode,
			idempotency_key=frappe.generate_hash(length=20),
		)
		self.assertTrue(advance["ok"], advance)
		preview = allocate_customer_payments(
			pos_profile=self.profile,
			customer=self.customer,
			payment_entries=[advance["data"]["name"]],
			invoices=[invoice["name"]],
		)
		self.assertEqual(preview["allocations"][0]["allocated_amount"], 10)
		result = reconcile_customer_payment(
			pos_profile=self.profile,
			customer=self.customer,
			payment_entries=[advance["data"]["name"]],
			invoices=[invoice["name"]],
		)

		self.assertEqual(result["allocated_amount"], 10)
		self.assertEqual(
			frappe.db.get_value("Payment Entry", advance["data"]["name"], "vunapos_reconciled_opening_entry"),
			self.opening_entry,
		)
		self.assertEqual(
			frappe.db.get_value("Payment Entry", advance["data"]["name"], "unallocated_amount"), 0
		)
		self.assertEqual(frappe.db.get_value("Sales Invoice", invoice["name"], "outstanding_amount"), 0)
		self.assertTrue(
			frappe.db.exists(
				"Comment", {"reference_doctype": "Payment Entry", "reference_name": advance["data"]["name"]}
			)
		)

	def test_reconciliation_respects_profile_operation_setting(self):
		frappe.db.set_value(
			"POS Profile", self.profile, "vunapos_allow_payment_reconciliation", 0, update_modified=False
		)
		frappe.clear_cache(doctype="POS Profile")

		with self.assertRaises(frappe.ValidationError) as context:
			allocate_customer_payments(
				pos_profile=self.profile,
				customer=self.customer,
				payment_entries=["PAYMENT-1"],
				invoices=["SINV-1"],
			)

		self.assertEqual(
			getattr(context.exception, "vuna_error_code", None), "PAYMENT_RECONCILIATION_DISABLED"
		)

	def test_payment_history_respects_profile_operation_setting(self):
		frappe.db.set_value(
			"POS Profile", self.profile, "vunapos_allow_payment_history", 0, update_modified=False
		)
		frappe.clear_cache(doctype="POS Profile")

		with self.assertRaises(frappe.ValidationError) as context:
			get_payment_history(pos_profile=self.profile, customer=self.customer)

		self.assertEqual(getattr(context.exception, "vuna_error_code", None), "PAYMENT_HISTORY_DISABLED")
