from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.overrides.pos_opening_entry import VunaPOSOpeningEntryMixin
from vunapos.services.pos_entry import create_pos_opening_entry, validate_opening_balances
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

	def test_opening_entry_duplicate_check_is_scoped_to_cashier(self):
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
				"status": "Open",
				"docstatus": 1,
				"name": ["!=", "new-pos-opening-entry"],
			},
		)

	def test_same_cashier_cannot_open_another_profile(self):
		entry = frappe._dict({"name": None, "user": "cashier@example.com", "pos_profile": "Other POS"})
		with patch("frappe.db.exists", return_value="POS-OPEN-0001"):
			with self.assertRaises(frappe.ValidationError):
				VunaPOSOpeningEntryMixin.check_open_pos_exists(entry)

	def test_opening_service_rejects_a_second_profile_for_the_cashier(self):
		with (
			patch("vunapos.services.pos_entry.require_pos_profile_assignment"),
			patch("vunapos.services.pos_entry.require_read"),
			patch("vunapos.services.pos_entry.require_create"),
			patch(
				"vunapos.services.pos_entry.frappe.get_cached_doc",
				return_value=frappe._dict(name="Other POS", disabled=0),
			),
			patch(
				"vunapos.services.pos_entry.frappe.db.exists",
				return_value="POS-OPEN-0001",
			) as exists,
		):
			with self.assertRaises(frappe.ValidationError):
				create_pos_opening_entry(
					pos_profile="Other POS",
					opening_balance=[{"mode_of_payment": "Cash", "opening_amount": 0}],
					user="cashier@example.com",
				)

		exists.assert_called_once_with(
			"POS Opening Entry",
			{
				"user": "cashier@example.com",
				"status": "Open",
				"docstatus": 1,
			},
		)
