from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, nowdate

from vunapos.api import kiosk, restaurant
from vunapos.services.floor_plan_service import get_floor_plan, get_floor_plan_version, save_floor_plan
from vunapos.services.kiosk_service import next_order_number
from vunapos.setup.utils import (
	CASHIER_ROLE,
	KIOSK_BILL_AT_END,
	KIOSK_PAY_FIRST,
	KIOSK_ROLE,
	RESTAURANT_MANAGER_ROLE,
	WAITER_ROLE,
)
from vunapos.tests import test_kitchen_service as fixtures
from vunapos.tests.helpers import (
	TEST_COUNTER_SERVICE,
	TEST_DELIVERY_SERVICE,
	TEST_TABLE_SERVICE,
	ensure_test_user,
)

KIOSK_USER = "_test_kiosk_device@example.com"
MANAGER_PIN = "4321"


class TestRestaurantKiosk(IntegrationTestCase):
	tearDown = fixtures.TestKitchenService.tearDown
	_item = fixtures.TestKitchenService._item
	_raw_item = fixtures.TestKitchenService._raw_item
	_station = fixtures.TestKitchenService._station

	def setUp(self):
		# A kitchen station preparing a recipe item, with ingredient stock and reservations on.
		fixtures.TestKitchenService.setUp(self)
		self.till = self.profile.name
		self.kiosk_floor, self.tables, self.other_floor_table = self._floors()
		self.kiosk_profile = self._kiosk_profile()
		ensure_test_user(KIOSK_USER, roles=(KIOSK_ROLE,), pos_profile=self.kiosk_profile)

	def _floors(self):
		plan = get_floor_plan(self.till)

		def floor(key, labels):
			return {
				"client_id": key,
				"floor_name": f"Kiosk {key} {self.token}",
				"elements": [],
				"tables": [
					{
						"client_id": f"{key}-{label}",
						"table_label": f"{label}{self.token}",
						"seats": 4,
						"shape": "Square",
						"x": 10 + 100 * index,
						"y": 10,
						"width": 80,
						"height": 80,
					}
					for index, label in enumerate(labels)
				],
			}

		saved = save_floor_plan(
			self.till,
			{
				"version": get_floor_plan_version(self.till),
				"floors": [*plan["floors"], floor("upstairs", ("A", "B")), floor("garden", ("G",))],
			},
		)
		ids = saved["id_map"]
		return (
			ids["floors"]["upstairs"],
			[ids["tables"]["upstairs-A"], ids["tables"]["upstairs-B"]],
			ids["tables"]["garden-G"],
		)

	def _manager(self):
		name = "_Test Kiosk Manager"
		if not frappe.db.exists("Sales Person", name):
			frappe.get_doc({"doctype": "Sales Person", "sales_person_name": name}).insert(
				ignore_permissions=True
			)
		return name

	def _kiosk_profile(self, **values):
		profile = frappe.copy_doc(frappe.get_doc("POS Profile", self.till))
		profile.set("__newname", f"_Test Kiosk {uuid4().hex[:8]}")
		profile.set("applicable_for_users", [])
		profile.update(
			{
				"vunapos_kiosk_mode": 1,
				"vunapos_kiosk_payment_timing": KIOSK_PAY_FIRST,
				"vunapos_kiosk_idle_seconds": 90,
				"vunapos_kiosk_service_types": [
					{"service_type": TEST_TABLE_SERVICE},
					{"service_type": TEST_COUNTER_SERVICE},
				],
				"vunapos_kiosk_floors": [{"floor": self.kiosk_floor}],
				# Frappe encrypts a child row's password before naming the row on insert.
				"vunapos_pin_users": [
					{
						"name": frappe.generate_hash(length=10),
						"sales_person": self._manager(),
						"role": "Manager",
						"pin": MANAGER_PIN,
						"enabled": 1,
					}
				],
				**values,
			}
		)
		return profile.insert(ignore_permissions=True).name

	def _as(self, user):
		frappe.set_user(user)
		return self

	def _place(self, table=None, service_type=None, key=None, items=None, ok=True):
		frappe.set_user(KIOSK_USER)
		try:
			response = kiosk.place_kiosk_order(
				self.kiosk_profile,
				service_type or (TEST_TABLE_SERVICE if table else TEST_COUNTER_SERVICE),
				items or [{"item_code": self.item, "qty": 2, "line_id": str(uuid4())}],
				key or str(uuid4()),
				table=table,
				order_note="No onions",
			)
		finally:
			frappe.set_user("Administrator")
		if ok:
			self.assertTrue(response["ok"], response)
			return response["data"]
		self.assertFalse(response["ok"], response)
		return response["errors"][0]["code"]

	def _tickets(self, session):
		return frappe.get_all("Kitchen Order Ticket", filters={"restaurant_session": session}, pluck="name")

	def _user(self, email, roles, profile=None):
		return ensure_test_user(email, roles=roles, pos_profile=profile or self.till)

	# ---- setup and access ----

	def test_kiosk_role_has_no_desk_and_lands_on_the_kiosk(self):
		self.assertEqual(
			frappe.db.get_value("Role", KIOSK_ROLE, ["desk_access", "home_page"]), (0, "vunapos")
		)
		self.assertEqual(frappe.db.get_value("User", KIOSK_USER, "user_type"), "Website User")
		frappe.set_user(KIOSK_USER)
		from vunapos.services.profile_service import get_bootstrap_data

		data = get_bootstrap_data(self.kiosk_profile)
		self.assertTrue(data["is_kiosk_user"])
		self.assertIn(KIOSK_ROLE, data["restaurant_roles"])
		self.assertEqual(
			(
				data["restaurant"]["kiosk_mode"],
				data["restaurant"]["kiosk_payment_timing"],
				data["restaurant"]["kiosk_idle_seconds"],
			),
			(True, KIOSK_PAY_FIRST, 90),
		)

	def test_profile_validation(self):
		cases = (
			({"vunapos_pin_users": []}, "Manager PIN"),
			({"customer": None}, "Customer"),
			({"vunapos_kiosk_service_types": []}, "service types"),
			({"vunapos_kiosk_idle_seconds": 5}, "Idle Reset"),
		)
		for values, message in cases:
			with self.assertRaises(frappe.ValidationError, msg=message) as error:
				self._kiosk_profile(**values)
			self.assertIn(message.lower(), str(error.exception).lower())
		other = frappe.get_doc(
			{
				"doctype": "Restaurant Service Type",
				"service_type_name": f"_Test Not Offered {self.token}",
				"requires_table": 0,
			}
		).insert(ignore_permissions=True)
		with self.assertRaises(frappe.ValidationError):
			self._kiosk_profile(vunapos_kiosk_service_types=[{"service_type": other.name}])
		retail = frappe.get_doc("POS Profile", self.kiosk_profile)
		retail.vunapos_pos_mode = "Retail"
		with self.assertRaises(frappe.ValidationError):
			retail.save(ignore_permissions=True)

	def test_setup_offers_kiosk_service_types_floors_and_free_tables(self):
		self._place(table=self.tables[0])
		frappe.set_user(KIOSK_USER)
		setup = kiosk.get_kiosk_setup(self.kiosk_profile)
		self.assertTrue(setup["ok"], setup)
		data = setup["data"]
		self.assertEqual(
			[row["name"] for row in data["service_types"]], [TEST_TABLE_SERVICE, TEST_COUNTER_SERVICE]
		)
		self.assertEqual([floor["name"] for floor in data["floor_plan"]["floors"]], [self.kiosk_floor])
		status = {row["table"]: row for row in data["tables"]}
		self.assertEqual(set(status), set(self.tables))
		self.assertEqual(status[self.tables[0]]["status"], "Occupied")
		self.assertEqual(status[self.tables[1]]["status"], "Free")
		# Nothing about who holds a table reaches the kiosk.
		self.assertEqual((status[self.tables[0]]["session"], status[self.tables[0]]["orders"]), (None, []))

	# ---- placing orders ----

	def test_pay_first_order_is_held_with_a_number_and_a_slip(self):
		placed = self._place(table=self.tables[0])
		session = frappe.get_doc("Restaurant Session", placed["session"])
		self.assertEqual(session.kiosk_status, "Awaiting Payment")
		self.assertEqual(session.order_number, placed["order_number"])
		self.assertEqual(str(session.order_date), nowdate())
		self.assertEqual(
			(session.customer, session.waiter),
			(frappe.db.get_value("POS Profile", self.kiosk_profile, "customer"), KIOSK_USER),
		)
		self.assertEqual(
			placed["table_label"], frappe.db.get_value("Restaurant Table", self.tables[0], "table_label")
		)
		self.assertEqual(frappe.db.get_value("Sales Order", placed["sales_order"], "docstatus"), 1)
		# Held: no kitchen tickets, production or reservations until payment is confirmed.
		self.assertEqual(self._tickets(placed["session"]), [])
		self.assertFalse(frappe.db.exists("Work Order", {"sales_order": placed["sales_order"]}))
		self.assertFalse(
			frappe.db.exists("Stock Reservation Entry", {"voucher_no": placed["sales_order"], "docstatus": 1})
		)
		frappe.set_user(KIOSK_USER)
		from vunapos.api.print import render_invoice

		slip = render_invoice("Sales Order", placed["sales_order"], placed["print_format"])
		self.assertTrue(slip["ok"], slip)
		html = slip["data"]["html"]
		self.assertIn("Please pay at the counter", html)
		self.assertIn(f">{placed['order_number']}<", html)
		self.assertIn("No onions", html)

	def test_order_numbers_count_per_branch_and_day_and_retries_keep_theirs(self):
		key = str(uuid4())
		first = self._place(key=key)
		retry = self._place(key=key)
		self.assertEqual((retry["session"], retry["order_number"]), (first["session"], first["order_number"]))
		second = self._place()
		self.assertEqual(second["order_number"], first["order_number"] + 1)
		self.assertEqual(next_order_number(f"_Test Other Branch {self.token}", nowdate()), 1)
		self.assertEqual(next_order_number(self.profile.vunapos_branch, add_days(nowdate(), 1)), 1)
		# Session and Sales Order keep their normal names.
		self.assertTrue(first["session"].startswith("RS-"))

	def test_kiosk_service_type_floor_and_table_rules(self):
		self.assertEqual(
			self._place(service_type=TEST_DELIVERY_SERVICE, ok=False), "SERVICE_TYPE_NOT_ALLOWED"
		)
		self.assertEqual(self._place(service_type=TEST_TABLE_SERVICE, ok=False), "TABLE_REQUIRED")
		self.assertEqual(self._place(table=self.other_floor_table, ok=False), "TABLE_NOT_ON_KIOSK_FLOOR")
		self._place(table=self.tables[0])
		self.assertEqual(self._place(table=self.tables[0], ok=False), "TABLE_OCCUPIED")
		# The cart check applies the floor rule too.
		frappe.set_user(KIOSK_USER)
		response = restaurant.validate_cart(
			self.kiosk_profile,
			TEST_TABLE_SERVICE,
			[{"item_code": self.item, "qty": 1}],
			self.other_floor_table,
		)
		self.assertEqual(response["errors"][0]["code"], "TABLE_NOT_ON_KIOSK_FLOOR")

	def test_stock_is_checked_when_the_order_is_placed(self):
		code = self._place(items=[{"item_code": self.item, "qty": 5000}], ok=False)
		self.assertEqual(code, "RESTAURANT_STOCK_SHORTAGE")
		self.assertFalse(frappe.db.exists("Restaurant Session", {"pos_profile": self.kiosk_profile}))

	def test_kiosk_login_only_places_orders(self):
		placed = self._place(table=self.tables[0])
		frappe.set_user(KIOSK_USER)
		for response in (
			restaurant.cancel_order(placed["sales_order"], "Changed my mind"),
			restaurant.update_session(placed["session"], guest_count=3),
			restaurant.cancel_empty_session(placed["session"]),
			restaurant.create_session_round(placed["session"], [{"item_code": self.item}], str(uuid4())),
			restaurant.list_sessions(self.kiosk_profile),
			restaurant.get_table_status(self.kiosk_profile),
			restaurant.get_session(placed["session"]),
			restaurant.preview_session_bill(placed["session"], self.kiosk_profile),
		):
			self.assertEqual(response["errors"][0]["code"], "KIOSK_NOT_ALLOWED", response)
		confirm = kiosk.confirm_kiosk_payment(placed["session"], self.kiosk_profile)
		self.assertEqual(confirm["errors"][0]["code"], "KIOSK_CONFIRM_NOT_ALLOWED")
		cancel = kiosk.cancel_kiosk_order(placed["session"], "No", self.kiosk_profile)
		self.assertEqual(cancel["errors"][0]["code"], "KIOSK_CANCEL_NOT_ALLOWED")
		from vunapos.api.customer import create_customer

		self.assertFalse(create_customer("Kiosk Guest")["ok"])
		self.assertFalse(frappe.has_permission("Sales Invoice", "create"))
		# The menu and the cart check stay available.
		self.assertTrue(restaurant.get_menu(self.kiosk_profile, TEST_COUNTER_SERVICE)["ok"])
		frappe.set_user("Administrator")
		self.assertEqual(frappe.db.get_value("Sales Order", placed["sales_order"], "docstatus"), 1)

	# ---- cashier confirmation, billing and cancelling ----

	def test_cashier_confirms_payment_then_bills_through_session_checkout(self):
		placed = self._place(table=self.tables[0])
		session = placed["session"]
		# Staff can see it on Open Orders, and cannot bill or add to it before payment is confirmed.
		row = next(row for row in restaurant.list_sessions(self.till)["data"] if row["name"] == session)
		self.assertEqual(
			(row["kiosk_status"], row["order_number"]), ("Awaiting Payment", placed["order_number"])
		)
		preview = restaurant.preview_session_bill(session, self.till)
		self.assertTrue(preview["ok"], preview)
		blocked = restaurant.checkout_session(session, self.till, preview["data"]["fingerprint"], [])
		self.assertEqual(blocked["errors"][0]["code"], "KIOSK_ORDER_AWAITING_PAYMENT")
		extra = restaurant.create_session_round(session, [{"item_code": self.item}], str(uuid4()))
		self.assertEqual(extra["errors"][0]["code"], "KIOSK_ORDER_AWAITING_PAYMENT")

		confirmed = kiosk.confirm_kiosk_payment(session, self.till)
		self.assertTrue(confirmed["ok"], confirmed)
		self.assertEqual(confirmed["data"]["kiosk_status"], "Sent to Kitchen")
		self.assertEqual(confirmed["data"]["confirmed_by"], "Administrator")
		tickets = self._tickets(session)
		self.assertEqual(len(tickets), 1)
		self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", tickets[0], "sent_by"), "Administrator")
		self.assertTrue(
			frappe.db.exists("Work Order", {"sales_order": placed["sales_order"], "docstatus": 1})
		)
		again = kiosk.confirm_kiosk_payment(session, self.till)
		self.assertTrue(again["ok"], again)
		self.assertEqual(self._tickets(session), tickets)

		for action, expected in (("Accept", "Sent"), ("Start", "Accepted"), ("Ready", "Preparing")):
			result = restaurant.kitchen_action(tickets[0], action, str(uuid4()), expected)
			self.assertTrue(result["ok"], result)
		preview = restaurant.preview_session_bill(session, self.till)["data"]
		total = preview["invoice"]["totals"]["rounded_total"] or preview["invoice"]["totals"]["grand_total"]
		mode = self.profile.payments[0].mode_of_payment
		billed = restaurant.checkout_session(
			session, self.till, preview["fingerprint"], [{"mode_of_payment": mode, "amount": total}]
		)
		self.assertTrue(billed["ok"], billed)
		self.assertEqual(billed["data"]["session"]["status"], "Settled")

	def test_only_cashiers_confirm_and_managers_or_cashiers_cancel(self):
		placed = self._place(table=self.tables[0])
		waiter = self._user("_test_kiosk_waiter@example.com", (WAITER_ROLE,))
		manager = self._user("_test_kiosk_manager@example.com", (RESTAURANT_MANAGER_ROLE,))
		for user in (waiter, manager):
			frappe.set_user(user)
			response = kiosk.confirm_kiosk_payment(placed["session"], self.till)
			self.assertEqual(response["errors"][0]["code"], "KIOSK_CONFIRM_NOT_ALLOWED", user)
		frappe.set_user(waiter)
		response = kiosk.cancel_kiosk_order(placed["session"], "Never paid", self.till)
		self.assertEqual(response["errors"][0]["code"], "KIOSK_CANCEL_NOT_ALLOWED")
		frappe.set_user(manager)
		response = kiosk.cancel_kiosk_order(placed["session"], "Never paid", self.till)
		self.assertTrue(response["ok"], response)
		frappe.set_user("Administrator")

	def test_cancelling_an_unpaid_order_frees_its_table_and_follows_the_pin_rule(self):
		placed = self._place(table=self.tables[0])
		cashier = self._user("_test_kiosk_cashier@example.com", (CASHIER_ROLE,))
		frappe.db.set_value("POS Profile", self.till, "vunapos_require_manager_pin_order_cancel", 1)
		frappe.clear_document_cache("POS Profile", self.till)
		try:
			frappe.set_user(cashier)
			self.assertEqual(
				kiosk.cancel_kiosk_order(placed["session"], "", self.till)["errors"][0]["code"],
				"CANCEL_REASON_REQUIRED",
			)
			response = kiosk.cancel_kiosk_order(placed["session"], "Never paid", self.till)
			self.assertFalse(response["ok"], response)
			self.assertEqual(response["errors"][0]["code"], "PIN_TOKEN_REQUIRED")
			from vunapos.services.pin_service import _issue_token

			token = _issue_token(frappe.get_doc("POS Profile", self.till), "manager_order_cancel", "Manager")
			response = kiosk.cancel_kiosk_order(placed["session"], "Never paid", self.till, token)
			self.assertTrue(response["ok"], response)
		finally:
			frappe.set_user("Administrator")
			frappe.db.set_value("POS Profile", self.till, "vunapos_require_manager_pin_order_cancel", 0)
			frappe.clear_document_cache("POS Profile", self.till)
		self.assertEqual(response["data"]["status"], "Cancelled")
		order = frappe.get_doc("Sales Order", placed["sales_order"])
		self.assertEqual(
			(order.docstatus, order.vunapos_cancel_reason, order.vunapos_cancel_approved_by),
			(2, "Never paid", "Manager"),
		)
		self.assertEqual(self._place(table=self.tables[0])["table"], self.tables[0])

	def test_an_order_sent_to_the_kitchen_is_not_cancelled_here(self):
		placed = self._place()
		self.assertTrue(kiosk.confirm_kiosk_payment(placed["session"], self.till)["ok"])
		response = kiosk.cancel_kiosk_order(placed["session"], "Too late", self.till)
		self.assertEqual(response["errors"][0]["code"], "KIOSK_ORDER_NOT_CANCELLABLE")

	def test_bill_at_the_end_sends_orders_to_the_kitchen_at_once(self):
		frappe.db.set_value(
			"POS Profile", self.kiosk_profile, "vunapos_kiosk_payment_timing", KIOSK_BILL_AT_END
		)
		frappe.clear_document_cache("POS Profile", self.kiosk_profile)
		placed = self._place(table=self.tables[0])
		self.assertEqual(placed["kiosk_status"], "Sent to Kitchen")
		tickets = self._tickets(placed["session"])
		self.assertEqual(len(tickets), 1)
		self.assertEqual(frappe.db.get_value("Kitchen Order Ticket", tickets[0], "sent_by"), KIOSK_USER)
		self.assertTrue(
			frappe.db.exists("Work Order", {"sales_order": placed["sales_order"], "docstatus": 1})
		)
		frappe.set_user(KIOSK_USER)
		from vunapos.api.print import render_invoice

		html = render_invoice("Sales Order", placed["sales_order"], placed["print_format"])["data"]["html"]
		self.assertIn("Your order is with the kitchen", html)
		frappe.set_user("Administrator")
		for action, expected in (("Accept", "Sent"), ("Start", "Accepted"), ("Ready", "Preparing")):
			self.assertTrue(restaurant.kitchen_action(tickets[0], action, str(uuid4()), expected)["ok"])
		preview = restaurant.preview_session_bill(placed["session"], self.till)["data"]
		total = preview["invoice"]["totals"]["rounded_total"] or preview["invoice"]["totals"]["grand_total"]
		mode = self.profile.payments[0].mode_of_payment
		billed = restaurant.checkout_session(
			placed["session"], self.till, preview["fingerprint"], [{"mode_of_payment": mode, "amount": total}]
		)
		self.assertTrue(billed["ok"], billed)

	# ---- leaving the kiosk and printing ----

	def test_leaving_the_kiosk_needs_a_manager_pin(self):
		from vunapos.api.pin import verify_manager

		frappe.set_user(KIOSK_USER)
		self.assertEqual(
			verify_manager(self.kiosk_profile, "0000", "kiosk_exit")["errors"][0]["code"],
			"INVALID_MANAGER_PIN",
		)
		response = verify_manager(self.kiosk_profile, MANAGER_PIN, "kiosk_exit")
		self.assertTrue(response["ok"], response)
		frappe.set_user("Administrator")
		frappe.cache().delete_keys(f"vunapos:pin-attempts:{KIOSK_USER}")
		response = verify_manager(self.till, MANAGER_PIN, "kiosk_exit")
		self.assertEqual(response["errors"][0]["code"], "MANAGER_PIN_NOT_REQUIRED")

	def test_the_slip_is_never_the_default_sales_order_format(self):
		from vunapos.services.print_service import KIOSK_ORDER_SLIP, resolve_print_format

		self.assertTrue(frappe.db.exists("Print Format", KIOSK_ORDER_SLIP))
		self.assertNotEqual(resolve_print_format("Sales Order"), KIOSK_ORDER_SLIP)
