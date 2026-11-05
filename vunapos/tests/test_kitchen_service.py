from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.services.kitchen_service import generate_tickets, get_ticket, route_lines
from vunapos.services.service_type_service import get_profile_service_types
from vunapos.tests.helpers import (
	ensure_open_pos_opening_entry,
	ensure_test_item,
	ensure_test_restaurant,
	ensure_test_restaurant_profile,
	ensure_test_user,
)


class TestKitchenService(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.profile = frappe.get_doc("POS Profile", ensure_test_restaurant_profile())
		ensure_open_pos_opening_entry(self.profile.name)
		self.token = uuid4().hex[:8]
		frappe.db.set_single_value("Stock Settings", "enable_stock_reservation", 1)
		frappe.db.set_single_value("Stock Settings", "auto_reserve_stock", 0)
		self.ingredient = self._raw_item()
		self.item = self._item("Main")
		self.group = frappe.db.get_value("Item", self.item, "item_group")
		self.root = frappe.db.get_value("Item Group", {"lft": 1}, "name")
		for name in frappe.get_all(
			"Kitchen Station", filters={"restaurant": self.profile.vunapos_restaurant}, pluck="name"
		):
			frappe.db.set_value("Kitchen Station", name, "enabled", 0)
		self.station = self._station("Main", [self.group])
		service = next(
			row["name"] for row in get_profile_service_types(self.profile) if not row["requires_table"]
		)
		opened = restaurant.open_session(self.profile.name, str(uuid4()), service_type=service)
		self.assertTrue(opened["ok"], opened)
		self.session = opened["data"]["name"]

	def tearDown(self):
		frappe.set_user("Administrator")

	def _item(self, suffix, group=None):
		item = frappe.copy_doc(frappe.get_doc("Item", ensure_test_item()))
		item.item_code = f"_Test Kitchen {suffix} {self.token}"
		item.item_name = item.item_code
		item.set("barcodes", [])
		item.is_stock_item = 1
		if group:
			item.item_group = group
		item.insert(ignore_permissions=True)
		bom = frappe.get_doc(
			{
				"doctype": "BOM",
				"item": item.name,
				"company": self.profile.company,
				"quantity": 1,
				"is_active": 1,
				"is_default": 1,
				"items": [{"item_code": self.ingredient, "qty": 1, "rate": 10}],
			}
		)
		bom.insert(ignore_permissions=True)
		bom.submit()
		return item.name

	def _raw_item(self):
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

		item = frappe.copy_doc(frappe.get_doc("Item", ensure_test_item()))
		item.item_code = f"_Test Ingredient {self.token}"
		item.item_name = item.item_code
		item.is_stock_item = 1
		item.set("barcodes", [])
		item.insert(ignore_permissions=True)
		make_stock_entry(item_code=item.name, to_warehouse=self.profile.warehouse, qty=1000, rate=10)
		return item.name

	def _station(self, suffix, groups, restaurant_name=None, enabled=1):
		return (
			frappe.get_doc(
				{
					"doctype": "Kitchen Station",
					"station_name": f"Kitchen {suffix} {self.token}",
					"restaurant": restaurant_name or self.profile.vunapos_restaurant,
					"enabled": enabled,
					"raw_material_warehouse": self.profile.warehouse,
					"item_groups": [{"item_group": name} for name in groups],
				}
			)
			.insert(ignore_permissions=True)
			.name
		)

	def _send(self, items=None, key=None, routing=None):
		return restaurant.create_session_round(
			self.session,
			items or [{"item_code": self.item, "qty": 2, "line_id": "main"}],
			key or str(uuid4()),
			kitchen_routing=routing,
		)

	def _tickets(self, order=None):
		return frappe.get_all(
			"Kitchen Order Ticket",
			filters={"restaurant_session": self.session, **({"sales_order": order} if order else {})},
			pluck="name",
		)

	def test_sending_round_creates_submitted_snapshot(self):
		result = self._send()
		self.assertTrue(result["ok"], result)
		ticket = frappe.get_doc("Kitchen Order Ticket", self._tickets()[0])
		self.assertEqual(ticket.docstatus, 1)
		self.assertEqual(ticket.sales_order, result["data"]["name"])
		self.assertEqual(ticket.kitchen_station, self.station)
		self.assertEqual(ticket.status, "Sent")
		self.assertEqual(ticket.items[0].qty, 2)
		self.assertEqual(ticket.items[0].line_id, "main")
		work_order = frappe.get_doc("Work Order", ticket.items[0].work_order)
		self.assertEqual(work_order.docstatus, 1)
		self.assertEqual(work_order.sales_order, ticket.sales_order)
		self.assertEqual(work_order.sales_order_item, ticket.items[0].sales_order_item)
		self.assertEqual(work_order.fg_warehouse, self.profile.warehouse)
		self.assertEqual(work_order.required_items[0].stock_reserved_qty, 2)
		self.assertEqual(
			ticket.branch, frappe.get_cached_value("Restaurant", self.profile.vunapos_restaurant, "branch")
		)
		self.assertEqual(len(restaurant.get_session(self.session)["data"]["kitchen_tickets"]), 1)
		self.assertEqual(
			restaurant.get_kitchen_ticket(ticket.name)["data"]["items"][0]["item_code"], self.item
		)

	def test_retry_and_repeated_generation_do_not_duplicate_tickets(self):
		key = str(uuid4())
		first = self._send(key=key)
		self.assertTrue(first["ok"], first)
		retry = self._send(key=key)
		self.assertTrue(retry["ok"], retry)
		self.assertEqual(first["data"]["name"], retry["data"]["name"])
		original = self._tickets()
		generate_tickets(frappe.get_doc("Sales Order", first["data"]["name"]))
		self.assertEqual(self._tickets(), original)
		self.assertTrue(frappe.get_meta("Kitchen Order Ticket").get_field("event_key").unique)

	def test_additional_round_creates_new_event(self):
		self.assertTrue(self._send()["ok"])
		self.assertTrue(self._send()["ok"])
		self.assertEqual(len(self._tickets()), 2)

	def test_unmapped_item_is_direct_sale_and_checks_finished_stock(self):
		doc = frappe.get_doc("Kitchen Station", self.station)
		doc.set("item_groups", [])
		doc.save()
		result = self._send()
		self.assertFalse(result["ok"], result)
		self.assertEqual(result["errors"][0]["code"], "RESTAURANT_STOCK_SHORTAGE")
		self.assertFalse(frappe.db.exists("Sales Order", {"vunapos_restaurant_session": self.session}))
		self.assertEqual(self._tickets(), [])

	def test_most_specific_group_routes_before_parent(self):
		doc = frappe.get_doc("Kitchen Station", self.station)
		doc.set("item_groups", [{"item_group": self.root}])
		doc.save()
		self.assertTrue(self._send()["ok"])
		child_station = self._station("Specific", [self.group])
		result = self._send()
		self.assertTrue(result["ok"], result)
		self.assertEqual(
			frappe.db.get_value(
				"Kitchen Order Ticket", self._tickets(result["data"]["name"])[0], "kitchen_station"
			),
			child_station,
		)

	def test_duplicate_group_is_rejected_in_same_location(self):
		with self.assertRaises(frappe.ValidationError) as error:
			self._station("Duplicate", [self.group])
		self.assertEqual(error.exception.vuna_error_code, "KITCHEN_GROUP_ALREADY_ASSIGNED")
		disabled = self._station("Disabled", [self.group], enabled=0)
		doc = frappe.get_doc("Kitchen Station", disabled)
		doc.enabled = 1
		with self.assertRaises(frappe.ValidationError):
			doc.save()

	def test_hidden_specific_station_does_not_fall_back_to_parent(self):
		doc = frappe.get_doc("Kitchen Station", self.station)
		doc.set("item_groups", [{"item_group": self.root}])
		doc.save()
		self._station("Specific Hidden", [self.group])
		line = frappe._dict(item_code=self.item, line_id="main", parent_line_id=None)
		with patch(
			"vunapos.services.kitchen_service.allowed_stations",
			return_value=[frappe._dict(name=self.station, station_name="Parent")],
		):
			with self.assertRaises(frappe.PermissionError):
				route_lines(self.profile.vunapos_restaurant, [line])

	def test_temporary_routing_does_not_change_station_groups(self):
		doc = frappe.get_doc("Kitchen Station", self.station)
		# Legacy duplicate data must not silently pick a station at runtime.
		overlap = self._station("Overlap", [self.group], enabled=0)
		frappe.db.set_value("Kitchen Station", overlap, "enabled", 1)
		result = self._send(routing={self.item: self.station})
		self.assertTrue(result["ok"], result)
		ticket = frappe.get_doc("Kitchen Order Ticket", self._tickets()[0])
		self.assertEqual(ticket.items[0].temporary_routing, 1)
		doc.reload()
		self.assertEqual([row.item_group for row in doc.item_groups], [self.group])
		self.assertFalse(self._send()["ok"])

	def test_foreign_or_disabled_station_cannot_be_selected(self):
		other = ensure_test_restaurant(f"Other Kitchen {self.token}")
		foreign = self._station("Foreign", [self.group], other)
		for station in (foreign, self.station):
			if station == self.station:
				frappe.db.set_value("Kitchen Station", station, "enabled", 0)
			response = self._send(routing={self.item: station})
			self.assertFalse(response["ok"], response)
			self.assertEqual(response["errors"][0]["code"], "INVALID_KITCHEN_STATION")
		self.assertEqual(self._tickets(), [])

	def test_splits_round_by_station(self):
		group = (
			frappe.get_doc(
				{
					"doctype": "Item Group",
					"item_group_name": f"Bar {self.token}",
					"parent_item_group": self.root,
				}
			)
			.insert()
			.name
		)
		other_item = self._item("Drink", group)
		bar = self._station("Bar", [group])
		response = self._send(items=[{"item_code": self.item, "qty": 1}, {"item_code": other_item, "qty": 3}])
		self.assertTrue(response["ok"], response)
		self.assertEqual(
			{
				frappe.get_cached_value("Kitchen Order Ticket", name, "kitchen_station")
				for name in self._tickets()
			},
			{self.station, bar},
		)

	def test_addons_follow_parent_with_notes_and_modifier_snapshot(self):
		extra_group = (
			frappe.get_doc(
				{
					"doctype": "Item Group",
					"item_group_name": f"Extras {self.token}",
					"parent_item_group": self.root,
				}
			)
			.insert()
			.name
		)
		addon = self._item("Extra", extra_group)
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

		make_stock_entry(item_code=addon, to_warehouse=self.profile.warehouse, qty=10, rate=10)
		self._station("Extras", [extra_group])
		price_list = self.profile.selling_price_list
		if not frappe.db.exists("Item Price", {"item_code": addon, "price_list": price_list}):
			frappe.get_doc(
				{"doctype": "Item Price", "item_code": addon, "price_list": price_list, "price_list_rate": 25}
			).insert()
		item = frappe.get_doc("Item", self.item)
		item.append(
			"vunapos_restaurant_addons", {"addon_item": addon, "addon_qty": 2, "enabled": 1, "label": "Extra"}
		)
		item.save()
		from vunapos.services.modifier_service import assigned_groups

		group = assigned_groups(self.item)[0]
		result = self._send(
			items=[
				{
					"item_code": self.item,
					"qty": 2,
					"line_id": "dish",
					"note": "No salt",
					"modifiers": [{"group": group.name, "option": group.options[0].name}],
				}
			]
		)
		self.assertTrue(result["ok"], result)
		ticket = get_ticket(self._tickets()[0])
		main, extra = ticket["items"]
		self.assertEqual(main["note"], "No salt")
		self.assertEqual(main["modifiers"][0]["label"], "Extra")
		self.assertEqual(extra["parent_line_id"], "dish")
		self.assertEqual(extra["qty"], 4)
		self.assertEqual(len(self._tickets()), 1)
		self.assertEqual(frappe.db.count("Work Order", {"sales_order": ticket["sales_order"]}), 1)
		addon_row = frappe.db.get_value(
			"Sales Order Item",
			{"parent": ticket["sales_order"], "item_code": addon},
			["stock_reserved_qty", "warehouse"],
			as_dict=True,
		)
		self.assertEqual(addon_row.stock_reserved_qty, 4)
		self.assertEqual(addon_row.warehouse, self.profile.warehouse)

	def _preview(self, items, routing=None):
		service = frappe.db.get_value("Restaurant Session", self.session, "service_type")
		return restaurant.validate_cart(self.profile.name, service, items, kitchen_routing=routing)

	def test_preview_checks_ingredients_not_finished_goods_without_writing(self):
		before = frappe.db.count("Work Order")
		result = self._preview([{"item_code": self.item, "qty": 3}])
		self.assertTrue(result["ok"], result)
		self.assertEqual(result["data"]["qsr_items"], [self.item])
		self.assertEqual(frappe.db.count("Work Order"), before)
		self.assertFalse(self._tickets())
		self.assertEqual(result["data"]["invoice"]["doctype"], "Sales Order")
		self.assertEqual(result["data"]["invoice"]["items"][0]["qty"], 3)

	def test_live_preview_uses_native_taxes_and_stable_line_ids_without_saving(self):
		from vunapos.tests.helpers import ensure_sales_tax_template

		template = ensure_sales_tax_template(rate=16, included_in_print_rate=0)
		frappe.db.set_value("POS Profile", self.profile.name, "taxes_and_charges", template)
		frappe.clear_document_cache("POS Profile", self.profile.name)
		service = frappe.db.get_value("Restaurant Session", self.session, "service_type")
		before = frappe.db.count("Sales Order")
		response = restaurant.preview_cart(
			self.profile.name, service, [{"line_id": "tea-1", "item_code": self.item, "qty": 2}]
		)
		self.assertTrue(response["ok"], response)
		preview = response["data"]
		self.assertEqual(preview["items"][0]["row_name"], "tea-1")
		self.assertGreater(preview["totals"]["total_taxes_and_charges"], 0)
		self.assertAlmostEqual(
			preview["totals"]["grand_total"], preview["totals"]["net_total"] * 1.16, places=2
		)
		self.assertEqual(frappe.db.count("Sales Order"), before)

	def test_fractional_recipe_error_names_dish_and_ingredient_before_order_creation(self):
		ingredient = frappe.copy_doc(frappe.get_doc("Item", ensure_test_item()))
		ingredient.item_code = f"_Test Whole Ingredient {self.token}"
		ingredient.item_name = ingredient.item_code
		ingredient.stock_uom = "Nos"
		ingredient.is_stock_item = 1
		ingredient.set("uoms", [{"uom": "Nos", "conversion_factor": 1}])
		ingredient.set("barcodes", [])
		ingredient.insert(ignore_permissions=True)
		frappe.db.set_value("UOM", "Nos", "must_be_whole_number", 1)
		frappe.clear_document_cache("UOM", "Nos")
		frappe.db.set_value("BOM", {"item": self.item}, "is_default", 0)
		bom = frappe.get_doc(
			{
				"doctype": "BOM",
				"item": self.item,
				"company": self.profile.company,
				"quantity": 5,
				"is_default": 1,
				"is_active": 1,
				"items": [{"item_code": ingredient.name, "qty": 2, "rate": 10}],
			}
		)
		bom.insert(ignore_permissions=True)
		bom.submit()
		response = self._send(items=[{"item_code": self.item, "qty": 1}])
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "RESTAURANT_FRACTIONAL_UOM")
		message = response["errors"][0]["message"]
		for value in (self.item, ingredient.name, "0.4", "Nos", bom.name):
			self.assertIn(value, message)
		self.assertNotIn("Row 2", message)
		self.assertFalse(self._tickets())
		self.assertFalse(frappe.db.exists("Sales Order", {"vunapos_restaurant_session": self.session}))

	def test_station_rejects_branch_or_company_from_another_restaurant(self):
		station = frappe.get_doc("Kitchen Station", self.station)
		other = frappe.get_doc("Restaurant", ensure_test_restaurant(f"Foreign Branch {self.token}"))
		station.branch = other.branch
		with self.assertRaises(frappe.ValidationError) as error:
			station.save()
		self.assertEqual(error.exception.vuna_error_code, "STATION_CONTEXT_MISMATCH")

	def test_shared_ingredients_are_aggregated_across_dishes(self):
		other = self._item("Shared")
		result = self._preview([{"item_code": self.item, "qty": 600}, {"item_code": other, "qty": 600}])
		self.assertFalse(result["ok"], result)
		self.assertEqual(result["errors"][0]["code"], "RESTAURANT_STOCK_SHORTAGE")
		shortage = result["meta"]["shortages"][0]
		self.assertEqual(shortage["item_code"], self.ingredient)
		self.assertEqual(shortage["required_qty"], 1200)
		self.assertEqual(shortage["available_qty"], 1000)

	def test_recipe_scales_selling_uom_to_stock_qty(self):
		item = frappe.get_doc("Item", self.item)
		item.append("uoms", {"uom": "Box", "conversion_factor": 24})
		item.save()
		result = self._preview([{"item_code": self.item, "qty": 42, "uom": "Box"}])
		self.assertFalse(result["ok"], result)
		self.assertEqual(result["meta"]["shortages"][0]["required_qty"], 1008)
		result = self._send(items=[{"item_code": self.item, "qty": 2, "uom": "Box"}])
		self.assertTrue(result["ok"], result)
		wo = frappe.get_doc(
			"Work Order", frappe.db.get_value("Work Order", {"sales_order": result["data"]["name"]}, "name")
		)
		self.assertEqual(wo.qty, 48)
		self.assertEqual(wo.required_items[0].stock_reserved_qty, 48)

	def test_qsr_without_active_submitted_default_bom_is_configuration_error(self):
		frappe.db.set_value("BOM", {"item": self.item}, "is_active", 0)
		result = self._preview([{"item_code": self.item, "qty": 1}])
		self.assertFalse(result["ok"], result)
		self.assertEqual(result["errors"][0]["code"], "QSR_BOM_REQUIRED")

	def test_station_requires_raw_material_warehouse(self):
		frappe.db.set_value("Kitchen Station", self.station, "raw_material_warehouse", None)
		frappe.clear_document_cache("Kitchen Station", self.station)
		result = self._preview([{"item_code": self.item, "qty": 1}])
		self.assertFalse(result["ok"], result)
		self.assertEqual(result["errors"][0]["code"], "QSR_WAREHOUSE_REQUIRED")

	def test_reservation_setting_is_not_silently_enabled(self):
		frappe.db.set_single_value("Stock Settings", "enable_stock_reservation", 0)
		response = self._send()
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "RESTAURANT_RESERVATION_REQUIRED")
		self.assertFalse(self._tickets())
		self.assertFalse(frappe.db.exists("Sales Order", {"vunapos_restaurant_session": self.session}))

	def test_other_round_cannot_reuse_reserved_ingredients(self):
		self.assertTrue(self._preview([{"item_code": self.item, "qty": 600}])["ok"])
		first = self._send(items=[{"item_code": self.item, "qty": 600}])
		self.assertTrue(first["ok"], first)
		second = self._send(items=[{"item_code": self.item, "qty": 600}])
		self.assertFalse(second["ok"], second)
		self.assertEqual(second["errors"][0]["code"], "RESTAURANT_STOCK_SHORTAGE")
		self.assertEqual(len(self._tickets()), 1)
		preview = self._preview([{"item_code": self.item, "qty": 600}])
		self.assertFalse(preview["ok"], preview)
		self.assertEqual(preview["meta"]["shortages"][0]["available_qty"], 400)

	def test_two_uom_rows_share_the_same_ingredient_pool(self):
		frappe.db.set_single_value("Selling Settings", "allow_multiple_items", 1)
		item = frappe.get_doc("Item", self.item)
		item.append("uoms", {"uom": "Box", "conversion_factor": 24})
		item.save()
		result = self._preview(
			[
				{"item_code": self.item, "qty": 40, "uom": "Box"},
				{"item_code": self.item, "qty": 41, "uom": item.stock_uom},
			]
		)
		self.assertFalse(result["ok"], result)
		self.assertEqual(result["meta"]["shortages"][0]["required_qty"], 1001)

	def test_unmapped_stock_item_reserves_finished_stock_without_kot(self):
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

		station = frappe.get_doc("Kitchen Station", self.station)
		station.set("item_groups", [])
		station.save()
		make_stock_entry(item_code=self.item, to_warehouse=self.profile.warehouse, qty=10, rate=10)
		result = self._send()
		self.assertTrue(result["ok"], result)
		order = result["data"]["name"]
		self.assertFalse(self._tickets())
		self.assertFalse(frappe.db.exists("Work Order", {"sales_order": order}))
		self.assertEqual(frappe.db.get_value("Sales Order Item", {"parent": order}, "stock_reserved_qty"), 2)

	def test_qsr_badge_is_contextual_not_an_item_flag(self):
		from vunapos.services.kitchen_service import classify_items

		items = [{"item_code": self.item}, {"item_code": ensure_test_item()}]
		classify_items(self.profile.vunapos_restaurant, items)
		self.assertTrue(items[0]["is_qsr"])
		other = ensure_test_restaurant(f"Unmapped {self.token}")
		profile = frappe.copy_doc(self.profile)
		profile.set("__newname", f"_Test Unmapped Till {self.token}")
		profile.vunapos_restaurant = other
		profile.insert(ignore_permissions=True)
		classify_items(other, items)
		self.assertFalse(items[0]["is_qsr"])

	def test_waiter_can_send_without_manufacturing_create_permissions(self):
		user = f"qsr-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Waiter",), pos_profile=self.profile.name)
		frappe.set_user(user)
		from vunapos.services.pos_entry import create_pos_opening_entry

		create_pos_opening_entry(
			self.profile.name,
			[{"mode_of_payment": row.mode_of_payment, "opening_amount": 0} for row in self.profile.payments],
			user,
		)
		self.assertFalse(frappe.has_permission("Work Order", "create"))
		response = self._send()
		self.assertTrue(response["ok"], response)
		self.assertEqual(len(self._tickets()), 1)

	def test_addon_and_base_recipe_share_ingredient_availability(self):
		from vunapos.services.modifier_service import assigned_groups

		item = frappe.get_doc("Item", self.item)
		item.append(
			"vunapos_restaurant_addons",
			{"addon_item": self.ingredient, "addon_qty": 2, "enabled": 1, "label": "Extra ingredient"},
		)
		item.save()
		if not frappe.db.exists(
			"Item Price", {"item_code": self.ingredient, "price_list": self.profile.selling_price_list}
		):
			frappe.get_doc(
				{
					"doctype": "Item Price",
					"item_code": self.ingredient,
					"price_list": self.profile.selling_price_list,
					"price_list_rate": 10,
				}
			).insert()
		group = assigned_groups(self.item)[0]
		response = self._preview(
			[
				{
					"item_code": self.item,
					"qty": 400,
					"modifiers": [{"group": group.name, "option": group.options[0].name}],
				}
			]
		)
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["meta"]["shortages"][0]["required_qty"], 1200)

	def test_station_warehouse_not_finished_goods_warehouse_is_checked(self):
		warehouse = frappe.copy_doc(frappe.get_doc("Warehouse", self.profile.warehouse))
		warehouse.warehouse_name = f"Raw Kitchen {self.token}"
		warehouse.insert(ignore_permissions=True)
		station = frappe.get_doc("Kitchen Station", self.station)
		station.raw_material_warehouse = warehouse.name
		station.save()
		response = self._preview([{"item_code": self.item, "qty": 1}])
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["meta"]["shortages"][0]["warehouse"], warehouse.name)

	def test_global_auto_reserve_does_not_reserve_qsr_finished_stock(self):
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

		frappe.db.set_single_value("Stock Settings", "auto_reserve_stock", 1)
		make_stock_entry(item_code=self.item, to_warehouse=self.profile.warehouse, qty=10, rate=10)
		response = self._send()
		self.assertTrue(response["ok"], response)
		order = response["data"]["name"]
		self.assertEqual(frappe.db.get_value("Sales Order Item", {"parent": order}, "stock_reserved_qty"), 0)
		self.assertTrue(frappe.db.exists("Work Order", {"sales_order": order, "docstatus": 1}))

	def test_manufacture_reserves_finished_goods_for_originating_order(self):
		from erpnext.manufacturing.doctype.work_order.work_order import make_stock_entry

		result = self._send()
		self.assertTrue(result["ok"], result)
		order = result["data"]["name"]
		wo = frappe.db.get_value("Work Order", {"sales_order": order}, "name")
		entry = frappe.get_doc(make_stock_entry(wo, "Manufacture", 2))
		entry.insert(ignore_permissions=True)
		entry.submit()
		self.assertEqual(
			frappe.db.get_value(
				"Sales Order Item", {"parent": order, "item_code": self.item}, "stock_reserved_qty"
			),
			2,
		)
		self.assertTrue(
			frappe.db.exists(
				"Stock Reservation Entry",
				{"voucher_type": "Sales Order", "voucher_no": order, "item_code": self.item, "docstatus": 1},
			)
		)

	def test_payload_and_cancellation_are_immutable(self):
		response = self._send()
		self.assertTrue(response["ok"], response)
		ticket = frappe.get_doc("Kitchen Order Ticket", self._tickets()[0])
		ticket.items[0].qty = 99
		ticket.flags.ignore_validate_update_after_submit = True
		with self.assertRaises(frappe.ValidationError):
			ticket.save()
		ticket.reload()
		with self.assertRaises(frappe.ValidationError):
			ticket.cancel()
		order = frappe.get_doc("Sales Order", response["data"]["name"])
		with self.assertRaises(frappe.ValidationError) as error:
			order.cancel()
		self.assertEqual(error.exception.vuna_error_code, "KITCHEN_CANCELLATION_REQUIRED")

	def test_kitchen_failure_rolls_back_round_and_all_tickets(self):
		def fail_kitchen_event(event, *args, **kwargs):
			if event == "vunapos_kitchen_ticket_created":
				raise RuntimeError("Notification failure")

		with patch("frappe.publish_realtime", side_effect=fail_kitchen_event):
			response = self._send()
		self.assertFalse(response["ok"], response)
		self.assertEqual(self._tickets(), [])
		self.assertFalse(frappe.db.exists("Sales Order", {"vunapos_restaurant_session": self.session}))

	def test_ticket_read_requires_restaurant_assignment(self):
		response = self._send()
		self.assertTrue(response["ok"], response)
		user = f"kitchen-outsider-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Waiter",))
		frappe.set_user(user)
		result = restaurant.get_kitchen_ticket(self._tickets()[0])
		self.assertFalse(result["ok"], result)
		self.assertEqual(result["errors"][0]["code"], "POS_PROFILE_NOT_ASSIGNED")

	def test_realtime_event_is_scoped_and_after_commit(self):
		with patch("frappe.publish_realtime") as publish:
			self.assertTrue(self._send()["ok"])
		calls = [
			call
			for call in publish.call_args_list
			if call.args and call.args[0] == "vunapos_kitchen_ticket_created"
		]
		self.assertEqual(len(calls), 1)
		self.assertEqual(calls[0].kwargs["doctype"], "Kitchen Station")
		self.assertEqual(calls[0].kwargs["docname"], self.station)
		self.assertTrue(calls[0].kwargs["after_commit"])

	def test_ticket_preserves_selling_and_stock_quantities(self):
		item = frappe.get_doc("Item", self.item)
		unit = frappe.db.get_value("UOM", {"name": ["!=", item.stock_uom]}, "name")
		item.append("uoms", {"uom": unit, "conversion_factor": 24})
		item.save()
		result = self._send(items=[{"item_code": self.item, "qty": 2, "uom": unit}])
		self.assertTrue(result["ok"], result)
		row = get_ticket(self._tickets()[0])["items"][0]
		self.assertEqual(row["qty"], 2)
		self.assertEqual(row["stock_qty"], 48)
		self.assertEqual(row["uom"], unit)

	def test_stale_routing_for_removed_item_is_ignored(self):
		result = self._send(routing={"Removed Item": "Removed station"})
		self.assertTrue(result["ok"], result)

	def test_station_name_can_repeat_in_other_restaurant(self):
		other = ensure_test_restaurant(f"Other Kitchen {self.token}")
		label = frappe.get_cached_value("Kitchen Station", self.station, "station_name")
		second = frappe.get_doc(
			{"doctype": "Kitchen Station", "station_name": label, "restaurant": other}
		).insert()
		self.assertNotEqual(second.name, self.station)
		with self.assertRaises(frappe.ValidationError):
			frappe.get_doc(
				{
					"doctype": "Kitchen Station",
					"station_name": label,
					"restaurant": self.profile.vunapos_restaurant,
				}
			).insert()

	def test_manager_can_configure_station_before_till_assignment(self):
		user = f"kitchen-manager-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Restaurant Manager",))
		frappe.set_user(user)
		station = frappe.get_doc(
			{
				"doctype": "Kitchen Station",
				"station_name": f"Setup {self.token}",
				"restaurant": self.profile.vunapos_restaurant,
			}
		).insert()
		self.assertEqual(station.company, self.profile.company)

	def test_ticket_snapshot_survives_item_and_station_label_changes(self):
		self.assertTrue(self._send()["ok"])
		before = get_ticket(self._tickets()[0])
		station = frappe.get_doc("Kitchen Station", self.station)
		station.station_name = f"Renamed {self.token}"
		station.save()
		item = frappe.get_doc("Item", self.item)
		item.item_name = f"Renamed dish {self.token}"
		item.save()
		after = get_ticket(self._tickets()[0])
		self.assertEqual(before["station_label"], after["station_label"])
		self.assertEqual(before["items"][0]["item_name"], after["items"][0]["item_name"])

	def test_database_prevents_duplicate_station_event(self):
		self.assertTrue(self._send()["ok"])
		ticket = frappe.copy_doc(frappe.get_doc("Kitchen Order Ticket", self._tickets()[0]))
		previous = frappe.flags.get("vunapos_generating_kot")
		try:
			frappe.flags.vunapos_generating_kot = True
			with self.assertRaises((frappe.DuplicateEntryError, frappe.UniqueValidationError)):
				ticket.insert(ignore_permissions=True)
		finally:
			frappe.flags.vunapos_generating_kot = previous

	def test_station_user_permission_limits_ticket_read_and_listing(self):
		other_group = (
			frappe.get_doc(
				{
					"doctype": "Item Group",
					"item_group_name": f"Restricted {self.token}",
					"parent_item_group": self.root,
				}
			)
			.insert()
			.name
		)
		other_item = self._item("Other", other_group)
		other_station = self._station("Other", [other_group])
		result = self._send(items=[{"item_code": self.item, "qty": 1}, {"item_code": other_item, "qty": 1}])
		self.assertTrue(result["ok"], result)
		forbidden = next(
			name
			for name in self._tickets()
			if frappe.get_cached_value("Kitchen Order Ticket", name, "kitchen_station") == other_station
		)
		user = f"kitchen-restricted-{self.token}@example.com"
		ensure_test_user(user, roles=("VunaPOS Waiter",), pos_profile=self.profile.name)
		frappe.get_doc(
			{
				"doctype": "User Permission",
				"user": user,
				"allow": "Kitchen Station",
				"for_value": self.station,
				"apply_to_all_doctypes": 1,
			}
		).insert(ignore_permissions=True)
		frappe.set_user(user)
		self.assertFalse(restaurant.get_kitchen_ticket(forbidden)["ok"])
		visible = restaurant.get_session(self.session)
		self.assertTrue(visible["ok"], visible)
		self.assertEqual(
			{row["kitchen_station"] for row in visible["data"]["kitchen_tickets"]}, {self.station}
		)

	def test_ticket_context_rejects_mismatched_company(self):
		result = self._send()
		self.assertTrue(result["ok"], result)
		order = frappe.get_doc("Sales Order", result["data"]["name"])
		order.company = "Wrong Company"
		with self.assertRaises(frappe.ValidationError) as error:
			generate_tickets(order)
		self.assertEqual(error.exception.vuna_error_code, "KITCHEN_CONTEXT_MISMATCH")
