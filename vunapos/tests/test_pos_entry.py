from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.overrides.pos_opening_entry import VunaPOSOpeningEntryMixin
from vunapos.services.pos_entry import validate_opening_balances
from vunapos.tests.helpers import ensure_test_pos_profile


class TestVunaPOSOpeningEntry(IntegrationTestCase):
	def setUp(self):
		self.profile = frappe.get_doc("POS Profile", ensure_test_pos_profile())
		self.mode = self.profile.get("payments")[0].mode_of_payment

	def test_normalizes_configured_opening_balances(self):
		rows = validate_opening_balances(
			self.profile, [{"mode_of_payment": self.mode, "opening_amount": "100.50"}]
		)
		self.assertEqual(rows, [{"mode_of_payment": self.mode, "opening_amount": 100.5}])

	def test_rejects_negative_opening_balance(self):
		with self.assertRaises(frappe.ValidationError):
			validate_opening_balances(self.profile, [{"mode_of_payment": self.mode, "opening_amount": -1}])

	def test_rejects_duplicate_or_unconfigured_payment_modes(self):
		with self.assertRaises(frappe.ValidationError):
			validate_opening_balances(
				self.profile,
				[
					{"mode_of_payment": self.mode, "opening_amount": 0},
					{"mode_of_payment": self.mode, "opening_amount": 0},
				],
			)
		with self.assertRaises(frappe.ValidationError):
			validate_opening_balances(
				self.profile, [{"mode_of_payment": "Not Configured", "opening_amount": 0}]
			)

	def test_opening_entry_duplicate_check_is_scoped_to_user_and_profile(self):
		entry = frappe._dict(
			{
				"name": "new-pos-opening-entry",
				"user": "cashier@example.com",
				"pos_profile": "Main POS",
			}
		)
		with patch("frappe.db.exists", return_value=None) as exists:
			VunaPOSOpeningEntryMixin.check_open_pos_exists(entry)

		exists.assert_called_once_with(
			"POS Opening Entry",
			{
				"user": "cashier@example.com",
				"pos_profile": "Main POS",
				"status": "Open",
				"docstatus": 1,
				"name": ["!=", "new-pos-opening-entry"],
			},
		)

	def test_same_user_and_profile_cannot_open_twice(self):
		entry = frappe._dict({"name": None, "user": "cashier@example.com", "pos_profile": "Main POS"})
		with patch("frappe.db.exists", return_value="POS-OPEN-0001"):
			with self.assertRaises(frappe.ValidationError):
				VunaPOSOpeningEntryMixin.check_open_pos_exists(entry)
