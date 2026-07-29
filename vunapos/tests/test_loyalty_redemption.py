from unittest import TestCase
from unittest.mock import patch

import frappe

from vunapos.services.invoice_service import _apply_loyalty_redemption, validate_payment_rows


class _InvoiceStub:
	doctype = "Sales Invoice"

	def __init__(self):
		self.values = {"customer": "CUST-1"}

	def get(self, fieldname, default=None):
		return self.values.get(fieldname, default)

	def set(self, fieldname, value):
		self.values[fieldname] = value


class TestLoyaltyRedemption(TestCase):
	@patch("vunapos.services.invoice_service._has_field", return_value=True)
	@patch("vunapos.services.invoice_service.frappe.db.get_value", return_value="Single Tier")
	@patch("vunapos.services.invoice_service.validate_loyalty_points")
	def test_redemption_uses_erpnext_native_validation(self, validate, _get_value, _has_field):
		doc = _InvoiceStub()
		validate.side_effect = lambda target, points: target.set("loyalty_amount", points * 2)

		_apply_loyalty_redemption(doc, 25)

		validate.assert_called_once_with(doc, 25)
		self.assertEqual(doc.get("redeem_loyalty_points"), 1)
		self.assertEqual(doc.get("loyalty_amount"), 50)

	@patch("vunapos.services.invoice_service._has_field", return_value=True)
	def test_redemption_rejects_fractional_points(self, _has_field):
		with self.assertRaises(frappe.ValidationError) as context:
			_apply_loyalty_redemption(_InvoiceStub(), "1.5")

		self.assertEqual(context.exception.vuna_error_code, "INVALID_LOYALTY_POINTS")

	@patch("vunapos.services.invoice_service._has_field", return_value=True)
	@patch("vunapos.services.invoice_service.frappe.db.get_value", return_value=None)
	def test_redemption_requires_customer_enrollment(self, _get_value, _has_field):
		with self.assertRaises(frappe.ValidationError) as context:
			_apply_loyalty_redemption(_InvoiceStub(), 10)

		self.assertEqual(
			context.exception.vuna_error_code,
			"CUSTOMER_NOT_ENROLLED_IN_LOYALTY",
		)

	def test_payment_amount_due_excludes_loyalty_value(self):
		doc = frappe._dict({"rounded_total": 100, "grand_total": 100, "loyalty_amount": 25})
		doc.precision = lambda _fieldname: 2
		profile = frappe._dict(
			{"allow_partial_payment": 0, "payments": [frappe._dict({"mode_of_payment": "Cash"})]}
		)

		with patch("vunapos.services.invoice_service._payment_mode_type", return_value="Cash"):
			rows = validate_payment_rows(doc, [{"mode_of_payment": "Cash", "amount": 75}], profile)

		self.assertEqual(rows[0]["amount"], 75)

	def test_fully_redeemed_invoice_needs_no_payment_row(self):
		doc = frappe._dict({"rounded_total": 100, "grand_total": 100, "loyalty_amount": 100})
		doc.precision = lambda _fieldname: 2
		profile = frappe._dict(
			{"allow_partial_payment": 0, "payments": [frappe._dict({"mode_of_payment": "Cash"})]}
		)

		self.assertEqual(validate_payment_rows(doc, [], profile), [])
