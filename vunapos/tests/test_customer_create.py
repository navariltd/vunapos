import random

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api.customer import (
	create_customer,
	find_customer_matches,
	get_customer_create_options,
	get_customer_directory,
	search_customers,
)
from vunapos.api.pos import get_pos_bootstrap
from vunapos.patches.v1_0 import allow_restaurant_customer_creation
from vunapos.services.catalogue_cache import customer_search_key
from vunapos.services.catalogue_cache import get as get_catalogue_cache
from vunapos.services.catalogue_cache import set as set_catalogue_cache
from vunapos.services.customer_service import normalise_mobile
from vunapos.services.phone_search import national_digits
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


def _customer(group, prefix="Grouped"):
	return (
		frappe.get_doc({"doctype": "Customer", "customer_name": _name(prefix), "customer_group": group})
		.insert(ignore_permissions=True)
		.name
	)


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

	def _created_group(self, profile):
		response = self._create(profile)
		self.assertTrue(response["ok"], response)
		return frappe.db.get_value("Customer", response["data"]["customer"], "customer_group")

	def test_the_only_customer_groups_row_is_the_default_group(self):
		frappe.db.set_single_value("Selling Settings", "customer_group", GROUP_B)
		for profile in (self.retail, self.restaurant):
			self._set_customer_groups(profile, [GROUP_A])
			self.assertEqual(self._created_group(profile), GROUP_A, profile)

	def test_selling_settings_default_applies_only_within_customer_groups(self):
		leaf = f"{GROUP_NODE} Leaf"
		frappe.db.set_single_value("Selling Settings", "customer_group", leaf)
		for profile in (self.retail, self.restaurant):
			# Two rows: the Selling Settings default sits under one of them.
			self._set_customer_groups(profile, [GROUP_A, GROUP_NODE])
			self.assertEqual(self._created_group(profile), leaf, profile)

			# The only row is a group node, which can't hold customers.
			self._set_customer_groups(profile, [GROUP_NODE])
			self.assertEqual(self._created_group(profile), leaf, profile)

	def test_profile_needs_a_default_group_when_none_can_apply(self):
		for selling_default in (None, f"{GROUP_NODE} Leaf"):
			frappe.db.set_single_value("Selling Settings", "customer_group", selling_default)
			with self.assertRaisesRegex(frappe.ValidationError, "Set a Default Customer Group"):
				self._profile_with_groups(self.retail, [GROUP_A, GROUP_B]).save(ignore_permissions=True)

		self._set_customer_groups(self.retail, [GROUP_A, GROUP_B], default=GROUP_B)
		self.assertEqual(self._created_group(self.retail), GROUP_B)

	def test_default_group_must_be_within_customer_groups(self):
		with self.assertRaisesRegex(frappe.ValidationError, "is not one of this profile's Customer Groups"):
			self._profile_with_groups(self.restaurant, [GROUP_NODE], default=GROUP_A).save(
				ignore_permissions=True
			)

		frappe.message_log = []
		self._set_customer_groups(self.restaurant, [GROUP_NODE], default=f"{GROUP_NODE} Leaf")
		self.assertEqual(self._created_group(self.restaurant), f"{GROUP_NODE} Leaf")
		# The old "will use another group instead" warning is gone.
		self.assertNotIn("Customer Groups", str(frappe.message_log))

	def test_customer_group_rules_apply_only_when_creation_is_allowed(self):
		frappe.db.set_value(
			"POS Profile", self.retail, "vunapos_allow_customer_creation", 0, update_modified=False
		)
		frappe.clear_cache(doctype="POS Profile")

		self._set_customer_groups(self.retail, [GROUP_A, GROUP_B])
		self._set_customer_groups(self.retail, [GROUP_NODE], default=GROUP_A)

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

	def _profile_with_groups(self, profile, groups, default=None):
		doc = frappe.get_doc("POS Profile", profile)
		doc.vunapos_default_customer_group = default
		doc.customer_groups = []
		for group in groups:
			doc.append("customer_groups", {"customer_group": group})
		return doc

	def _set_customer_groups(self, profile, groups, default=None):
		self._profile_with_groups(profile, groups, default).save(ignore_permissions=True)

	def test_customer_search_follows_the_profile_customer_groups(self):
		in_a, in_leaf, in_b = (
			_customer(group, "Search") for group in (GROUP_A, f"{GROUP_NODE} Leaf", GROUP_B)
		)
		for profile in (self.retail, self.restaurant):
			self._set_customer_groups(profile, [])
			response = search_customers(query="_Test VunaPOS Search", limit=100, pos_profile=profile)
			found = {row["customer"] for row in response["data"]}
			self.assertTrue({in_a, in_leaf, in_b} <= found, profile)

			# A group node row covers its descendants.
			self._set_customer_groups(profile, [GROUP_A, GROUP_NODE], default=GROUP_A)
			response = search_customers(query="_Test VunaPOS Search", limit=100, pos_profile=profile)
			found = {row["customer"] for row in response["data"]}
			self.assertTrue({in_a, in_leaf} <= found, profile)
			self.assertNotIn(in_b, found, profile)

	def test_similar_name_suggestions_follow_the_profile_customer_groups(self):
		in_a = _customer(GROUP_A, "Lookalike")
		in_b = _customer(GROUP_B, "Lookalike")
		self._set_customer_groups(self.restaurant, [GROUP_A])

		response = find_customer_matches(pos_profile=self.restaurant, customer_name="VunaPOS Lookalike")

		similar = {row["customer"] for row in response["data"]["similar"]}
		self.assertIn(in_a, similar)
		self.assertNotIn(in_b, similar)

	def test_bootstrap_snapshot_follows_the_profile_customer_groups(self):
		in_a = _customer(GROUP_A, "Snapshot")
		in_b = _customer(GROUP_B, "Snapshot")
		self._set_customer_groups(self.retail, [])
		data = get_pos_bootstrap(pos_profile=self.retail)["data"]
		self.assertIsNone(data["pos_profile"]["customer_groups"])

		self._set_customer_groups(self.retail, [GROUP_A, GROUP_NODE], default=GROUP_A)
		data = get_pos_bootstrap(pos_profile=self.retail)["data"]
		self.assertEqual(
			data["pos_profile"]["customer_groups"], sorted([GROUP_A, GROUP_NODE, f"{GROUP_NODE} Leaf"])
		)
		names = {row["customer"] for row in data["customers"]}
		self.assertIn(in_a, names)
		self.assertNotIn(in_b, names)
		self.assertTrue(
			all(row["customer_group"] in data["pos_profile"]["customer_groups"] for row in data["customers"])
		)

		# A customer moved out of the till's groups is removed by the next delta.
		since = str(data["server_time"])
		frappe.db.set_value(
			"Customer",
			in_a,
			{"customer_group": GROUP_B, "modified": frappe.utils.add_to_date(since, seconds=1)},
			update_modified=False,
		)
		delta = get_pos_bootstrap(pos_profile=self.retail, since=since)["data"]
		self.assertIn(in_a, delta["deleted"]["Customer"])
		self.assertNotIn(in_a, {row["customer"] for row in delta["customers"]})

	def test_matching_mobile_outside_the_customer_groups_is_only_mentioned(self):
		mobile = _mobile()
		outside = _customer(GROUP_B, "Elsewhere")
		frappe.db.set_value("Customer", outside, "mobile_no", "+254-" + mobile[1:])
		self._set_customer_groups(self.restaurant, [GROUP_A])

		data = find_customer_matches(pos_profile=self.restaurant, mobile_no=mobile)["data"]
		self.assertEqual(data["mobile_matches"], [])
		self.assertTrue(data["mobile_elsewhere"])

		self._set_customer_groups(self.restaurant, [])
		data = find_customer_matches(pos_profile=self.restaurant, mobile_no=mobile)["data"]
		self.assertEqual([row["customer"] for row in data["mobile_matches"]], [outside])
		self.assertFalse(data["mobile_elsewhere"])

	def test_customers_page_follows_the_profile_customer_groups(self):
		in_a = _customer(GROUP_A, "Directory")
		in_b = _customer(GROUP_B, "Directory")
		for profile in (self.retail, self.restaurant):
			self._set_customer_groups(profile, [])
			data = get_customer_directory(pos_profile=profile, query="_Test VunaPOS Directory", limit=100)[
				"data"
			]
			self.assertTrue({in_a, in_b} <= {row["customer"] for row in data["customers"]}, profile)

			self._set_customer_groups(profile, [GROUP_A])
			data = get_customer_directory(pos_profile=profile, query="_Test VunaPOS Directory", limit=100)[
				"data"
			]
			self.assertEqual({row["customer"] for row in data["customers"]} & {in_a, in_b}, {in_a}, profile)
			self.assertEqual(data["customer_groups"], [GROUP_A], profile)

			# Choosing a group outside the till's Customer Groups shows nobody.
			data = get_customer_directory(
				pos_profile=profile, query="_Test VunaPOS Directory", customer_group=GROUP_B, limit=100
			)["data"]
			self.assertEqual(data["customers"], [], profile)

	def test_phone_search_reads_any_common_format(self):
		formats = ("0790 001 011", "0790001011", "790001011", "+254790001011", "+254-790001011")
		for value in formats:
			self.assertEqual(national_digits(value, "254"), "790001011", value)
		self.assertIsNone(national_digits("Wanjiru", "254"))

		national = "7" + "".join(random.choices("0123456789", k=8))
		saved = _customer(GROUP_A, "Phone")
		frappe.db.set_value("Customer", saved, "mobile_no", f"+254-{national}")
		spaced = f"0{national[:3]} {national[3:6]} {national[6:]}"
		for profile in (self.retail, self.restaurant):
			for query in (
				spaced,
				f"0{national}",
				national,
				f"+254{national}",
				f"+254-{national}",
				national[:4],
			):
				found = {
					row["customer"] for row in search_customers(query=query, pos_profile=profile)["data"]
				}
				self.assertIn(saved, found, (profile, query))
				page = get_customer_directory(pos_profile=profile, query=query, limit=100)["data"]
				self.assertIn(saved, {row["customer"] for row in page["customers"]}, (profile, query))

			# Still within the till's Customer Groups.
			self._set_customer_groups(profile, [GROUP_B])
			self.assertNotIn(
				saved,
				{row["customer"] for row in search_customers(query=spaced, pos_profile=profile)["data"]},
			)
			self._set_customer_groups(profile, [])
