import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.services.floor_plan_service import (
	FLOOR_DOCTYPE,
	TABLE_DOCTYPE,
	get_floor_plan_version,
	save_floor_plan,
)
from vunapos.services.menu_service import allowed_scope
from vunapos.services.restaurant_order_service import ORDER_DOCTYPE
from vunapos.setup.utils import ensure_vunapos_roles
from vunapos.tests.helpers import ensure_test_restaurant_profile, set_invoice_mode

DINE_IN = "Dine In"
TAKEAWAY = "_Test VunaPOS Takeaway"
FOOD_GROUP = "_Test VunaPOS Food"
BAR_GROUP = "_Test VunaPOS Bar"
SPECIALS_GROUP = "_Test VunaPOS Specials"
FOOD_ITEM = "_Test VunaPOS Food Item"
BAR_ITEM = "_Test VunaPOS Bar Item"
SPECIAL_ITEM = "_Test VunaPOS Special Item"


def _ensure_service_type(name, requires_table):
	if not frappe.db.exists("VunaPOS Service Type", name):
		frappe.get_doc(
			{"doctype": "VunaPOS Service Type", "service_type_name": name, "requires_table": requires_table}
		).insert(ignore_permissions=True)


def _ensure_item_group(name):
	if not frappe.db.exists("Item Group", name):
		frappe.get_doc(
			{"doctype": "Item Group", "item_group_name": name, "parent_item_group": "All Item Groups"}
		).insert(ignore_permissions=True)


def _ensure_item(item_code, item_group):
	if frappe.db.exists("Item", item_code):
		return item_code
	values = {
		"doctype": "Item",
		"item_code": item_code,
		"item_name": item_code,
		"item_group": item_group,
		"stock_uom": frappe.db.get_value("UOM", {}, "name"),
		"is_sales_item": 1,
		"is_stock_item": 0,
		"standard_rate": 100,
	}
	if frappe.get_meta("Item").has_field("etims_prevent_etims_registration"):
		values["etims_prevent_etims_registration"] = 1
	frappe.get_doc(values).insert(ignore_permissions=True)
	return item_code


