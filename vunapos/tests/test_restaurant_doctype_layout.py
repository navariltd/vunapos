"""Source-level checks for restaurant Desk forms, without a running site."""

import json
from pathlib import Path
from unittest import TestCase

DOCTYPE_PATH = Path(__file__).resolve().parents[1] / "vunapos" / "doctype"
LAYOUT_TYPES = {"Section Break", "Column Break", "Tab Break"}


def restaurant_schemas():
	return {
		doc["name"]: doc
		for path in DOCTYPE_PATH.glob("*/*.json")
		if (doc := json.loads(path.read_text()))["name"].startswith(("Restaurant", "Kitchen"))
		or doc["name"] == "Menu Section"
	}


class TestRestaurantDocTypeLayout(TestCase):
	@classmethod
	def setUpClass(cls):
		cls.schemas = restaurant_schemas()

	def test_field_orders_include_every_field_exactly_once(self):
		for name, doc in self.schemas.items():
			with self.subTest(doctype=name):
				fields = [field["fieldname"] for field in doc["fields"]]
				self.assertEqual(len(fields), len(set(fields)))
				self.assertCountEqual(doc["field_order"], fields)

	def test_restaurant_child_tables_link_to_child_doctypes(self):
		for name, doc in self.schemas.items():
			for field in doc["fields"]:
				if field["fieldtype"] == "Table":
					with self.subTest(doctype=name, field=field["fieldname"]):
						self.assertTrue(self.schemas[field["options"]]["istable"])

	def test_explicit_grid_widths_fit_frappe_grid(self):
		for name, doc in self.schemas.items():
			if doc.get("istable"):
				with self.subTest(doctype=name):
					columns = sum(
						field.get("columns", 0) for field in doc["fields"] if field.get("in_list_view")
					)
					self.assertLessEqual(columns, 10)

	def test_primary_workflows_precede_references(self):
		for name, primary, secondary in (
			("Restaurant Table", "table_label", "geometry_section"),
			("Restaurant Menu", "items", "item_groups"),
			("Restaurant Session", "tables", "billing_section"),
			("Kitchen Order Ticket", "status", "items"),
			("Kitchen Order Ticket", "items", "references_section"),
			("Kitchen Order Ticket Item", "item_code", "sales_order_item"),
			("Kitchen Ticket Action", "outcome", "references_section"),
		):
			with self.subTest(doctype=name):
				order = self.schemas[name]["field_order"]
				self.assertLess(order.index(primary), order.index(secondary))

	def test_floor_assignment_grids_are_full_width(self):
		for name, section in (
			("Kitchen Station", "floor_scope_section"),
			("Restaurant Menu", "applicability_section"),
		):
			with self.subTest(doctype=name):
				doc = self.schemas[name]
				order = doc["field_order"]
				fields = {field["fieldname"]: field for field in doc["fields"]}
				self.assertEqual(fields[section]["fieldtype"], "Section Break")
				between = order[order.index(section) + 1 : order.index("floors")]
				self.assertFalse(any(fields[field]["fieldtype"] in LAYOUT_TYPES for field in between))
				self.assertEqual(fields["floors"]["mandatory_depends_on"], fields["floors"]["depends_on"])

	def test_legacy_menu_data_and_technical_fields_remain_hidden(self):
		for name, hidden in (
			("Restaurant Menu", ("item_groups", "modifier_assignments")),
			("Restaurant Session", ("idempotency_key", "billing_fingerprint")),
			("Kitchen Order Ticket", ("event_key",)),
			("Kitchen Order Ticket Item", ("line_id", "parent_line_id")),
			("Kitchen Ticket Action", ("request_key", "success_key")),
		):
			fields = {field["fieldname"]: field for field in self.schemas[name]["fields"]}
			for field in hidden:
				with self.subTest(doctype=name, field=field):
					self.assertTrue(fields[field]["hidden"])

	def test_canvas_coordinates_are_numeric(self):
		for name in ("Restaurant Table", "Restaurant Floor Element"):
			fields = {field["fieldname"]: field for field in self.schemas[name]["fields"]}
			for field in ("x", "y", "width", "height", "rotation"):
				with self.subTest(doctype=name, field=field):
					self.assertEqual(fields[field]["fieldtype"], "Float")

	def test_session_table_grid_exposes_assignment_and_release(self):
		fields = {field["fieldname"]: field for field in self.schemas["Restaurant Session Table"]["fields"]}
		for field in ("table", "assigned_at", "released_at"):
			self.assertTrue(fields[field]["in_list_view"])
