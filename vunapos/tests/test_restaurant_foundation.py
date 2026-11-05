from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api.restaurant import _atomic_write, create_order
from vunapos.services.restaurant_service import (
	backfill_branch_companies,
	require_restaurant_context,
	validate_branch_company,
	validate_branch_doc,
)


class TestRestaurantFoundation(IntegrationTestCase):
	def test_order_cancel_pin_is_independent_of_item_removal(self):
		from vunapos.services.pin_service import verify_manager_pin

		for removal, cancellation, action, expected in (
			(1, 0, "order_cancel", "MANAGER_PIN_NOT_REQUIRED"),
			(0, 1, "item_removal", "MANAGER_PIN_NOT_REQUIRED"),
			(0, 1, "order_cancel", "INVALID_PIN_FORMAT"),
		):
			profile = frappe._dict(
				name="Profile",
				vunapos_require_manager_pin_item_removal=removal,
				vunapos_require_manager_pin_order_cancel=cancellation,
			)
			with (
				patch("vunapos.services.pin_service.resolve_pos_profile", return_value=profile),
				patch("vunapos.services.pin_service.require_pos_profile_assignment"),
			):
				with self.assertRaises(frappe.ValidationError) as error:
					verify_manager_pin("Profile", "invalid", action)
				self.assertEqual(error.exception.vuna_error_code, expected)

	def test_branch_permission_blocks_other_restaurant_even_with_profile_assignment(self):
		from vunapos.api.restaurant import get_floor_plan
		from vunapos.setup.utils import WAITER_ROLE, ensure_vunapos_roles
		from vunapos.tests.helpers import (
			ensure_test_restaurant,
			ensure_test_restaurant_profile,
			ensure_test_user,
		)

		frappe.set_user("Administrator")
		ensure_vunapos_roles()
		profile_name = ensure_test_restaurant_profile()
		profile = frappe.get_doc("POS Profile", profile_name)
		branch = profile.vunapos_branch
		other_restaurant = ensure_test_restaurant("_Test Restricted Restaurant")
		other = frappe.copy_doc(profile)
		other.set("__newname", "_Test Restricted Restaurant Profile")
		other.vunapos_restaurant = other_restaurant
		other.vunapos_branch = f"{other_restaurant} Branch"
		if not frappe.db.exists("POS Profile", "_Test Restricted Restaurant Profile"):
			other.insert(ignore_permissions=True)
		user = "_test_restaurant_branch_restriction@example.com"
		ensure_test_user(user, roles=(WAITER_ROLE,), pos_profile=profile_name)
		ensure_test_user(user, roles=(WAITER_ROLE,), pos_profile="_Test Restricted Restaurant Profile")
		if not frappe.db.exists("User Permission", {"user": user, "allow": "Branch", "for_value": branch}):
			frappe.get_doc(
				{
					"doctype": "User Permission",
					"user": user,
					"allow": "Branch",
					"for_value": branch,
					"apply_to_all_doctypes": 1,
				}
			).insert(ignore_permissions=True)
		try:
			frappe.set_user(user)
			self.assertTrue(get_floor_plan(profile_name)["ok"])
			self.assertFalse(get_floor_plan("_Test Restricted Restaurant Profile")["ok"])
			visible = frappe.get_list("Restaurant", pluck="name")
			# Restaurant is a shared Company-level master, not a Branch record.
			self.assertIn(other_restaurant, visible)
		finally:
			frappe.set_user("Administrator")

	def test_failed_response_reverts_database_write(self):
		branch = f"_Test Restaurant Atomic {uuid4().hex[:8]}"

		@_atomic_write
		def fail_after_insert():
			frappe.get_doc({"doctype": "Branch", "branch": branch}).insert(ignore_permissions=True)
			return {"ok": False}

		self.assertFalse(fail_after_insert()["ok"])
		self.assertFalse(frappe.db.exists("Branch", branch))

	def test_branch_is_required(self):
		with self.assertRaises(frappe.ValidationError) as error:
			validate_branch_company(None, "Company A")
		self.assertEqual(error.exception.vuna_error_code, "RESTAURANT_BRANCH_REQUIRED")

	def test_branch_must_have_matching_company(self):
		for company in (None, "Company B"):
			with patch("frappe.db.get_value", return_value=company):
				with self.assertRaises(frappe.ValidationError):
					validate_branch_company("Branch A", "Company A")
		with patch("frappe.db.get_value", return_value="Company A"):
			validate_branch_company("Branch A", "Company A")

	def test_backfill_only_unambiguous_ownership(self):
		rows = [
			frappe._dict(branch="A", company="Company A"),
			frappe._dict(branch="B", company="Company A"),
			frappe._dict(branch="B", company="Company B"),
			frappe._dict(branch=None, company="Company A"),
		]
		with (
			patch("frappe.db.exists", return_value=True),
			patch("frappe.get_all", return_value=rows),
			patch("frappe.db.get_value", return_value=None),
			patch("frappe.db.set_value") as set_value,
		):
			backfill_branch_companies()
			set_value.assert_called_once_with("Branch", "A", "vunapos_company", "Company A")

	def test_branch_company_cannot_invalidate_restaurants(self):
		from unittest.mock import MagicMock

		doc = MagicMock()
		doc.is_new.return_value = False
		doc.has_value_changed.return_value = True
		doc.get.return_value = "Company B"
		with patch("frappe.get_all", side_effect=[["Profile A"], [], [], []]):
			with self.assertRaises(frappe.ValidationError):
				validate_branch_doc(doc)

	def test_context_checks_branch_user_permissions(self):
		from unittest.mock import MagicMock

		restaurant = MagicMock(enabled=1, company="Company A", branch="Branch A")
		branch = MagicMock()
		branch.check_permission.side_effect = frappe.PermissionError("Branch denied")
		with (
			patch("frappe.get_cached_doc", return_value=restaurant),
			patch("frappe.get_doc", return_value=branch),
			patch("frappe.db.get_value", return_value="Company A"),
		):
			with self.assertRaises(frappe.PermissionError):
				require_restaurant_context("Restaurant A", "Company A", "Branch A")
			branch.check_permission.assert_called_once_with("read")

	def test_caught_write_failure_rolls_back(self):
		with (
			patch("frappe.db.savepoint") as savepoint,
			patch("frappe.db.rollback") as rollback,
			patch(
				"vunapos.api.restaurant.restaurant_order_service.create_order",
				side_effect=ValueError("Failed"),
			),
		):
			response = create_order("Profile A")
			self.assertFalse(response["ok"])
			rollback.assert_called_once_with(save_point=savepoint.call_args.args[0])

	def test_uncaught_write_failure_rolls_back(self):
		@_atomic_write
		def fail():
			raise ValueError("Failed")

		with patch("frappe.db.savepoint") as savepoint, patch("frappe.db.rollback") as rollback:
			with self.assertRaises(ValueError):
				fail()
			rollback.assert_called_once_with(save_point=savepoint.call_args.args[0])

	def test_successful_write_is_not_rolled_back(self):
		@_atomic_write
		def succeed():
			return {"ok": True}

		with patch("frappe.db.savepoint"), patch("frappe.db.rollback") as rollback:
			self.assertTrue(succeed()["ok"])
			rollback.assert_not_called()