class TestVunaPOSRestaurantMenu(IntegrationTestCase):
	"""get_menu before a table is chosen (menu-first ordering)."""

	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		ensure_vunapos_roles()
		set_invoice_mode("Sales Invoice")
		cls.profile = ensure_test_restaurant_profile()
		_ensure_service_type(DINE_IN, 1)
		_ensure_service_type(TAKEAWAY, 0)
		for group in (FOOD_GROUP, BAR_GROUP, SPECIALS_GROUP):
			_ensure_item_group(group)
		cls.food_item = _ensure_item(FOOD_ITEM, FOOD_GROUP)
		cls.food_group = FOOD_GROUP
		_ensure_item(BAR_ITEM, BAR_GROUP)
		_ensure_item(SPECIAL_ITEM, SPECIALS_GROUP)
		cls.floors, cls.tables = cls._create_floor_plan()
		profile = frappe.get_doc("POS Profile", cls.profile)
		profile.set("vunapos_restaurant_menu", [])
		# Food everywhere, the bar on the terrace only, specials for dine in only.
		profile.append("vunapos_restaurant_menu", {"item_group": cls.food_group, "label": "Food"})
		profile.append(
			"vunapos_restaurant_menu",
			{"item_group": BAR_GROUP, "label": "Bar", "floor": cls.floors["terrace"]},
		)
		profile.append(
			"vunapos_restaurant_menu",
			{"item_group": SPECIALS_GROUP, "label": "Specials", "service_type": DINE_IN},
		)
		profile.save(ignore_permissions=True)

	@classmethod
	def tearDownClass(cls):
		frappe.set_user("Administrator")
		# Menu rows link to the floors, which other test classes rebuild.
		profile = frappe.get_doc("POS Profile", cls.profile)
		profile.set("vunapos_restaurant_menu", [])
		profile.save(ignore_permissions=True)
		super().tearDownClass()

	@classmethod
	def _create_floor_plan(cls):
		frappe.db.delete(ORDER_DOCTYPE, {"pos_profile": cls.profile})
		for name in frappe.get_all(TABLE_DOCTYPE, filters={"pos_profile": cls.profile}, pluck="name"):
			frappe.delete_doc(TABLE_DOCTYPE, name, ignore_permissions=True)
		profile = frappe.get_doc("POS Profile", cls.profile)
		profile.set("vunapos_restaurant_menu", [])
		profile.save(ignore_permissions=True)
		for name in frappe.get_all(FLOOR_DOCTYPE, filters={"pos_profile": cls.profile}, pluck="name"):
			frappe.delete_doc(FLOOR_DOCTYPE, name, ignore_permissions=True)

		def table(client_id, label):
			return {
				"client_id": client_id,
				"table_label": label,
				"seats": 4,
				"shape": "Square",
				"x": 100,
				"y": 100,
				"width": 80,
				"height": 80,
			}

		result = save_floor_plan(
			cls.profile,
			{
				"version": get_floor_plan_version(cls.profile),
				"floors": [
					{
						"client_id": "main",
						"floor_name": "Main Hall",
						"elements": [],
						"tables": [table("t1", "T1")],
					},
					{
						"client_id": "terrace",
						"floor_name": "Terrace",
						"elements": [],
						"tables": [table("r1", "R1")],
					},
				],
			},
		)
		return result["id_map"]["floors"], {
			"main": result["id_map"]["tables"]["t1"],
			"terrace": result["id_map"]["tables"]["r1"],
		}

	def _menu(self, service_type=None, table=None):
		response = restaurant.get_menu(self.profile, service_type=service_type, table=table)
		self.assertTrue(response["ok"], response)
		return response["data"]

	def _items(self, menu):
		return {
			item["item_code"]: (item["allowed_floors"], item["allowed_service_types"])
			for item in menu["items"]
			if item["item_code"] in (self.food_item, BAR_ITEM, SPECIAL_ITEM)
		}

	def test_without_a_table_a_table_service_type_spans_every_floor(self):
		menu = self._menu(DINE_IN)
		self.assertEqual(
			self._items(menu),
			{
				self.food_item: (None, None),
				BAR_ITEM: ([self.floors["terrace"]], None),
				SPECIAL_ITEM: (None, None),
			},
		)
		self.assertEqual(menu["floors"], [{"floor": self.floors["terrace"], "floor_name": "Terrace"}])
		self.assertIn("Bar", [row["label"] for row in menu["categories"]])

	def test_a_table_limits_the_menu_to_its_floor(self):
		self.assertEqual(
			set(self._items(self._menu(DINE_IN, self.tables["main"]))), {self.food_item, SPECIAL_ITEM}
		)
		self.assertEqual(
			set(self._items(self._menu(DINE_IN, self.tables["terrace"]))),
			{self.food_item, BAR_ITEM, SPECIAL_ITEM},
		)

	def test_a_service_type_without_tables_never_gets_floor_items(self):
		menu = self._menu(TAKEAWAY)
		self.assertEqual(self._items(menu), {self.food_item: (None, None)})
		self.assertEqual(menu["floors"], [])

	def test_without_a_service_type_every_type_and_floor_is_listed(self):
		self.assertEqual(
			self._items(self._menu()),
			{
				self.food_item: (None, None),
				BAR_ITEM: ([self.floors["terrace"]], None),
				SPECIAL_ITEM: (None, [DINE_IN]),
			},
		)

	def test_allowed_scope_opens_up_when_any_row_is_unrestricted(self):
		scopes = [
			{"item_groups": {"Bar"}, "floor": "Terrace", "service_type": None},
			{"item_groups": {"Bar"}, "floor": "VIP", "service_type": "Dine In"},
			{"item_groups": {"Food"}, "floor": None, "service_type": "Dine In"},
		]
		self.assertEqual(allowed_scope("Bar", scopes), {"floors": ["Terrace", "VIP"], "service_types": None})
		self.assertEqual(allowed_scope("Food", scopes), {"floors": None, "service_types": ["Dine In"]})
		self.assertEqual(allowed_scope("Other", []), {"floors": None, "service_types": None})
