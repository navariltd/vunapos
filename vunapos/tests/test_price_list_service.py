from unittest import TestCase
from unittest.mock import patch

import frappe

from vunapos.services.price_list_service import get_permitted_price_lists, resolve_price_list


class TestPriceListService(TestCase):
	def setUp(self):
		self.profile = frappe._dict(
			name="Counter 1",
			currency="KES",
			selling_price_list="Standard Selling",
			vunapos_allow_price_list_switching=1,
		)

	@patch("vunapos.services.price_list_service.frappe.has_permission", return_value=True)
	@patch(
		"vunapos.services.price_list_service.frappe.get_all",
		return_value=[frappe._dict(name="Standard Selling", currency="KES")],
	)
	def test_empty_allowlist_exposes_all_enabled_selling_lists_user_can_read(self, get_all, _has_permission):
		self.profile.vunapos_allowed_price_lists = []

		self.assertEqual(
			get_permitted_price_lists(self.profile),
			[{"name": "Standard Selling", "currency": "KES"}],
		)
		get_all.assert_called_once_with(
			"Price List",
			filters={"enabled": 1, "selling": 1},
			fields=["name", "currency"],
			order_by="name asc",
		)

	@patch("vunapos.services.price_list_service.frappe.has_permission", return_value=True)
	@patch("vunapos.services.price_list_service.frappe.get_all", return_value=[])
	def test_configured_rows_are_used_as_an_explicit_allowlist(self, get_all, _has_permission):
		self.profile.vunapos_allowed_price_lists = [frappe._dict(price_list="Wholesale")]

		get_permitted_price_lists(self.profile)

		get_all.assert_called_once_with(
			"Price List",
			filters={"enabled": 1, "selling": 1, "name": ["in", ["Wholesale"]]},
			fields=["name", "currency"],
			order_by="name asc",
		)

	@patch("vunapos.services.price_list_service.get_default_price_list", return_value="Standard Selling")
	def test_default_price_list_does_not_require_switch_permission(self, _get_default):
		self.profile.vunapos_allow_price_list_switching = 0

		self.assertEqual(resolve_price_list(self.profile), "Standard Selling")

	@patch("vunapos.services.price_list_service.get_default_price_list", return_value="Standard Selling")
	def test_manual_price_list_requires_profile_permission(self, _get_default):
		self.profile.vunapos_allow_price_list_switching = 0

		with self.assertRaises(frappe.ValidationError):
			resolve_price_list(self.profile, requested_price_list="Wholesale")

	@patch("vunapos.services.price_list_service.get_permitted_price_lists", return_value=[])
	@patch("vunapos.services.price_list_service.get_default_price_list", return_value="Standard Selling")
	def test_manual_price_list_must_be_in_profile_and_user_intersection(self, _get_default, _get_permitted):
		with self.assertRaises(frappe.PermissionError):
			resolve_price_list(self.profile, requested_price_list="Wholesale")

	@patch("vunapos.services.price_list_service.frappe.db.get_value", return_value="KES")
	@patch(
		"vunapos.services.price_list_service.get_permitted_price_lists",
		return_value=[{"name": "Wholesale", "currency": "KES"}],
	)
	@patch("vunapos.services.price_list_service.get_default_price_list", return_value="Standard Selling")
	def test_permitted_manual_price_list_is_accepted(self, _get_default, _get_permitted, _get_value):
		self.assertEqual(
			resolve_price_list(self.profile, requested_price_list="Wholesale"),
			"Wholesale",
		)

	@patch("vunapos.services.price_list_service.frappe.db.get_value", return_value="USD")
	@patch(
		"vunapos.services.price_list_service.get_permitted_price_lists",
		return_value=[{"name": "USD Selling", "currency": "USD"}],
	)
	@patch("vunapos.services.price_list_service.get_default_price_list", return_value="Standard Selling")
	def test_manual_price_list_must_match_pos_currency(self, _get_default, _get_permitted, _get_value):
		with self.assertRaises(frappe.ValidationError):
			resolve_price_list(self.profile, requested_price_list="USD Selling")
