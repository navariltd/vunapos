import json
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api.restaurant import get_floor_plan, save_floor_plan
from vunapos.dto.profile import profile_to_dict
from vunapos.services.floor_plan_service import FLOOR_DOCTYPE, TABLE_DOCTYPE
from vunapos.setup.utils import RESTAURANT_MANAGER_ROLE
from vunapos.tests.helpers import (
	ensure_test_pos_profile,
	ensure_test_restaurant_profile,
	ensure_test_user,
)

WAITER = "_test_vunapos_waiter@example.com"
OUTSIDER = "_test_vunapos_outsider@example.com"
FLOOR_MANAGER = "_test_vunapos_floor_manager@example.com"


def _table(client_id="t1", table_label="T1", **values):
	return {
		"client_id": client_id,
		"table_label": table_label,
		"seats": 4,
		"shape": "Square",
		"x": 100,
		"y": 100,
		"width": 80,
		"height": 80,
		**values,
	}


def _floor(client_id="f1", floor_name="Main Hall", tables=None, elements=None, **values):
	return {
		"client_id": client_id,
		"floor_name": floor_name,
		"display_order": 0,
		"elements": elements or [],
		"tables": tables or [],
		**values,
	}


def _existing(row, **values):
	"""Turn a loaded floor or table back into a payload row for an update."""
	row = {key: value for key, value in row.items() if key not in ("client_id", "floor")}
	return {**row, **values}


