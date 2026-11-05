"""Restaurant brands span branches; menus and operations remain location-scoped."""

from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant as api
from vunapos.services.floor_plan_service import get_floor_plan
from vunapos.services.kitchen_lifecycle_service import list_board
from vunapos.services.kitchen_service import classify_items, route_lines, station_matches
from vunapos.services.menu_service import get_menu_definition, resolve_table_floor
from vunapos.services.restaurant_service import validate_profile_restaurant
from vunapos.tests.helpers import ensure_test_item, ensure_test_restaurant, ensure_test_restaurant_profile


class TestRestaurantLocations(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.token = uuid4().hex[:8]
		base = frappe.get_doc("POS Profile", ensure_test_restaurant_profile())
		self.brand = ensure_test_restaurant(f"_Test Brand {self.token}")
		self.profiles, self.floors, self.tables = [], [], []
		for index in range(2):
			branch = (
				frappe.get_doc(
					{
						"doctype": "Branch",
						"branch": f"Brand {self.token} {index}",
						"vunapos_company": base.company,
					}
				)
				.insert()
				.name
			)
			profile = frappe.copy_doc(base)
			profile.set("__newname", f"Brand till {self.token} {index}")
			profile.vunapos_restaurant = self.brand
			profile.vunapos_branch = branch
			profile.insert(ignore_permissions=True)
			self.profiles.append(profile)
			floor = frappe.get_doc(
				{
					"doctype": "Restaurant Floor",
					"restaurant": self.brand,
					"branch": branch,
					"floor_name": "Ground Floor",
				}
			).insert()
			self.floors.append(floor)
			self.tables.append(
				frappe.get_doc(
					{
						"doctype": "Restaurant Table",
						"floor": floor.name,
						"table_label": "1",
						"width": 80,
						"height": 80,
					}
				).insert()
			)
		self.item = ensure_test_item()
		self.section = (
			frappe.get_doc({"doctype": "Menu Section", "section_name": f"Section {self.token}"}).insert().name
		)
		self.default = self._menu("Default")
		frappe.db.set_value("Restaurant", self.brand, "default_menu", self.default.name)
		frappe.clear_document_cache("Restaurant", self.brand)

	def _menu(self, label, **values):
		return frappe.get_doc(
			{
				"doctype": "Restaurant Menu",
				"menu_name": f"{label} {self.token}",
				"company": self.profiles[0].company,
				"items": [{"item_code": self.item, "menu_section": self.section, "available": 1}],
				**values,
			}
		).insert()

	def test_restaurant_has_no_branch_field_and_supports_multiple_profiles(self):
		self.assertFalse(frappe.get_meta("Restaurant").has_field("branch"))
		self.assertEqual(self.profiles[0].vunapos_restaurant, self.profiles[1].vunapos_restaurant)
		self.assertNotEqual(self.profiles[0].vunapos_branch, self.profiles[1].vunapos_branch)
		self.assertTrue(frappe.db.has_index("tabKitchen Station", "unique_restaurant_branch_station_name"))
		self.assertFalse(frappe.db.has_index("tabKitchen Station", "unique_restaurant_station_name"))

	def test_floor_plan_and_table_status_are_branch_scoped(self):
		for index, profile in enumerate(self.profiles):
			plan = get_floor_plan(profile.name)
			self.assertEqual([floor["name"] for floor in plan["floors"]], [self.floors[index].name])
			status = api.get_table_status(profile.name)
			self.assertTrue(status["ok"], status)
			self.assertEqual([row["table"] for row in status["data"]], [self.tables[index].name])

	def test_table_from_other_branch_is_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			resolve_table_floor(self.profiles[0].name, self.tables[1].name)

	def test_menu_precedence_floor_then_branch_then_shared_default(self):
		profile = self.profiles[0]
		branch_menu = self._menu("Branch", restaurant=self.brand, branch=profile.vunapos_branch)
		floor_menu = self._menu(
			"Floor",
			restaurant=self.brand,
			branch=profile.vunapos_branch,
			floor_wise_menu=1,
			floors=[{"floor": self.floors[0].name}],
		)
		self.assertEqual(get_menu_definition(profile, floor=self.floors[0].name)["menu"], floor_menu.name)
		self.assertEqual(get_menu_definition(profile)["menu"], branch_menu.name)
		self.assertEqual(
			get_menu_definition(self.profiles[1], floor=self.floors[1].name)["menu"], self.default.name
		)

	def test_floor_menu_can_assign_multiple_floors(self):
		menu = self._menu(
			"Shared floors",
			restaurant=self.brand,
			floor_wise_menu=1,
			floors=[{"floor": floor.name} for floor in self.floors],
		)
		for profile, floor in zip(self.profiles, self.floors, strict=True):
			self.assertEqual(get_menu_definition(profile, floor=floor.name)["menu"], menu.name)

	def test_duplicate_enabled_floor_assignment_is_rejected(self):
		self._menu("Floor one", floor_wise_menu=1, floors=[{"floor": self.floors[0].name}])
		with self.assertRaises(frappe.ValidationError) as error:
			self._menu("Floor two", floor_wise_menu=1, floors=[{"floor": self.floors[0].name}])
		self.assertEqual(error.exception.vuna_error_code, "MENU_SCOPE_CONFLICT")

	def test_duplicate_branch_menu_is_rejected(self):
		self._menu("Branch one", restaurant=self.brand, branch=self.profiles[0].vunapos_branch)
		with self.assertRaises(frappe.ValidationError):
			self._menu("Branch two", restaurant=self.brand, branch=self.profiles[0].vunapos_branch)

	def test_branch_menu_cannot_target_a_foreign_floor(self):
		with self.assertRaises(frappe.ValidationError) as error:
			self._menu(
				"Wrong floor",
				restaurant=self.brand,
				branch=self.profiles[0].vunapos_branch,
				floor_wise_menu=1,
				floors=[{"floor": self.floors[1].name}],
			)
		self.assertEqual(error.exception.vuna_error_code, "MENU_CONTEXT_MISMATCH")

	def test_disabled_floor_menu_falls_back(self):
		self._menu("Disabled floor", enabled=0, floor_wise_menu=1, floors=[{"floor": self.floors[0].name}])
		self.assertEqual(
			get_menu_definition(self.profiles[0], floor=self.floors[0].name)["menu"], self.default.name
		)

	def test_station_item_groups_can_repeat_across_branches_without_ambiguity(self):
		group = frappe.get_cached_value("Item", self.item, "item_group")
		stations = []
		for profile in self.profiles:
			station = frappe.get_doc(
				{
					"doctype": "Kitchen Station",
					"station_name": "Main Kitchen",
					"restaurant": self.brand,
					"branch": profile.vunapos_branch,
					"item_groups": [{"item_group": group}],
				}
			).insert()
			stations.append(station.name)
			self.assertEqual(
				station_matches(self.brand, [self.item], profile.vunapos_branch)[self.item], {station.name}
			)
		for profile, station in zip(self.profiles, stations, strict=True):
			self.assertEqual(
				station_matches(self.brand, [self.item], profile.vunapos_branch)[self.item], {station}
			)
			line = frappe._dict(item_code=self.item, line_id="line", qty=1)
			route_lines(self.brand, [line], branch=profile.vunapos_branch)
			self.assertEqual(line.routed_station, station)
			self.assertEqual([row.name for row in list_board(profile.name)["stations"]], [station])
			items = [{"item_code": self.item}]
			classify_items(self.brand, items, profile.vunapos_branch)
			self.assertTrue(items[0]["is_qsr"])

	def test_dine_in_menu_and_cart_preview_require_table(self):
		service = next(
			row.service_type
			for row in frappe.get_doc("Restaurant", self.brand).service_types
			if frappe.get_cached_value("Restaurant Service Type", row.service_type, "requires_table")
		)
		for response in (
			api.get_menu(self.profiles[0].name, service_type=service),
			api.preview_cart(self.profiles[0].name, service, [{"item_code": self.item, "qty": 1}]),
			api.validate_cart(self.profiles[0].name, service, [{"item_code": self.item, "qty": 1}]),
		):
			self.assertFalse(response["ok"], response)
			self.assertEqual(response["errors"][0]["code"], "TABLE_REQUIRED")

	def test_restaurant_profile_cannot_omit_operating_branch(self):
		profile = frappe.copy_doc(self.profiles[0])
		profile.vunapos_branch = None
		with self.assertRaises(frappe.ValidationError):
			validate_profile_restaurant(profile)

	def test_legacy_migration_only_backfills_blank_location_links(self):
		from vunapos.patches.v1_0.move_restaurant_branches_to_locations import execute

		with (
			patch("frappe.db.has_column", return_value=True),
			patch("frappe.db.sql", return_value=[frappe._dict(name="Brand", branch="Legacy")]),
			patch(
				"frappe.get_all",
				side_effect=[["Till"], ["Floor"], [], [frappe._dict(name="Table", floor="Floor")]],
			) as get_all,
			patch("frappe.db.get_value", return_value="Legacy"),
			patch("frappe.db.set_value") as set_value,
			patch("frappe.clear_cache"),
		):
			execute()
			self.assertEqual(set_value.call_count, 3)
			self.assertEqual(get_all.call_args_list[0].kwargs["filters"]["vunapos_branch"], ["is", "not set"])

	def test_branch_permissions_restrict_locations_not_the_shared_restaurant(self):
		from vunapos.setup.utils import WAITER_ROLE
		from vunapos.tests.helpers import ensure_test_user

		user = f"branch-{self.token}@example.com"
		for profile in self.profiles:
			ensure_test_user(user, roles=(WAITER_ROLE,), pos_profile=profile.name)
		frappe.get_doc(
			{
				"doctype": "User Permission",
				"user": user,
				"allow": "Branch",
				"for_value": self.profiles[0].vunapos_branch,
				"apply_to_all_doctypes": 1,
			}
		).insert()
		try:
			frappe.set_user(user)
			self.assertTrue(api.get_floor_plan(self.profiles[0].name)["ok"])
			self.assertFalse(api.get_floor_plan(self.profiles[1].name)["ok"])
			self.assertIn(self.brand, frappe.get_list("Restaurant", pluck="name"))
			self.assertEqual(
				frappe.get_list("Restaurant Floor", filters={"restaurant": self.brand}, pluck="name"),
				[self.floors[0].name],
			)
		finally:
			frappe.set_user("Administrator")
