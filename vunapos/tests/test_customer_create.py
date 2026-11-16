import random

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api.customer import create_customer, find_customer_matches, get_customer_create_options
from vunapos.patches.v1_0 import allow_restaurant_customer_creation
from vunapos.services.catalogue_cache import customer_search_key
from vunapos.services.catalogue_cache import get as get_catalogue_cache
from vunapos.services.catalogue_cache import set as set_catalogue_cache
from vunapos.services.customer_service import default_customer_group, normalise_mobile
from vunapos.setup.utils import CASHIER_ROLE, KITCHEN_ROLE, WAITER_ROLE, ensure_vunapos_roles
from vunapos.tests.helpers import (
	ensure_test_pos_profile,
	ensure_test_restaurant_profile,
	ensure_test_user,
)

WAITER = "_test_vunapos_customer_waiter@example.com"
GROUP_A = "_Test VunaPOS Customer Group A"
GROUP_B = "_Test VunaPOS Customer Group B"
GROUP_NODE = "_Test VunaPOS Customer Group Node"
TERRITORY_A = "_Test VunaPOS Territory A"
TERRITORY_B = "_Test VunaPOS Territory B"


def _mobile():
	"""A valid Kenyan mobile number no other test uses."""
	return "07" + str(random.choice((1, 2))) + "".join(random.choices("0123456789", k=7))


def _name(prefix="Guest"):
	return f"_Test VunaPOS {prefix} {frappe.generate_hash(length=8)}"


def _ensure_group(name, is_group=0, parent="All Customer Groups"):
	if not frappe.db.exists("Customer Group", name):
		frappe.get_doc(
			{
				"doctype": "Customer Group",
				"customer_group_name": name,
				"parent_customer_group": parent,
				"is_group": is_group,
			}
		).insert(ignore_permissions=True)
	return name


def _ensure_territory(name):
	if not frappe.db.exists("Territory", name):
		frappe.get_doc(
			{"doctype": "Territory", "territory_name": name, "parent_territory": "All Territories"}
		).insert(ignore_permissions=True)
	return name