class TestVunaPOSFloorPlan(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.profile = ensure_test_restaurant_profile()
		for name in frappe.get_all(TABLE_DOCTYPE, filters={"pos_profile": self.profile}, pluck="name"):
			frappe.delete_doc(TABLE_DOCTYPE, name, ignore_permissions=True)
		for name in frappe.get_all(FLOOR_DOCTYPE, filters={"pos_profile": self.profile}, pluck="name"):
			frappe.delete_doc(FLOOR_DOCTYPE, name, ignore_permissions=True)

	def tearDown(self):
		frappe.set_user("Administrator")

	def _load(self):
		response = get_floor_plan(self.profile)
		self.assertTrue(response["ok"], response)
		return response["data"]

	def _save(self, floors, version=None):
		if version is None:
			version = self._load()["version"]
		return save_floor_plan(self.profile, {"version": version, "floors": floors})

	def _save_ok(self, floors):
		response = self._save(floors)
		self.assertTrue(response["ok"], response)
		return response["data"]

	def _assert_error(self, response, code):
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], code, response)

	def _floor_count(self):
		return frappe.db.count(FLOOR_DOCTYPE, {"pos_profile": self.profile})

	def test_empty_plan_loads_with_canvas_and_version(self):
		plan = self._load()

		self.assertEqual(plan["floors"], [])
		self.assertEqual(plan["canvas"], {"width": 1000, "height": 700})
		self.assertEqual(plan["pos_mode"], "Restaurant")
		self.assertTrue(plan["can_edit"])
		self.assertTrue(plan["version"])

	def test_save_creates_floor_tables_and_elements(self):
		wall = {"element_type": "Wall", "x": 0, "y": 0, "width": 1000, "height": 20, "rotation": 450}
		result = self._save_ok(
			[_floor(elements=[wall], tables=[_table("t1", "T1"), _table("t2", "T2", x=300, shape="Round")])]
		)

		self.assertEqual(set(result["id_map"]["floors"]), {"f1"})
		self.assertEqual(set(result["id_map"]["tables"]), {"t1", "t2"})
		[floor] = result["plan"]["floors"]
		self.assertEqual(floor["floor_name"], "Main Hall")
		self.assertEqual([table["table_label"] for table in floor["tables"]], ["T1", "T2"])
		self.assertEqual(floor["elements"][0]["rotation"], 90)
		table_name = result["id_map"]["tables"]["t2"]
		self.assertEqual(frappe.db.get_value(TABLE_DOCTYPE, table_name, "pos_profile"), self.profile)
		self.assertEqual(frappe.db.get_value(TABLE_DOCTYPE, table_name, "shape"), "Round")

	def test_save_accepts_a_json_string_payload(self):
		version = self._load()["version"]
		response = save_floor_plan(
			self.profile, json.dumps({"version": version, "floors": [_floor(tables=[_table()])]})
		)

		self.assertTrue(response["ok"], response)
		self.assertEqual(len(response["data"]["plan"]["floors"][0]["tables"]), 1)

	def test_save_updates_moves_and_deletes_in_one_call(self):
		plan = self._save_ok(
			[
				_floor("a", "Hall", tables=[_table("t1", "T1"), _table("t2", "T2", x=300)]),
				_floor("b", "Patio", tables=[_table("t3", "T3")]),
			]
		)["plan"]
		hall, patio = sorted(plan["floors"], key=lambda floor: floor["floor_name"])
		t1, t2 = hall["tables"]
		[t3] = patio["tables"]

		result = self._save_ok(
			[
				_existing(
					hall,
					floor_name="Main Hall",
					elements=[],
					tables=[_existing(t1, table_label="T10"), _existing(t3, x=500)],
				)
			]
		)

		self.assertFalse(frappe.db.exists(FLOOR_DOCTYPE, patio["name"]))
		self.assertFalse(frappe.db.exists(TABLE_DOCTYPE, t2["name"]))
		self.assertEqual(frappe.db.get_value(TABLE_DOCTYPE, t3["name"], "floor"), hall["name"])
		self.assertEqual(frappe.db.get_value(TABLE_DOCTYPE, t1["name"], "table_label"), "T10")
		self.assertEqual(result["plan"]["floors"][0]["floor_name"], "Main Hall")

	def test_labels_can_be_swapped_in_one_save(self):
		[floor] = self._save_ok([_floor(tables=[_table("t1", "T1"), _table("t2", "T2", x=300)])])["plan"][
			"floors"
		]
		t1, t2 = floor["tables"]

		self._save_ok(
			[_existing(floor, tables=[_existing(t1, table_label="T2"), _existing(t2, table_label="T1")])]
		)

		self.assertEqual(frappe.db.get_value(TABLE_DOCTYPE, t1["name"], "table_label"), "T2")
		self.assertEqual(frappe.db.get_value(TABLE_DOCTYPE, t2["name"], "table_label"), "T1")

	def test_validation_failures_save_nothing(self):
		cases = {
			"DUPLICATE_TABLE_LABEL": [_floor(tables=[_table("t1", "T1"), _table("t2", " t1 ", x=300)])],
			"DUPLICATE_FLOOR_NAME": [_floor("a", "Hall"), _floor("b", "hall ")],
			"ELEMENT_OUT_OF_CANVAS": [_floor(tables=[_table(x=950)])],
			"INVALID_SEATS": [_floor(tables=[_table(seats=0)])],
			"INVALID_FLOOR_PLAN": [
				_floor(elements=[{"element_type": "Fountain", "x": 0, "y": 0, "width": 10, "height": 10}])
			],
			"FLOOR_PROFILE_MISMATCH": [_existing(_floor(), name="not-a-floor-of-this-profile")],
		}
		# A valid first floor must not be written when a later floor is invalid.
		cases["ELEMENT_OUT_OF_CANVAS"].insert(0, _floor("ok", "Terrace", tables=[_table("ok", "T9")]))
		for code, floors in cases.items():
			with self.subTest(code=code):
				self._assert_error(self._save(floors), code)
				self.assertEqual(self._floor_count(), 0)

	def test_retail_profile_is_rejected(self):
		retail_profile = ensure_test_pos_profile()
		frappe.db.set_value("POS Profile", retail_profile, "vunapos_pos_mode", "Retail")

		self._assert_error(get_floor_plan(retail_profile), "POS_MODE_NOT_RESTAURANT")
		self._assert_error(
			save_floor_plan(retail_profile, {"version": "", "floors": [_floor()]}),
			"POS_MODE_NOT_RESTAURANT",
		)
		self.assertFalse(frappe.db.exists(FLOOR_DOCTYPE, {"pos_profile": retail_profile}))

	def test_waiter_can_read_active_layout_but_not_save(self):
		ensure_test_user(WAITER, roles=("Sales User",), pos_profile=self.profile)
		self._save_ok(
			[
				_floor(tables=[_table("t1", "T1"), _table("t2", "T2", x=300, is_active=0)]),
				_floor("b", "Closed", is_active=0),
			]
		)

		frappe.set_user(WAITER)
		plan = self._load()
		self.assertFalse(plan["can_edit"])
		self.assertEqual([floor["floor_name"] for floor in plan["floors"]], ["Main Hall"])
		self.assertEqual([table["table_label"] for table in plan["floors"][0]["tables"]], ["T1"])
		self._assert_error(
			save_floor_plan(self.profile, {"version": plan["version"], "floors": []}),
			"FLOOR_PLAN_PERMISSION_DENIED",
		)
		frappe.set_user("Administrator")
		self.assertEqual(self._floor_count(), 2)

	def test_unassigned_user_cannot_read(self):
		ensure_test_user(OUTSIDER, roles=("Sales User",))
		frappe.set_user(OUTSIDER)

		self._assert_error(get_floor_plan(self.profile), "POS_PROFILE_NOT_ASSIGNED")

	def test_restaurant_manager_can_save_without_profile_assignment(self):
		ensure_test_user(FLOOR_MANAGER, roles=(RESTAURANT_MANAGER_ROLE,))
		frappe.set_user(FLOOR_MANAGER)

		self._save_ok([_floor(tables=[_table()])])

		frappe.set_user("Administrator")
		self.assertEqual(self._floor_count(), 1)

	def test_stale_or_missing_version_is_rejected(self):
		stale_version = self._load()["version"]
		self._save_ok([_floor()])

		self._assert_error(self._save([_floor("b", "Patio")], version=stale_version), "FLOOR_PLAN_CONFLICT")
		self._assert_error(self._save([_floor("b", "Patio")], version=""), "FLOOR_PLAN_CONFLICT")
		self.assertEqual(self._floor_count(), 1)

	def test_failure_during_writes_rolls_back_everything(self):
		[floor] = self._save_ok([_floor(tables=[_table()])])["plan"]["floors"]
		[table] = floor["tables"]

		with patch(
			"vunapos.services.floor_plan_service._upsert_table",
			side_effect=RuntimeError("simulated write failure"),
		):
			# Deletes T1, renames the floor, then fails while adding T5.
			response = self._save([_existing(floor, floor_name="Renamed", tables=[_table("t5", "T5")])])

		self._assert_error(response, "RuntimeError")
		self.assertTrue(frappe.db.exists(TABLE_DOCTYPE, table["name"]))
		self.assertEqual(frappe.db.get_value(FLOOR_DOCTYPE, floor["name"], "floor_name"), "Main Hall")
		self.assertFalse(frappe.db.exists(TABLE_DOCTYPE, {"table_label": "T5", "pos_profile": self.profile}))

	def test_desk_edits_use_the_same_validators(self):
		[floor] = self._save_ok([_floor(tables=[_table()])])["plan"]["floors"]
		duplicate = frappe.get_doc(
			{
				"doctype": TABLE_DOCTYPE,
				"floor": floor["name"],
				"table_label": "t1",
				"seats": 2,
				"x": 300,
				"y": 300,
				"width": 80,
				"height": 80,
			}
		)

		with self.assertRaises(frappe.ValidationError) as raised:
			duplicate.insert(ignore_permissions=True)
		self.assertEqual(raised.exception.vuna_error_code, "DUPLICATE_TABLE_LABEL")

		duplicate.table_label = "T2"
		duplicate.pos_profile = None
		duplicate.insert(ignore_permissions=True)
		self.assertEqual(duplicate.pos_profile, self.profile)
		self.assertEqual(duplicate.shape, "Square")

	def test_profile_dto_exposes_pos_mode_with_retail_fallback(self):
		profile = frappe.get_doc("POS Profile", self.profile)
		self.assertEqual(profile_to_dict(profile, "Sales Invoice")["pos_mode"], "Restaurant")

		profile.vunapos_pos_mode = "Unknown"
		self.assertEqual(profile_to_dict(profile, "Sales Invoice")["pos_mode"], "Retail")
