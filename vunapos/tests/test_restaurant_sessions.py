from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant
from vunapos.services.floor_plan_service import get_floor_plan_version, save_floor_plan
from vunapos.services.restaurant_order_service import _require_editable_round
from vunapos.tests.helpers import (
	ensure_open_pos_opening_entry,
	ensure_test_item,
	ensure_test_restaurant_profile,
)


class TestRestaurantSessions(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.profile = ensure_test_restaurant_profile()
		ensure_open_pos_opening_entry(self.profile)
		self.item = ensure_test_item()
		# Use a fresh floor/table so existing fixture sessions cannot affect occupancy.
		from vunapos.services.floor_plan_service import get_floor_plan

		plan = get_floor_plan(self.profile)
		payload = plan["floors"] + [
			{
				"client_id": "session-floor",
				"floor_name": f"Session {uuid4().hex[:8]}",
				"elements": [],
				"tables": [
					{
						"client_id": "session-table",
						"table_label": uuid4().hex[:8],
						"seats": 4,
						"shape": "Square",
						"x": 10,
						"y": 10,
						"width": 80,
						"height": 80,
					}
				],
			}
		]
		result = save_floor_plan(
			self.profile, {"version": get_floor_plan_version(self.profile), "floors": payload}
		)
		self.table = result["id_map"]["tables"]["session-table"]

	def _open(self, key=None):
		response = restaurant.open_session(
			self.profile, key or str(uuid4()), tables=[self.table], guest_count=2
		)
		self.assertTrue(response["ok"], response)
		return response["data"]

	def test_retry_returns_same_session(self):
		key = str(uuid4())
		first = self._open(key)
		self.assertEqual(self._open(key)["name"], first["name"])

	def test_second_session_cannot_claim_occupied_table(self):
		self._open()
		response = restaurant.open_session(self.profile, str(uuid4()), tables=[self.table])
		self.assertFalse(response["ok"])
		self.assertEqual(response["errors"][0]["code"], "TABLE_OCCUPIED")

	def test_rounds_are_distinct_sales_orders_and_retry_is_safe(self):
		session = self._open()
		key = str(uuid4())
		items = [{"item_code": self.item, "qty": 1}]
		first = restaurant.create_session_round(session["name"], items, key)
		self.assertTrue(first["ok"], first)
		retry = restaurant.create_session_round(session["name"], items, key)
		self.assertEqual(retry["data"]["name"], first["data"]["name"])
		second = restaurant.create_session_round(session["name"], items, str(uuid4()))
		self.assertTrue(second["ok"], second)
		self.assertNotEqual(first["data"]["name"], second["data"]["name"])
		self.assertEqual(len(restaurant.get_session(session["name"])["data"]["rounds"]), 2)
		response = restaurant.add_order_items(first["data"]["name"], items)
		self.assertFalse(response["ok"])
		self.assertEqual(response["errors"][0]["code"], "ROUND_ALREADY_COMMITTED")
		doc = frappe.get_doc("Sales Order", first["data"]["name"])
		doc.items[0].qty = 3
		doc.flags.ignore_validate_update_after_submit = True
		with self.assertRaises(frappe.ValidationError) as error:
			doc.save()
		self.assertEqual(error.exception.vuna_error_code, "ROUND_ALREADY_COMMITTED")

	def test_legacy_order_cannot_take_session_table(self):
		self._open()
		response = restaurant.create_order(self.profile, table=self.table, items=[{"item_code": self.item}])
		self.assertFalse(response["ok"])
		self.assertEqual(response["errors"][0]["code"], "TABLE_OCCUPIED")

	def test_legacy_orders_remain_editable(self):
		_require_editable_round(frappe._dict(docstatus=1))

	def test_empty_session_can_release_table(self):
		session = self._open()
		response = restaurant.cancel_empty_session(session["name"])
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["status"], "Cancelled")
		self.assertTrue(response["data"]["tables"][0]["released_at"])
		self._open()

	def test_floor_and_order_list_expose_session_before_round(self):
		session = self._open()
		rows = restaurant.get_table_status(self.profile)["data"]
		row = next(row for row in rows if row["table"] == self.table)
		self.assertEqual(row["status"], "Occupied")
		self.assertEqual(row["session"]["name"], session["name"])
		self.assertIn(
			session["name"], [row["name"] for row in restaurant.list_sessions(self.profile)["data"]]
		)

	def test_guest_count_updates_and_duplicate_table_rejected(self):
		session = self._open()
		updated = restaurant.update_session(session["name"], guest_count=5)
		self.assertTrue(updated["ok"], updated)
		self.assertEqual(updated["data"]["guest_count"], 5)
		response = restaurant.update_session(session["name"], tables=[self.table, self.table])
		self.assertFalse(response["ok"])

	def test_join_and_move_tables_preserve_history(self):
		session = self._open()
		table = frappe.copy_doc(frappe.get_doc("Restaurant Table", self.table))
		table.table_label = uuid4().hex[:8]
		table.insert(ignore_permissions=True)
		joined = restaurant.update_session(session["name"], tables=[self.table, table.name])
		self.assertTrue(joined["ok"], joined)
		self.assertEqual(len([row for row in joined["data"]["tables"] if not row["released_at"]]), 2)
		moved = restaurant.update_session(session["name"], tables=[table.name])
		self.assertTrue(moved["ok"], moved)
		self.assertTrue(
			next(row for row in moved["data"]["tables"] if row["table"] == self.table)["released_at"]
		)
		self._open()  # Previous table is genuinely available again.

	def test_nonempty_session_cannot_be_cancelled_as_empty(self):
		session = self._open()
		created = restaurant.create_session_round(
			session["name"], [{"item_code": self.item, "qty": 1}], str(uuid4())
		)
		self.assertTrue(created["ok"], created)
		response = restaurant.cancel_empty_session(session["name"])
		self.assertFalse(response["ok"])
		self.assertEqual(response["errors"][0]["code"], "SESSION_HAS_ROUNDS")

	def test_customer_is_locked_after_submission(self):
		session = self._open()
		created = restaurant.create_session_round(
			session["name"], [{"item_code": self.item, "qty": 1}], str(uuid4())
		)
		self.assertTrue(created["ok"], created)
		response = restaurant.update_session(session["name"], customer="Different customer")
		self.assertFalse(response["ok"])
		self.assertEqual(response["errors"][0]["code"], "SESSION_CUSTOMER_LOCKED")

	def test_staff_can_add_round_from_another_till_in_same_restaurant(self):
		from vunapos.setup.utils import WAITER_ROLE
		from vunapos.tests.helpers import ensure_test_user

		session = self._open()
		profile = frappe.copy_doc(frappe.get_doc("POS Profile", self.profile))
		profile.set("__newname", f"_Test Session Till {uuid4().hex[:8]}")
		profile.set("applicable_for_users", [])
		profile.insert(ignore_permissions=True)
		user = "_test_session_second_till@example.com"
		ensure_test_user(user, roles=(WAITER_ROLE,), pos_profile=profile.name)
		try:
			frappe.set_user(user)
			from vunapos.services.pos_entry import create_pos_opening_entry

			create_pos_opening_entry(
				profile.name,
				[{"mode_of_payment": row.mode_of_payment, "opening_amount": 0} for row in profile.payments],
				user,
			)
			response = restaurant.create_session_round(
				session["name"], [{"item_code": self.item, "qty": 1}], str(uuid4()), pos_profile=profile.name
			)
			self.assertTrue(response["ok"], response)
			self.assertEqual(response["data"]["pos_profile"], profile.name)
		finally:
			frappe.set_user("Administrator")

	def test_price_list_snapshot_is_used_for_later_rounds(self):
		session = self._open()
		stored = frappe.get_doc("Restaurant Session", session["name"])
		self.assertTrue(stored.selling_price_list)
		response = restaurant.create_session_round(
			session["name"], [{"item_code": self.item, "qty": 1}], str(uuid4())
		)
		self.assertTrue(response["ok"], response)
		self.assertEqual(
			frappe.db.get_value("Sales Order", response["data"]["name"], "selling_price_list"),
			stored.selling_price_list,
		)
