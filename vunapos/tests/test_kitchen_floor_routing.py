"""Floor eligibility must agree across catalogue, stock previews and committed KOTs."""

from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.services.kitchen_service import classify_items, generate_tickets, route_lines, station_matches
from vunapos.services.service_type_service import get_profile_service_types
from vunapos.tests import test_kitchen_service as fixtures
from vunapos.tests.helpers import ensure_test_user


class TestKitchenFloorRouting(IntegrationTestCase):
	_item = fixtures.TestKitchenService._item
	_raw_item = fixtures.TestKitchenService._raw_item
	_station = fixtures.TestKitchenService._station
	_send = fixtures.TestKitchenService._send
	_tickets = fixtures.TestKitchenService._tickets
	tearDown = fixtures.TestKitchenService.tearDown

	def setUp(self):
		fixtures.TestKitchenService.setUp(self)
		self.restaurant = self.profile.vunapos_restaurant
		self.floors, self.tables = [], []
		for index in range(2):
			floor = frappe.get_doc(
				{
					"doctype": "Restaurant Floor",
					"restaurant": self.restaurant,
					"branch": self.profile.vunapos_branch,
					"floor_name": f"Kitchen floor {index} {self.token}",
				}
			).insert()
			self.floors.append(floor.name)
			self.tables.append(
				frappe.get_doc(
					{
						"doctype": "Restaurant Table",
						"floor": floor.name,
						"table_label": "1",
						"width": 80,
						"height": 80,
					}
				)
				.insert()
				.name
			)
		self.dine_in = next(
			row["name"] for row in get_profile_service_types(self.profile) if row["requires_table"]
		)

	def _floor_station(self, label, floors, group=None, **values):
		return frappe.get_doc(
			{
				"doctype": "Kitchen Station",
				"station_name": f"{label} {self.token}",
				"restaurant": self.restaurant,
				"branch": self.profile.vunapos_branch,
				"floor_wise_station": 1,
				"floors": [{"floor": floor} for floor in floors],
				"raw_material_warehouse": self.profile.warehouse,
				"item_groups": [{"item_group": group or self.group}],
				**values,
			}
		).insert()

	def _route(self, floor=None, overrides=None):
		line = frappe._dict(line_id="main", item_code=self.item)
		route_lines(self.restaurant, [line], overrides, branch=self.profile.vunapos_branch, floor=floor)
		return line

	def _open_dine_in(self, tables):
		return restaurant.open_session(
			self.profile.name, str(uuid4()), service_type=self.dine_in, tables=tables
		)

	def test_shared_stations_remain_the_default_for_floors_and_takeaway(self):
		for floor in [None, *self.floors]:
			self.assertEqual(self._route(floor).routed_station, self.station)

	def test_disjoint_floor_stations_can_share_a_group_and_override_shared_fallback(self):
		stations = [
			self._floor_station(f"Kitchen {index}", [floor]) for index, floor in enumerate(self.floors)
		]
		for floor, station in zip(self.floors, stations, strict=True):
			self.assertEqual(self._route(floor).routed_station, station.name)
		self.assertEqual(self._route().routed_station, self.station)

	def test_one_station_can_serve_multiple_floors(self):
		station = self._floor_station("Both floors", self.floors)
		for floor in self.floors:
			self.assertEqual(self._route(floor).routed_station, station.name)

	def test_overlapping_floor_and_group_assignments_are_rejected(self):
		self._floor_station("First", [self.floors[0]])
		with self.assertRaises(frappe.ValidationError) as error:
			self._floor_station("Overlap", self.floors)
		self.assertEqual(error.exception.vuna_error_code, "KITCHEN_GROUP_ALREADY_ASSIGNED")

	def test_floor_scope_requires_floors_and_rejects_duplicates(self):
		for floors, code in (
			([], "KITCHEN_STATION_FLOORS_REQUIRED"),
			([self.floors[0], self.floors[0]], "DUPLICATE_STATION_FLOOR"),
		):
			with self.assertRaises(frappe.ValidationError) as error:
				self._floor_station(code, floors)
			self.assertEqual(error.exception.vuna_error_code, code)

	def test_foreign_branch_floor_is_rejected(self):
		branch = frappe.get_doc(
			{
				"doctype": "Branch",
				"branch": f"Other kitchen {self.token}",
				"vunapos_company": self.profile.company,
			}
		).insert()
		floor = frappe.get_doc(
			{
				"doctype": "Restaurant Floor",
				"restaurant": self.restaurant,
				"branch": branch.name,
				"floor_name": f"Foreign {self.token}",
			}
		).insert()
		with self.assertRaises(frappe.ValidationError) as error:
			self._floor_station("Wrong branch", [floor.name])
		self.assertEqual(error.exception.vuna_error_code, "STATION_FLOOR_CONTEXT_MISMATCH")

	def test_temporary_routing_cannot_select_another_floors_station(self):
		other = self._floor_station("Other floor", [self.floors[1]])
		with self.assertRaises(frappe.ValidationError) as error:
			self._route(self.floors[0], {self.item: other.name})
		self.assertEqual(error.exception.vuna_error_code, "INVALID_KITCHEN_STATION")

	def test_more_specific_group_still_wins_before_floor_tie_break(self):
		self._floor_station("Broad floor station", [self.floors[0]], group=self.root)
		self.assertEqual(self._route(self.floors[0]).routed_station, self.station)

	def test_addons_follow_the_parents_floor_station(self):
		station = self._floor_station("Parent station", [self.floors[0]])
		main = frappe._dict(line_id="main", item_code=self.item)
		extra = frappe._dict(line_id="extra", parent_line_id="main", item_code=self.ingredient)
		route_lines(self.restaurant, [main, extra], branch=self.profile.vunapos_branch, floor=self.floors[0])
		self.assertEqual((main.routed_station, extra.routed_station), (station.name, station.name))

	def test_hidden_floor_station_does_not_fall_back_to_visible_shared_station(self):
		self._floor_station("Restricted", [self.floors[0]])
		user = f"floor-waiter-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Waiter",), pos_profile=self.profile.name)
		frappe.get_doc(
			{
				"doctype": "User Permission",
				"user": user,
				"allow": "Kitchen Station",
				"for_value": self.station,
				"applicable_for": "Kitchen Station",
				"apply_to_all_doctypes": 0,
			}
		).insert()
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError):
			self._route(self.floors[0])

	def test_takeaway_without_shared_kitchen_does_not_become_direct_sale(self):
		self._floor_station("Dine in only", [self.floors[0]])
		frappe.get_doc("Kitchen Station", self.station).update({"enabled": 0}).save()
		items = [{"item_code": self.item}]
		classify_items(self.restaurant, items, self.profile.vunapos_branch)
		self.assertTrue(items[0]["is_qsr"])
		with self.assertRaises(frappe.ValidationError) as error:
			self._route()
		self.assertEqual(error.exception.vuna_error_code, "KITCHEN_ROUTING_REQUIRED")
		self.assertEqual(error.exception.vuna_error_meta["items"][0]["reason"], "missing")

	def test_stock_preview_uses_selected_floors_ingredient_warehouse(self):
		warehouse = frappe.copy_doc(frappe.get_doc("Warehouse", self.profile.warehouse))
		warehouse.warehouse_name = f"Empty floor kitchen {self.token}"
		warehouse.insert()
		self._floor_station("Empty pantry", [self.floors[0]], raw_material_warehouse=warehouse.name)
		response = restaurant.validate_cart(
			self.profile.name, self.dine_in, [{"item_code": self.item, "qty": 1}], table=self.tables[0]
		)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "RESTAURANT_STOCK_SHORTAGE")
		self.assertEqual(response["meta"]["shortages"][0]["warehouse"], warehouse.name)
		other = restaurant.validate_cart(
			self.profile.name, self.dine_in, [{"item_code": self.item, "qty": 1}], table=self.tables[1]
		)
		self.assertTrue(other["ok"], other)

	def test_grouped_tables_require_compatible_kitchens(self):
		self._floor_station("One floor", [self.floors[0]])
		response = self._open_dine_in(self.tables)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "SESSION_KITCHEN_SCOPE_MISMATCH")

	def test_floor_kitchen_manufactures_from_its_own_warehouse(self):
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

		warehouse = frappe.copy_doc(frappe.get_doc("Warehouse", self.profile.warehouse))
		warehouse.warehouse_name = f"Floor pantry {self.token}"
		warehouse.insert()
		make_stock_entry(item_code=self.ingredient, to_warehouse=warehouse.name, qty=10, rate=10)
		station = self._floor_station("Own pantry", [self.floors[0]], raw_material_warehouse=warehouse.name)
		opened = self._open_dine_in([self.tables[0]])
		self.assertTrue(opened["ok"], opened)
		self.session = opened["data"]["name"]
		placed = self._send()
		self.assertTrue(placed["ok"], placed)
		ticket = frappe.get_doc("Kitchen Order Ticket", self._tickets(placed["data"]["name"])[0])
		self.assertEqual(ticket.kitchen_station, station.name)
		work_order = frappe.get_doc("Work Order", ticket.items[0].work_order)
		self.assertEqual(work_order.source_warehouse, warehouse.name)
		self.assertEqual(work_order.fg_warehouse, self.profile.warehouse)
		for action, status in (("Accept", "Sent"), ("Start", "Accepted"), ("Ready", "Preparing")):
			response = restaurant.kitchen_action(ticket.name, action, str(uuid4()), status)
			self.assertTrue(response["ok"], response)
		self.assertEqual(
			frappe.db.get_value(
				"Bin", {"item_code": self.ingredient, "warehouse": warehouse.name}, "actual_qty"
			),
			8,
		)
		self.assertEqual(
			frappe.db.get_value(
				"Bin", {"item_code": self.ingredient, "warehouse": self.profile.warehouse}, "actual_qty"
			),
			1000,
		)

	def test_grouped_floors_can_share_the_same_station(self):
		self._floor_station("Both", self.floors)
		response = self._open_dine_in(self.tables)
		self.assertTrue(response["ok"], response)

	def test_moving_table_routes_new_rounds_only_and_preserves_existing_tickets(self):
		stations = [
			self._floor_station(f"Kitchen {index}", [floor]) for index, floor in enumerate(self.floors)
		]
		opened = self._open_dine_in([self.tables[0]])
		self.assertTrue(opened["ok"], opened)
		self.session = opened["data"]["name"]
		first = self._send()
		self.assertTrue(first["ok"], first)
		first_ticket = frappe.get_doc("Kitchen Order Ticket", self._tickets(first["data"]["name"])[0])
		self.assertEqual(first_ticket.kitchen_station, stations[0].name)
		moved = restaurant.update_session(self.session, tables=[self.tables[1]])
		self.assertTrue(moved["ok"], moved)
		second = self._send()
		self.assertTrue(second["ok"], second)
		second_ticket = frappe.get_doc("Kitchen Order Ticket", self._tickets(second["data"]["name"])[0])
		self.assertEqual(second_ticket.kitchen_station, stations[1].name)
		first_ticket.reload()
		self.assertEqual(first_ticket.kitchen_station, stations[0].name)
		generate_tickets(frappe.get_doc("Sales Order", first["data"]["name"]))
		self.assertEqual(self._tickets(first["data"]["name"]), [first_ticket.name])
		work_order = frappe.get_doc("Work Order", second_ticket.items[0].work_order)
		self.assertEqual(work_order.source_warehouse, stations[1].raw_material_warehouse)

	def test_assigned_floor_cannot_be_moved_to_another_branch(self):
		self._floor_station("Floor owner", [self.floors[0]])
		branch = frappe.get_doc(
			{
				"doctype": "Branch",
				"branch": f"New floor branch {self.token}",
				"vunapos_company": self.profile.company,
			}
		).insert()
		# Use a floor without tables to verify the station link itself protects it.
		frappe.delete_doc("Restaurant Table", self.tables[0])
		floor = frappe.get_doc("Restaurant Floor", self.floors[0])
		floor.branch = branch.name
		with self.assertRaises(frappe.ValidationError):
			floor.save()

	def test_routing_changes_preserve_retries_and_billing_of_already_placed_orders(self):
		from vunapos.tests.helpers import set_invoice_mode

		set_invoice_mode("Sales Invoice")
		opened = self._open_dine_in(self.tables)
		self.assertTrue(opened["ok"], opened)
		self.session = opened["data"]["name"]
		key = str(uuid4())
		placed = self._send(key=key)
		self.assertTrue(placed["ok"], placed)
		ticket = self._tickets(placed["data"]["name"])[0]
		for action, status in (("Accept", "Sent"), ("Start", "Accepted"), ("Ready", "Preparing")):
			self.assertTrue(restaurant.kitchen_action(ticket, action, str(uuid4()), status)["ok"])
		self._floor_station("New configuration", [self.floors[0]])
		retry = self._send(key=key)
		self.assertTrue(retry["ok"], retry)
		self.assertEqual(retry["data"]["name"], placed["data"]["name"])
		new_round = self._send()
		self.assertFalse(new_round["ok"], new_round)
		self.assertEqual(new_round["errors"][0]["code"], "SESSION_KITCHEN_SCOPE_MISMATCH")
		preview = restaurant.preview_session_bill(self.session, self.profile.name)
		self.assertTrue(preview["ok"], preview)
		bill = preview["data"]
		total = bill["invoice"]["totals"]["rounded_total"] or bill["invoice"]["totals"]["grand_total"]
		paid = restaurant.checkout_session(
			self.session,
			self.profile.name,
			bill["fingerprint"],
			[{"mode_of_payment": self.profile.payments[0].mode_of_payment, "amount": total}],
		)
		self.assertTrue(paid["ok"], paid)
		self.assertEqual(paid["data"]["session"]["status"], "Settled")
		self.assertEqual(frappe.get_doc("Kitchen Order Ticket", ticket).kitchen_station, self.station)
