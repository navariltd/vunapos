from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.services.invoice_service import set_payment_rows, validate_payment_rows
from vunapos.services.payment_settings import (
	ensure_bank_payment_reference_default,
	require_bank_payment_reference,
)


class TestBankPaymentReferences(IntegrationTestCase):
	def setUp(self):
		self.profile = frappe._dict(
			company="Test Company", payments=[frappe._dict(mode_of_payment="Bank transfer")]
		)
		self.doc = frappe._dict(
			doctype="POS Invoice", posting_date="2026-11-25", rounded_total=100, grand_total=100
		)
		self.doc.precision = lambda _field: 2
		for target, value in (("_payment_mode_requires_reference", True), ("_payment_mode_type", "Bank")):
			mock = patch(f"vunapos.services.invoice_service.{target}", return_value=value)
			mock.start()
			self.addCleanup(mock.stop)

	def _validate(self, reference=None, required=True, date=None):
		row = {"mode_of_payment": "Bank transfer", "amount": 100}
		if reference is not None:
			row["reference_no"] = reference
		if date is not None:
			row["reference_date"] = date
		with patch("vunapos.services.invoice_service.require_bank_payment_reference", return_value=required):
			return validate_payment_rows(self.doc, [row], self.profile)

	def test_setting_defaults_off_and_preserves_explicit_on(self):
		field = frappe.get_meta("POS Settings").get_field("vunapos_require_bank_payment_reference")
		self.assertIsNotNone(field)
		self.assertEqual(str(field.default), "0")
		self.assertEqual(field.insert_after, "vunapos_checkout_fields")
		for value, expected in ((None, False), ("0", False), (0, False), ("1", True), (1, True)):
			with patch(
				"frappe.db.get_singles_dict", return_value={"vunapos_require_bank_payment_reference": value}
			):
				self.assertEqual(require_bank_payment_reference(), expected)

	def test_setup_initializes_off_without_overwriting_existing_choices(self):
		for value in (None, "", "0", "1"):
			with (
				patch(
					"frappe.db.get_singles_dict",
					return_value={"vunapos_require_bank_payment_reference": value},
				),
				patch("frappe.db.set_single_value") as set_value,
			):
				ensure_bank_payment_reference_default()
				if value in (None, ""):
					set_value.assert_called_once_with(
						"POS Settings", "vunapos_require_bank_payment_reference", 0
					)
				else:
					set_value.assert_not_called()

	def test_required_reference_is_checked_without_a_cashier_date(self):
		with self.assertRaises(frappe.ValidationError) as error:
			self._validate()
		self.assertEqual(error.exception.vuna_error_code, "PAYMENT_REFERENCE_REQUIRED")
		row = self._validate("  BANK-123  ")[0]
		self.assertEqual(row["reference_no"], "BANK-123")
		self.assertEqual(row["reference_date"], "2026-11-25")

	def test_optional_invoice_reference_can_be_empty_but_is_not_discarded_when_entered(self):
		for doctype in ("Sales Invoice", "POS Invoice"):
			self.doc.doctype = doctype
			self.assertIsNone(self._validate(required=False)[0]["reference_no"])
			row = self._validate("BANK-456", required=False)[0]
			self.assertEqual(row["reference_no"], "BANK-456")
			self.assertEqual(row["reference_date"], "2026-11-25")

	def test_sales_order_bank_advance_remains_required_when_setting_is_off(self):
		self.doc.doctype = "Sales Order"
		self.doc.posting_date = None
		self.doc.transaction_date = "2026-11-24"
		with self.assertRaises(frappe.ValidationError) as error:
			self._validate(required=False)
		self.assertEqual(error.exception.vuna_error_code, "PAYMENT_REFERENCE_REQUIRED")
		self.assertEqual(self._validate("ADV-123", required=False)[0]["reference_date"], "2026-11-24")

	def test_supplied_api_dates_remain_validated(self):
		with self.assertRaises(frappe.ValidationError) as error:
			self._validate("BANK-123", date="invalid-date")
		self.assertEqual(error.exception.vuna_error_code, "PAYMENT_REFERENCE_DATE_INVALID")
		self.assertEqual(self._validate("BANK-123", date="2026-11-23")[0]["reference_date"], "2026-11-23")

	def test_native_invoice_payment_rows_keep_the_reference(self):
		for doctype in ("Sales Invoice", "POS Invoice"):
			doc = frappe.new_doc(doctype)
			set_payment_rows(doc, self._validate("BANK-789"), profile=self.profile)
			self.assertEqual(doc.payments[0].reference_no, "BANK-789")