class TestCustomerCreate(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		ensure_vunapos_roles()
		cls.retail = ensure_test_pos_profile()
		cls.restaurant = ensure_test_restaurant_profile()
		_ensure_group(GROUP_A)
		_ensure_group(GROUP_B)
		_ensure_group(GROUP_NODE, is_group=1)
		_ensure_group(f"{GROUP_NODE} Leaf", parent=GROUP_NODE)
		_ensure_territory(TERRITORY_A)
		_ensure_territory(TERRITORY_B)
		ensure_test_user(WAITER, roles=(WAITER_ROLE,), pos_profile=cls.restaurant)

	def setUp(self):
		frappe.set_user("Administrator")
		self.selling = {
			field: frappe.db.get_single_value("Selling Settings", field)
			for field in ("customer_group", "territory")
		}
		for profile in (self.retail, self.restaurant):
			frappe.db.set_value(
				"POS Profile",
				profile,
				{
					"vunapos_allow_customer_creation": 1,
					"vunapos_default_customer_group": None,
					"vunapos_default_customer_territory": None,
				},
				update_modified=False,
			)
			frappe.db.delete("POS Customer Group", {"parent": profile})
		frappe.db.set_single_value("Selling Settings", {"customer_group": None, "territory": None})
		frappe.clear_cache(doctype="POS Profile")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.set_single_value("Selling Settings", self.selling)
		frappe.clear_cache(doctype="POS Profile")

	def _create(self, profile, **kwargs):
		return create_customer(
			pos_profile=profile, customer_name=kwargs.pop("customer_name", _name()), **kwargs
		)

	def test_name_only_creation_works_in_both_modes(self):
		for profile in (self.retail, self.restaurant):
			response = self._create(profile)

			self.assertTrue(response["ok"], response)
			customer = frappe.get_doc("Customer", response["data"]["customer"])
			self.assertEqual(customer.customer_type, "Individual")
			self.assertFalse(customer.mobile_no)

	def test_customer_type_is_saved_and_validated(self):
		response = self._create(self.restaurant, customer_type="Company")
		self.assertTrue(response["ok"], response)
		self.assertEqual(
			frappe.db.get_value("Customer", response["data"]["customer"], "customer_type"), "Company"
		)

		response = self._create(self.restaurant, customer_type="Cooperative")
		self.assertFalse(response["ok"])
		self.assertEqual(response["errors"][0]["code"], "INVALID_CUSTOMER_TYPE")

	def test_create_options_read_customer_types_from_the_doctype(self):
		response = get_customer_create_options(pos_profile=self.restaurant)

		self.assertTrue(response["ok"], response)
		data = response["data"]
		options = frappe.get_meta("Customer").get_field("customer_type").options.split("\n")
		self.assertEqual(data["customer_types"], [option for option in options if option])
		self.assertEqual(data["default_customer_type"], "Individual")
		self.assertEqual(data["default_country"], "Kenya")
		self.assertIn({"country": "Kenya", "code": "KE", "isd": "+254"}, data["countries"])

	def test_mobile_numbers_are_normalised_to_the_phone_field_format(self):
		for raw in ("0712 345 678", "712345678", "+254712345678", "+254-712345678", "254 712 345 678"):
			self.assertEqual(normalise_mobile(raw, "Kenya"), "+254-712345678", raw)
		self.assertEqual(normalise_mobile("020 7946 0958", "United Kingdom"), "+44-2079460958")
		with self.assertRaises(frappe.ValidationError):
			normalise_mobile("12345", "Kenya")

	def test_both_modes_save_the_normalised_mobile_on_customer_and_contact(self):
		for profile in (self.retail, self.restaurant):
			mobile = _mobile()
			response = self._create(profile, mobile_no=mobile, email_id=" guest@example.com ")

			self.assertTrue(response["ok"], response)
			expected = "+254-" + mobile[1:]
			customer = frappe.get_doc("Customer", response["data"]["customer"])
			self.assertEqual(customer.mobile_no, expected, profile)
			self.assertEqual(customer.email_id, "guest@example.com", profile)
			self.assertEqual(
				frappe.db.get_value("Contact Phone", {"parent": customer.customer_primary_contact}, "phone"),
				expected,
				profile,
			)

	def test_both_modes_reject_an_invalid_mobile(self):
		for profile in (self.retail, self.restaurant):
			response = self._create(profile, mobile_no="0700", mobile_country="Kenya")

			self.assertFalse(response["ok"])
			self.assertEqual(response["errors"][0]["code"], "INVALID_MOBILE_NUMBER")
			self.assertEqual(response["errors"][0]["field"], "mobile_no")

	def test_duplicate_mobile_is_a_warning_not_a_block(self):
		for profile in (self.retail, self.restaurant):
			mobile = _mobile()
			first = self._create(profile, mobile_no=mobile)
			self.assertTrue(first["ok"], first)

			matches = find_customer_matches(pos_profile=profile, mobile_no="+254" + mobile[1:])["data"]
			self.assertEqual(matches["mobile_no"], "+254-" + mobile[1:])
			self.assertEqual(
				[row["customer"] for row in matches["mobile_matches"]], [first["data"]["customer"]]
			)

			second = self._create(profile, mobile_no="+254" + mobile[1:], mobile_country="Kenya")
			self.assertTrue(second["ok"], second)
			self.assertEqual(
				frappe.db.get_value("Customer", second["data"]["customer"], "mobile_no"), "+254-" + mobile[1:]
			)

	def test_duplicate_check_finds_numbers_on_linked_contacts(self):
		mobile = _mobile()
		customer = self._create(self.retail)["data"]["customer"]
		frappe.get_doc(
			{
				"doctype": "Contact",
				"first_name": "Second number",
				"phone_nos": [{"phone": "254" + mobile[1:], "is_primary_mobile_no": 1}],
				"links": [{"link_doctype": "Customer", "link_name": customer}],
			}
		).insert(ignore_permissions=True)

		response = find_customer_matches(pos_profile=self.restaurant, mobile_no=mobile)

		self.assertTrue(response["ok"], response)
		self.assertEqual([row["customer"] for row in response["data"]["mobile_matches"]], [customer])

	def test_similar_names_are_suggestions_only(self):
		word = frappe.generate_hash(length=8)
		existing = self._create(self.restaurant, customer_name=f"_Test Wanjiru {word}")["data"]["customer"]

		response = find_customer_matches(pos_profile=self.restaurant, customer_name=f"wanjiru {word}")
		self.assertTrue(response["ok"], response)
		self.assertEqual([row["customer"] for row in response["data"]["similar"]], [existing])
		self.assertEqual(response["data"]["mobile_matches"], [])
		self.assertIsNone(response["data"]["mobile_no"])

		created = self._create(self.restaurant, customer_name=f"Wanjiru {word}")
		self.assertTrue(created["ok"], created)

	def test_profile_allow_customer_creation_is_respected(self):
		frappe.db.set_value(
			"POS Profile", self.restaurant, "vunapos_allow_customer_creation", 0, update_modified=False
		)
		frappe.clear_cache(doctype="POS Profile")

		for response in (
			self._create(self.restaurant),
			get_customer_create_options(pos_profile=self.restaurant),
			find_customer_matches(pos_profile=self.restaurant, customer_name="Anyone"),
		):
			self.assertFalse(response["ok"])
			self.assertEqual(response["errors"][0]["code"], "PermissionError")

	def test_group_and_territory_fall_back_from_profile_to_selling_settings(self):
		for profile in (self.retail, self.restaurant):
			frappe.db.set_single_value(
				"Selling Settings", {"customer_group": GROUP_B, "territory": TERRITORY_B}
			)
			frappe.db.set_value(
				"POS Profile",
				profile,
				{
					"vunapos_default_customer_group": GROUP_A,
					"vunapos_default_customer_territory": TERRITORY_A,
				},
			)
			frappe.clear_cache(doctype="POS Profile")
			customer = frappe.get_doc("Customer", self._create(profile)["data"]["customer"])
			self.assertEqual((customer.customer_group, customer.territory), (GROUP_A, TERRITORY_A), profile)

			frappe.db.set_value(
				"POS Profile",
				profile,
				{"vunapos_default_customer_group": None, "vunapos_default_customer_territory": None},
			)
			frappe.clear_cache(doctype="POS Profile")
			customer = frappe.get_doc("Customer", self._create(profile)["data"]["customer"])
			self.assertEqual((customer.customer_group, customer.territory), (GROUP_B, TERRITORY_B), profile)

			frappe.db.set_single_value("Selling Settings", {"customer_group": None, "territory": None})
			customer = frappe.get_doc("Customer", self._create(profile)["data"]["customer"])
			self.assertEqual((customer.customer_group, customer.territory), (None, None), profile)

	def test_default_group_outside_the_profile_customer_groups_falls_back_to_an_allowed_group(self):
		profile = frappe.get_doc("POS Profile", self.retail)
		profile.vunapos_default_customer_group = GROUP_A
		profile.append("customer_groups", {"customer_group": GROUP_NODE})
		profile.save(ignore_permissions=True)

		# The allowed entry is a group node, so its first leaf is used.
		self.assertEqual(default_customer_group(profile), f"{GROUP_NODE} Leaf")
		customer = self._create(self.retail)["data"]["customer"]
		self.assertEqual(frappe.db.get_value("Customer", customer, "customer_group"), f"{GROUP_NODE} Leaf")
		self.assertIn(GROUP_A, str(frappe.message_log))

		profile.customer_groups = []
		profile.append("customer_groups", {"customer_group": GROUP_A})
		profile.save(ignore_permissions=True)
		self.assertEqual(default_customer_group(profile), GROUP_A)

	def test_default_group_must_not_be_a_group_node(self):
		profile = frappe.get_doc("POS Profile", self.retail)
		profile.vunapos_default_customer_group = GROUP_NODE
		with self.assertRaises(frappe.ValidationError):
			profile.save(ignore_permissions=True)

	def test_waiter_without_sales_user_can_create_but_not_edit_customers(self):
		self.assertNotIn("Sales User", frappe.get_roles(WAITER))
		frappe.set_user(WAITER)

		response = self._create(self.restaurant, mobile_no=_mobile())

		self.assertTrue(response["ok"], response)
		customer = response["data"]["customer"]
		self.assertTrue(frappe.has_permission("Customer", "read", doc=customer))
		self.assertFalse(frappe.has_permission("Customer", "write", doc=customer))

	def test_patch_upgrades_only_untouched_read_only_rules(self):
		fields = ["name", "create", "export"]
		rules = {
			role: frappe.db.get_value(
				"Custom DocPerm", {"parent": "Customer", "role": role, "permlevel": 0}, fields, as_dict=True
			)
			for role in (WAITER_ROLE, CASHIER_ROLE, KITCHEN_ROLE)
		}
		try:
			frappe.db.set_value("Custom DocPerm", rules[WAITER_ROLE].name, {"create": 0, "export": 0})
			# Changed in Role Permissions Manager: left alone.
			frappe.db.set_value("Custom DocPerm", rules[CASHIER_ROLE].name, {"create": 0, "export": 1})

			allow_restaurant_customer_creation.execute()

			self.assertEqual(frappe.db.get_value("Custom DocPerm", rules[WAITER_ROLE].name, "create"), 1)
			self.assertEqual(frappe.db.get_value("Custom DocPerm", rules[CASHIER_ROLE].name, "create"), 0)
			self.assertEqual(frappe.db.get_value("Custom DocPerm", rules[KITCHEN_ROLE].name, "create"), 0)
		finally:
			for rule in rules.values():
				frappe.db.set_value(
					"Custom DocPerm", rule.name, {"create": rule.create, "export": rule.export}
				)
			frappe.clear_cache(doctype="Customer")

	def test_creation_clears_the_customer_search_cache_in_both_modes(self):
		key = customer_search_key(frappe.session.user, "anyone", 20)
		for profile in (self.retail, self.restaurant):
			set_catalogue_cache(key, [])
			self.assertTrue(self._create(profile)["ok"])
			self.assertIsNone(get_catalogue_cache(key), profile)
