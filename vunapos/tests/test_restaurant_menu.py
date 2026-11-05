from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.services.menu_service import get_menu, get_menu_definition
from vunapos.services.modifier_service import assigned_groups, resolve_selections
from vunapos.services.service_type_service import get_profile_service_types
from vunapos.tests.helpers import (
	ensure_open_pos_opening_entry,
	ensure_test_item,
	ensure_test_restaurant_profile,
)


class TestRestaurantMenu(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.profile = frappe.get_doc("POS Profile", ensure_test_restaurant_profile())
		ensure_open_pos_opening_entry(self.profile.name)
		self.token = uuid4().hex[:8]
		self.section = frappe.get_doc(
			{"doctype": "Menu Section", "section_name": f"Drinks {self.token}"}
		).insert()
		self.main = self._item("Main", 100)
		self.addon = self._item("Extra", 25)
		self.group = frappe.get_doc(
			{
				"doctype": "Restaurant Modifier Group",
				"group_name": f"Milk {self.token}",
				"min_selections": 1,
				"max_selections": 1,
				"options": [
					{"option_label": "Plain", "enabled": 1},
					{"option_label": "Extra milk", "enabled": 1, "addon_item": self.addon, "addon_qty": 3},
				],
			}
		).insert()
		item = frappe.get_doc("Item", self.main)
		item.append("vunapos_restaurant_modifiers", {"modifier_group": self.group.name, "enabled": 1})
		item.save()
		self.menu = frappe.get_doc(
			{
				"doctype": "Restaurant Menu",
				"menu_name": f"Menu {self.token}",
				"company": self.profile.company,
				"items": [{"item_code": self.main, "menu_section": self.section.name, "available": 1}],
			}
		).insert()
		frappe.db.set_value("Restaurant", self.profile.vunapos_restaurant, "default_menu", self.menu.name)
		frappe.clear_document_cache("Restaurant", self.profile.vunapos_restaurant)
		self.service = next(
			row["name"] for row in get_profile_service_types(self.profile) if not row["requires_table"]
		)

	def tearDown(self):
		frappe.clear_document_cache("Restaurant", self.profile.vunapos_restaurant)

	def _item(self, label, rate):
		item = frappe.copy_doc(frappe.get_doc("Item", ensure_test_item()))
		item.item_code = f"_Test Restaurant {label} {self.token}"
		item.item_name = item.item_code
		item.standard_rate = rate
		item.set("barcodes", [])
		item.insert()
		price = frappe.db.get_value(
			"Item Price", {"item_code": item.name, "price_list": self.profile.selling_price_list}, "name"
		)
		if price:
			frappe.db.set_value("Item Price", price, "price_list_rate", rate)
		else:
			frappe.get_doc(
				{
					"doctype": "Item Price",
					"item_code": item.name,
					"price_list": self.profile.selling_price_list,
					"price_list_rate": rate,
					"selling": 1,
					"currency": self.profile.currency,
				}
			).insert()
		return item.name

	def _selection(self, index=0):
		return {"group": self.group.name, "option": self.group.options[index].name}

	def _round(self, selections, qty=2, key=None, session=None):
		if not session:
			opened = restaurant.open_session(self.profile.name, str(uuid4()), service_type=self.service)
			self.assertTrue(opened["ok"], opened)
			session = opened["data"]["name"]
		return restaurant.create_session_round(
			session,
			[{"item_code": self.main, "qty": qty, "line_id": "main-line", "modifiers": selections}],
			key or str(uuid4()),
		)

	def test_sections_are_independent_of_item_groups(self):
		result = get_menu(self.profile.name, self.service)
		self.assertEqual(
			result["categories"], [{"item_group": self.section.name, "label": self.section.section_name}]
		)
		self.assertEqual([row["item_code"] for row in result["items"]], [self.main])
		self.assertEqual(result["items"][0]["menu_category"], self.section.name)
		self.assertEqual(result["modifier_groups"][self.main][0]["min_selections"], 1)

	def test_unavailable_item_cannot_be_ordered(self):
		self.menu.items[0].available = 0
		self.menu.save()
		self.assertEqual(get_menu(self.profile.name, self.service)["items"], [])
		response = self._round([self._selection()])
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "MENU_ITEM_NOT_AVAILABLE")

	def test_required_choices_are_enforced_on_server(self):
		response = self._round([])
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "INVALID_MODIFIERS")

	def test_rejects_duplicate_unknown_and_excess_choices(self):
		for choices in (
			[self._selection(), self._selection()],
			[self._selection(), self._selection(1)],
			[{"group": "Other", "option": "Fake"}],
			[{"group": self.group.name, "option": "Fake"}],
		):
			with self.subTest(choices=choices):
				with self.assertRaises(frappe.ValidationError):
					resolve_selections(self.main, choices)

	def test_disabled_choices_rejected_after_catalogue_was_loaded(self):
		self.group.options[0].enabled = 0
		self.group.save()
		response = self._round([self._selection()])
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "INVALID_MODIFIERS")

	def test_instruction_only_choice_does_not_create_stock_row(self):
		response = self._round([self._selection()])
		self.assertTrue(response["ok"], response)
		self.assertEqual(len(response["data"]["items"]), 1)
		self.assertEqual(response["data"]["items"][0]["modifiers"][0]["label"], "Plain")

	def test_retry_does_not_duplicate_addon_rows(self):
		opened = restaurant.open_session(self.profile.name, str(uuid4()), service_type=self.service)
		self.assertTrue(opened["ok"], opened)
		key = str(uuid4())
		first = self._round([self._selection(1)], key=key, session=opened["data"]["name"])
		retry = self._round([self._selection(1)], key=key, session=opened["data"]["name"])
		self.assertTrue(first["ok"], first)
		self.assertTrue(retry["ok"], retry)
		self.assertEqual(first["data"]["name"], retry["data"]["name"])
		self.assertEqual(len(retry["data"]["items"]), 2)

	def test_menu_migration_preserves_legacy_exclusions_and_is_idempotent(self):
		from vunapos.patches.v1_0.migrate_menu_sections import execute

		group = frappe.db.get_value("Item", self.main, "item_group")
		legacy = frappe.get_doc(
			{
				"doctype": "Restaurant Menu",
				"menu_name": f"Legacy {self.token}",
				"item_groups": [{"item_group": group, "label": f"Legacy section {self.token}"}],
				"items": [{"item_code": self.addon, "action": "Exclude"}],
			}
		).insert()
		with patch("vunapos.setup.utils.ensure_vunapos_custom_fields"):
			execute()
			legacy.reload()
			count = len(legacy.items)
			self.assertEqual(
				next(row for row in legacy.items if row.item_code == self.addon).action, "Exclude"
			)
			self.assertTrue(next(row for row in legacy.items if row.item_code == self.main).menu_section)
			execute()
			legacy.reload()
			self.assertEqual(len(legacy.items), count)

	def test_menu_migration_converts_single_item_menus_too(self):
		from vunapos.patches.v1_0.migrate_menu_sections import execute

		frappe.db.set_value("Restaurant Menu Item", self.menu.items[0].name, "menu_section", None)
		frappe.clear_document_cache("Restaurant Menu", self.menu.name)
		with patch("vunapos.setup.utils.ensure_vunapos_custom_fields"):
			execute()
		self.menu.reload()
		self.assertTrue(self.menu.items[0].menu_section)

	def test_addon_scales_with_quantity_and_ignores_client_price(self):
		selection = {**self._selection(1), "rate": 0, "addon_qty": 999, "addon_item": self.main}
		response = self._round([selection])
		self.assertTrue(response["ok"], response)
		main, addon = response["data"]["items"]
		self.assertEqual(addon["item_code"], self.addon)
		self.assertEqual(addon["qty"], 6)
		self.assertEqual(addon["rate"], 25)
		self.assertEqual(addon["parent_line_id"], main["line_id"])
		self.assertEqual(main["modifiers"][0]["addon_qty"], 3)
		# Updating configuration later does not rewrite a committed snapshot.
		self.group.options[1].option_label = "New label"
		self.group.save()
		reloaded = restaurant.get_order(response["data"]["name"])
		self.assertEqual(reloaded["data"]["items"][0]["modifiers"][0]["label"], "Extra milk")

	def test_missing_addon_price_is_not_silently_free(self):
		frappe.db.delete("Item Price", {"item_code": self.addon})
		response = self._round([self._selection(1)])
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "ADDON_PRICE_REQUIRED")
		option = get_menu(self.profile.name, self.service)["modifier_groups"][self.main][0]["options"][1]
		self.assertFalse(option["available"])

	def test_addon_uom_conversion_is_handled_by_erpnext(self):
		item = frappe.get_doc("Item", self.addon)
		unit = frappe.db.get_value("UOM", {"name": ["!=", item.stock_uom]}, "name")
		self.assertTrue(unit)
		item.append("uoms", {"uom": unit, "conversion_factor": 2})
		item.save()
		self.group.options[1].uom = unit
		self.group.save()
		response = self._round([self._selection(1)])
		self.assertTrue(response["ok"], response)
		doc = frappe.get_doc("Sales Order", response["data"]["name"])
		addon = next(row for row in doc.items if row.item_code == self.addon)
		self.assertEqual(addon.qty, 6)
		self.assertEqual(addon.conversion_factor, 2)
		self.assertEqual(addon.stock_qty, 12)
		self.assertEqual(addon.rate, 50)

	def test_disabled_section_hides_items_and_prevents_new_orders(self):
		self.section.enabled = 0
		self.section.save()
		self.assertEqual(get_menu(self.profile.name, self.service)["items"], [])
		response = self._round([self._selection()])
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "MENU_ITEM_NOT_AVAILABLE")

	def test_explicit_zero_price_addon_is_allowed(self):
		price = frappe.db.get_value(
			"Item Price", {"item_code": self.addon, "price_list": self.profile.selling_price_list}, "name"
		)
		frappe.db.set_value("Item Price", price, "price_list_rate", 0)
		response = self._round([self._selection(1)])
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["items"][1]["rate"], 0)

	def test_exclusion_only_menu_does_not_fall_back_to_inventory_groups(self):
		self.menu.items[0].action = "Exclude"
		self.menu.items[0].menu_section = None
		self.menu.set("modifier_assignments", [])
		self.menu.append("item_groups", {"item_group": frappe.db.get_value("Item", self.main, "item_group")})
		self.menu.save()
		self.assertEqual(get_menu(self.profile.name, self.service)["items"], [])

	def test_template_modifiers_inherit_but_direct_assignments_override(self):
		items = {
			"Template": frappe._dict(
				name="Template",
				vunapos_restaurant_modifiers=[frappe._dict(modifier_group="Group", enabled=1)],
			),
			"Variant": frappe._dict(name="Variant", variant_of="Template"),
			"Override": frappe._dict(
				name="Override",
				variant_of="Template",
				vunapos_restaurant_modifiers=[frappe._dict(modifier_group="Other", enabled=1)],
			),
			"Empty": frappe._dict(name="Empty", variant_of="Template", vunapos_restaurant_options_override=1),
		}
		with (
			patch(
				"frappe.get_cached_doc",
				side_effect=lambda doctype, name: items[name]
				if doctype == "Item"
				else frappe._dict(name=name, enabled=1),
			),
		):
			self.assertEqual(assigned_groups("Variant")[0].name, "Group")
			self.assertEqual(assigned_groups("Override")[0].name, "Other")
			self.assertEqual(assigned_groups("Empty"), [])

	def test_item_addons_are_optional_and_server_owned(self):
		item = frappe.get_doc("Item", self.main)
		item.append(
			"vunapos_restaurant_addons",
			{"addon_item": self.addon, "addon_qty": 2, "enabled": 1, "label": "Extra milk"},
		)
		item.save()
		groups = assigned_groups(self.main)
		addons = next(group for group in groups if group.name.startswith("item-addons:"))
		self.assertEqual(addons.min_selections, 0)
		menu_groups = get_menu(self.profile.name, self.service)["modifier_groups"][self.main]
		self.assertEqual(len(menu_groups), 2)
		plain = self._round([self._selection()])
		self.assertTrue(plain["ok"], plain)
		self.assertEqual(len(plain["data"]["items"]), 1)
		with_addon = self._round(
			[self._selection(), {"group": addons.name, "option": addons.options[0].name, "addon_qty": 999}]
		)
		self.assertTrue(with_addon["ok"], with_addon)
		self.assertEqual(with_addon["data"]["items"][1]["qty"], 4)

	def test_item_configuration_is_shared_by_different_menus(self):
		other = frappe.copy_doc(self.menu)
		other.menu_name = f"Other {self.token}"
		other.insert()
		frappe.db.set_value("Restaurant", self.profile.vunapos_restaurant, "default_menu", other.name)
		frappe.clear_document_cache("Restaurant", self.profile.vunapos_restaurant)
		self.assertEqual(
			get_menu(self.profile.name, self.service)["modifier_groups"][self.main][0]["name"],
			self.group.name,
		)

	def test_item_configuration_applies_without_a_restaurant_menu(self):
		frappe.db.set_value("Restaurant", self.profile.vunapos_restaurant, "default_menu", None)
		frappe.clear_document_cache("Restaurant", self.profile.vunapos_restaurant)
		self.assertEqual(assigned_groups(self.main)[0].name, self.group.name)
		self.assertIn(self.main, get_menu(self.profile.name, self.service)["modifier_groups"])
		self.assertFalse(self._round([])["ok"])

	def test_legacy_menu_groups_migrate_once_without_losing_archive(self):
		from vunapos.patches.v1_0.move_modifiers_to_items import execute

		item = frappe.get_doc("Item", self.main)
		item.set("vunapos_restaurant_modifiers", [])
		item.save()
		self.menu.append("modifier_assignments", {"item_code": self.main, "modifier_group": self.group.name})
		self.menu.save()
		with patch("vunapos.setup.utils.ensure_vunapos_custom_fields"):
			execute()
			execute()
		item.reload()
		self.assertEqual([row.modifier_group for row in item.vunapos_restaurant_modifiers], [self.group.name])
		self.menu.reload()
		self.assertEqual(len(self.menu.modifier_assignments), 1)

	def test_conflicting_legacy_menus_require_explicit_item_defaults(self):
		from vunapos.patches.v1_0.move_modifiers_to_items import execute

		item = frappe.get_doc("Item", self.main)
		item.set("vunapos_restaurant_modifiers", [])
		item.save()
		self.menu.append("modifier_assignments", {"item_code": self.main, "modifier_group": self.group.name})
		self.menu.save()
		group = frappe.copy_doc(self.group)
		group.group_name = f"Other {self.token}"
		group.insert()
		other = frappe.copy_doc(self.menu)
		other.menu_name = f"Other {self.token}"
		other.modifier_assignments[0].modifier_group = group.name
		other.insert()
		with patch("vunapos.setup.utils.ensure_vunapos_custom_fields"):
			with self.assertRaises(frappe.ValidationError):
				execute()
			item.reload()
			self.assertEqual(item.vunapos_restaurant_modifiers, [])
			item.append("vunapos_restaurant_modifiers", {"modifier_group": self.group.name, "enabled": 1})
			item.save()
			execute()
		self.assertEqual(assigned_groups(self.main)[0].name, self.group.name)

	def test_duplicate_addons_and_invalid_addon_quantities_rejected(self):
		item = frappe.get_doc("Item", self.main)
		for _ in range(2):
			item.append("vunapos_restaurant_addons", {"addon_item": self.addon, "addon_qty": 1, "enabled": 1})
		with self.assertRaises(frappe.ValidationError):
			item.save()
		item.vunapos_restaurant_addons.pop()
		item.vunapos_restaurant_addons[0].addon_qty = 0
		with self.assertRaises(frappe.ValidationError):
			item.save()

	def test_duplicate_item_assignments_and_invalid_group_limits_rejected(self):
		item = frappe.get_doc("Item", self.main)
		item.append("vunapos_restaurant_modifiers", {"modifier_group": self.group.name, "enabled": 1})
		with self.assertRaises(frappe.ValidationError):
			item.save()
		self.group.min_selections = 3
		with self.assertRaises(frappe.ValidationError):
			self.group.save()
