from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.services.restaurant_service import validate_branch_doc
from vunapos.services.service_type_service import get_profile_service_types, resolve_service_type
from vunapos.tests.helpers import ensure_test_restaurant, ensure_test_service_types


class TestRestaurantServiceTypes(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.restaurant = frappe.get_doc("Restaurant", ensure_test_restaurant(f"Services {uuid4().hex[:8]}"))
		self.dine_in, self.takeaway, _delivery = ensure_test_service_types()
		self.branch = f"{self.restaurant.name} Branch"
		self.profile = frappe._dict(vunapos_restaurant=self.restaurant.name, vunapos_branch=self.branch)

	def tearDown(self):
		frappe.clear_document_cache("Restaurant", self.restaurant.name)

	def _save(self, rows):
		self.restaurant.set("service_types", rows)
		self.restaurant.save()
		frappe.clear_document_cache("Restaurant", self.restaurant.name)

	def _offered(self, profile=None):
		return get_profile_service_types(profile or self.profile)

	def test_explicit_branch_replaces_shared_list_and_default(self):
		self._save(
			[
				{"service_type": self.dine_in, "is_default": 1},
				{"service_type": self.takeaway},
				{"service_type": self.takeaway, "branch": self.branch, "is_default": 1},
			]
		)
		self.assertEqual([row["name"] for row in self._offered()], [self.takeaway])
		self.assertTrue(self._offered()[0]["is_default"])
		with self.assertRaises(frappe.ValidationError) as error:
			resolve_service_type(self.profile, self.dine_in)
		self.assertEqual(error.exception.vuna_error_code, "SERVICE_TYPE_NOT_ALLOWED")

	def test_unconfigured_branch_uses_shared_rows(self):
		self._save(
			[
				{"service_type": self.dine_in, "is_default": 1},
				{"service_type": self.takeaway},
				{"service_type": self.takeaway, "branch": self.branch, "is_default": 1},
			]
		)
		other = frappe._dict(vunapos_restaurant=self.restaurant.name, vunapos_branch="Other branch")
		offered = self._offered(other)
		self.assertEqual({row["name"] for row in offered}, {self.dine_in, self.takeaway})
		self.assertEqual(next(row["name"] for row in offered if row["is_default"]), self.dine_in)

	def test_configured_restaurant_without_shared_or_matching_rows_offers_nothing(self):
		self._save([{"service_type": self.takeaway, "branch": self.branch}])
		other = frappe._dict(vunapos_restaurant=self.restaurant.name, vunapos_branch="Other branch")
		self.assertEqual(self._offered(other), [])

	def test_disabled_branch_service_does_not_fall_back_to_shared_services(self):
		self._save(
			[
				{"service_type": self.dine_in, "is_default": 1},
				{"service_type": self.takeaway, "branch": self.branch, "is_default": 1},
			]
		)
		frappe.db.set_value("Restaurant Service Type", self.takeaway, "enabled", 0)
		self.assertEqual(self._offered(), [])

	def test_same_service_can_exist_once_per_branch_and_once_shared(self):
		self._save(
			[
				{"service_type": self.dine_in, "is_default": 1},
				{"service_type": self.dine_in, "branch": self.branch, "is_default": 1},
			]
		)
		self.assertEqual(len(self.restaurant.service_types), 2)

	def test_duplicate_shared_service_is_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			self._save([{"service_type": self.dine_in}, {"service_type": self.dine_in, "branch": ""}])

	def test_duplicate_branch_service_is_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			self._save([{"service_type": self.dine_in, "branch": self.branch}] * 2)

	def test_two_defaults_within_one_scope_are_rejected(self):
		for branch in (None, self.branch):
			with self.subTest(branch=branch), self.assertRaises(frappe.ValidationError):
				self._save(
					[
						{"service_type": self.dine_in, "branch": branch, "is_default": 1},
						{"service_type": self.takeaway, "branch": branch, "is_default": 1},
					]
				)

	def test_branch_must_belong_to_restaurant_company(self):
		frappe.db.set_value("Branch", self.branch, "vunapos_company", None)
		with self.assertRaises(frappe.ValidationError):
			self._save([{"service_type": self.dine_in, "branch": self.branch}])

	def test_branch_cannot_change_company_while_referenced_by_service_assignments(self):
		self._save([{"service_type": self.dine_in, "branch": self.branch}])
		branch = frappe.get_doc("Branch", self.branch)
		branch.vunapos_company = None
		with self.assertRaises(frappe.ValidationError):
			validate_branch_doc(branch)

	def test_same_service_is_allowed_for_two_different_branches(self):
		other = frappe.get_doc(
			{
				"doctype": "Branch",
				"branch": f"Other {uuid4().hex[:8]}",
				"vunapos_company": self.restaurant.company,
			}
		).insert()
		self._save(
			[
				{"service_type": self.takeaway, "branch": self.branch, "is_default": 1},
				{"service_type": self.takeaway, "branch": other.name, "is_default": 1},
			]
		)
		self.assertEqual(len(self.restaurant.service_types), 2)

	def test_unconfigured_restaurant_preserves_all_enabled_services(self):
		self._save([])
		self.assertIn(self.dine_in, {row["name"] for row in self._offered()})
