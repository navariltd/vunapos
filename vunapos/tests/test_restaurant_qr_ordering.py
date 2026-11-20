from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import kiosk, restaurant, table_order
from vunapos.services import qr_order_service
from vunapos.setup.utils import KIOSK_ROLE, RESTAURANT_MANAGER_ROLE, WAITER_ROLE
from vunapos.tests import test_kitchen_service as fixtures
from vunapos.tests import test_restaurant_kiosk as kiosk_tests
from vunapos.tests.helpers import TEST_COUNTER_SERVICE, TEST_TABLE_SERVICE, ensure_test_user

# Imported by module, so the kiosk tests are not collected again here.
KIOSK_USER = kiosk_tests.KIOSK_USER

WAITER = "_test_qr_waiter@example.com"


class TestRestaurantQrOrdering(IntegrationTestCase):
	"""QR on the staff till (no Kiosk Mode), beside a separate kiosk profile with its own floor."""

	_item = fixtures.TestKitchenService._item
	_raw_item = fixtures.TestKitchenService._raw_item
	_station = fixtures.TestKitchenService._station
	_floors = kiosk_tests.TestRestaurantKiosk._floors
	_manager = kiosk_tests.TestRestaurantKiosk._manager
	_kiosk_profile = kiosk_tests.TestRestaurantKiosk._kiosk_profile
	_set_till = kiosk_tests.TestRestaurantKiosk._set_till

	def setUp(self):
		kiosk_tests.TestRestaurantKiosk.setUp(self)
		self._switch_qr(self.till, on=True)
		self.codes = {table: self._code(table) for table in (*self.tables, self.other_floor_table)}

	def tearDown(self):
		# Tests here share one transaction: leave no profile claiming QR for the branch.
		frappe.set_user("Administrator")
		for name in frappe.get_all("POS Profile", filters={"vunapos_qr_ordering": 1}, pluck="name"):
			frappe.db.set_value("POS Profile", name, "vunapos_qr_ordering", 0)
			frappe.clear_document_cache("POS Profile", name)

	def _switch_qr(self, profile_name, on=True, service_type=TEST_TABLE_SERVICE):
		profile = frappe.get_doc("POS Profile", profile_name)
		profile.vunapos_qr_ordering = int(on)
		profile.vunapos_qr_service_type = service_type if on else None
		profile.save(ignore_permissions=True)
		frappe.clear_document_cache("POS Profile", profile_name)
		return profile

	def _code(self, table):
		response = table_order.print_table_qr_cards(self.till, [table])
		self.assertTrue(response["ok"], response)
		return frappe.db.get_value("Restaurant Table", table, "qr_token")

	def _guest(self, method, *args, ok=True, **kwargs):
		frappe.set_user("Guest")
		try:
			response = method(*args, **kwargs)
			self.assertEqual(frappe.session.user, "Guest")
		finally:
			frappe.set_user("Administrator")
		if ok:
			self.assertTrue(response["ok"], response)
			return response["data"]
		self.assertFalse(response["ok"], response)
		return response["errors"][0]["code"]

	def _send(self, table, key=None, ok=True, qty=1):
		items = [{"item_code": self.item, "qty": qty, "line_id": str(uuid4()), "note": "No salt"}]
		return self._guest(
			table_order.place_table_order, self.codes[table], items, key or str(uuid4()), ok=ok
		)

	def _rounds(self, session, docstatus=None):
		filters = {"vunapos_restaurant_session": session}
		if docstatus is not None:
			filters["docstatus"] = docstatus
		return frappe.get_all("Sales Order", filters=filters, pluck="name")

	# ---- profile ----

	def test_profile_validation_and_the_qr_user(self):
		profile = frappe.get_doc("POS Profile", self.till)
		user = frappe.get_doc("User", profile.vunapos_qr_user)
		# It can never sign in: disabled, without a password, a kiosk login without Desk.
		self.assertEqual(user.enabled, 0)
		self.assertEqual({row.role for row in user.roles}, {KIOSK_ROLE})
		self.assertIn(user.name, [row.user for row in profile.applicable_for_users])
		self.assertFalse(profile.vunapos_kiosk_mode)
		# Saving again keeps the same user.
		profile.save(ignore_permissions=True)
		self.assertEqual(frappe.db.get_value("POS Profile", self.till, "vunapos_qr_user"), user.name)

		# One QR profile per restaurant branch, even when the other is a kiosk.
		with self.assertRaisesRegex(frappe.ValidationError, "already has QR Table Ordering"):
			self._switch_qr(self.kiosk_profile)
		with self.assertRaisesRegex(frappe.ValidationError, "must use tables"):
			self._switch_qr(self.till, service_type=TEST_COUNTER_SERVICE)
		retail = frappe.get_doc("POS Profile", self.till)
		retail.vunapos_pos_mode = "Retail"
		with self.assertRaisesRegex(frappe.ValidationError, "Restaurant POS Profiles only"):
			retail.run_method("validate")
		# Moving QR to the kiosk profile works once the till gives it up.
		self._switch_qr(self.till, on=False)
		self.assertTrue(self._switch_qr(self.kiosk_profile).vunapos_qr_user)

	# ---- codes ----

	def test_print_creates_a_code_once_and_regenerate_replaces_it(self):
		table = self.tables[0]
		token = self.codes[table]
		self.assertGreaterEqual(len(token), 40)
		printed = table_order.print_table_qr_cards(self.till, [table, self.tables[1]])
		self.assertTrue(printed["ok"], printed)
		html = printed["data"]["html"]
		self.assertIn(f"/vunapos/table/{token}", qr_order_service.table_url(token))
		self.assertEqual(html.count('class="card"'), 2)
		self.assertIn("Scan to order", html)
		self.assertIn("<svg", html)
		self.assertIn(frappe.db.get_value("Restaurant Table", table, "table_label"), html)
		# Printing again never changes a code.
		self.assertEqual(frappe.db.get_value("Restaurant Table", table, "qr_token"), token)

		listing = table_order.get_qr_tables(self.till)
		self.assertTrue(listing["ok"], listing)
		self.assertTrue(listing["data"]["enabled"])
		rows = {row["table"]: row for floor in listing["data"]["floors"] for row in floor["tables"]}
		self.assertTrue(rows[table]["has_code"])
		self.assertNotIn(token, frappe.as_json(listing))

		regenerated = table_order.regenerate_table_qr(self.till, table)
		self.assertTrue(regenerated["ok"], regenerated)
		new_token = frappe.db.get_value("Restaurant Table", table, "qr_token")
		self.assertNotEqual(new_token, token)
		self.assertEqual(self._guest(table_order.get_table_order, token, ok=False), "QR_CODE_INVALID")
		self.assertEqual(self._guest(table_order.get_table_order, new_token)["state"], "available")
		self.assertEqual(self._guest(table_order.get_table_order, "x" * 43, ok=False), "QR_CODE_INVALID")
		self.assertEqual(self._guest(table_order.get_table_order, "short", ok=False), "QR_CODE_INVALID")

	def test_only_managers_print_and_only_once_qr_is_on(self):
		waiter = ensure_test_user(WAITER, roles=(WAITER_ROLE,), pos_profile=self.till)
		frappe.set_user(waiter)
		denied = table_order.print_table_qr_cards(self.till, [self.tables[0]])
		self.assertEqual(denied["errors"][0]["code"], "FLOOR_PLAN_PERMISSION_DENIED")
		# Staff and kiosk logins never read a table's code.
		doc = frappe.client.get("Restaurant Table", self.tables[0])
		self.assertNotIn("qr_token", {key for key, value in doc.items() if value})
		frappe.set_user("Administrator")
		manager = ensure_test_user(
			"_test_qr_manager@example.com", roles=(RESTAURANT_MANAGER_ROLE,), pos_profile=self.till
		)
		frappe.set_user(manager)
		self.assertTrue(frappe.client.get("Restaurant Table", self.tables[0]).get("qr_token"))
		frappe.set_user("Administrator")

		self._switch_qr(self.till, on=False)
		off = table_order.print_table_qr_cards(self.till, [self.tables[0]])
		self.assertEqual(off["errors"][0]["code"], "QR_ORDERING_OFF")
		self.assertEqual(
			table_order.regenerate_table_qr(self.till, self.tables[0])["errors"][0]["code"], "QR_ORDERING_OFF"
		)
		self.assertFalse(table_order.get_qr_tables(self.till)["data"]["enabled"])
		self.assertEqual(
			self._guest(table_order.get_table_order, self.codes[self.tables[0]], ok=False), "QR_ORDERING_OFF"
		)

	# ---- guests ----

	def test_guest_sees_the_table_and_its_menu_but_nothing_about_the_visit(self):
		setup = self._guest(table_order.get_table_order, self.codes[self.tables[0]])
		self.assertEqual(
			set(setup), {"restaurant_name", "table_label", "floor_name", "service_type", "currency", "state"}
		)
		self.assertEqual((setup["service_type"], setup["state"]), (TEST_TABLE_SERVICE, "available"))
		menu = self._guest(table_order.get_table_menu, self.codes[self.tables[0]])
		self.assertIn(self.item, [item["item_code"] for item in menu["items"]])

		placed = self._send(self.tables[0])
		self.assertEqual(set(placed), {"order", "status"})
		self.assertEqual(placed["status"], "Pending")
		self.assertEqual(
			self._guest(table_order.get_table_order, self.codes[self.tables[0]])["state"], "occupied"
		)
		status = self._guest(table_order.get_table_order_status, self.codes[self.tables[0]], placed["order"])
		self.assertEqual(status, {"order": placed["order"], "status": "Pending"})
		# The reference only works with its own table's code.
		self.assertEqual(
			self._guest(
				table_order.get_table_order_status, self.codes[self.tables[1]], placed["order"], ok=False
			),
			"QR_ORDER_NOT_FOUND",
		)

	def test_a_signed_in_request_is_refused_and_keeps_its_user(self):
		frappe.set_user(KIOSK_USER)
		try:
			response = table_order.place_table_order(
				self.codes[self.tables[0]], [{"item_code": self.item, "qty": 1}], str(uuid4())
			)
			self.assertEqual(frappe.session.user, KIOSK_USER)
		finally:
			frappe.set_user("Administrator")
		self.assertEqual(response["errors"][0]["code"], "QR_GUEST_ONLY")
		self.assertEqual(
			table_order.get_table_order(self.codes[self.tables[0]])["errors"][0]["code"], "QR_GUEST_ONLY"
		)

	def test_a_pending_order_is_a_draft_that_staff_cannot_bill_or_extend(self):
		key = str(uuid4())
		placed = self._send(self.tables[0], key=key)
		session = frappe.get_doc("Restaurant Session", {"qr_guest_ref": placed["order"]})
		self.assertEqual(
			(session.order_source, session.qr_status, session.status, session.service_type),
			("QR", "Pending", "Open", TEST_TABLE_SERVICE),
		)
		self.assertEqual(session.waiter, frappe.db.get_value("POS Profile", self.till, "vunapos_qr_user"))
		orders = self._rounds(session.name)
		self.assertEqual(len(orders), 1)
		self.assertEqual(frappe.db.get_value("Sales Order", orders[0], "docstatus"), 0)
		self.assertEqual(
			frappe.get_all("Kitchen Order Ticket", filters={"restaurant_session": session.name}), []
		)
		self.assertFalse(
			frappe.db.exists("Stock Reservation Entry", {"voucher_no": orders[0], "docstatus": 1})
		)
		# A retry returns the same order; another order for the table is refused.
		self.assertEqual(self._send(self.tables[0], key=key), placed)
		self.assertEqual(self._send(self.tables[0], ok=False), "TABLE_HAS_ORDER")
		self.assertEqual(len(self._rounds(session.name)), 1)

		# Staff see it on the floor and Open Orders, with its draft.
		status = {row["table"]: row for row in restaurant.get_table_status(self.till)["data"]}
		self.assertEqual(status[self.tables[0]]["status"], "New QR Order")
		row = next(row for row in restaurant.list_sessions(self.till)["data"] if row["name"] == session.name)
		self.assertEqual(
			(row["order_source"], row["qr_status"], row["sales_orders"]), ("QR", "Pending", orders)
		)
		# Kiosks only see the table taken.
		frappe.set_user(KIOSK_USER)
		kiosk_tables = {
			row["table"]: row for row in kiosk.get_kiosk_setup(self.kiosk_profile)["data"]["tables"]
		}
		frappe.set_user("Administrator")
		self.assertEqual(kiosk_tables[self.tables[0]]["status"], "Occupied")

		for response in (
			restaurant.create_session_round(session.name, [{"item_code": self.item}], str(uuid4())),
			restaurant.preview_session_bill(session.name, self.till),
			restaurant.update_session(session.name, guest_count=3),
			restaurant.update_session(session.name, tables=[self.tables[1]]),
		):
			self.assertEqual(response["errors"][0]["code"], "QR_ORDER_PENDING", response)
		# Nor can a gateway payment start on it.
		from vunapos.services import restaurant_payment_service

		with self.assertRaises(frappe.ValidationError) as pending:
			restaurant_payment_service.prepare(
				frappe.get_doc("POS Profile", self.till), session.name, "review", 1, "Cash", None
			)
		self.assertEqual(pending.exception.vuna_error_code, "QR_ORDER_PENDING")

	def test_accepting_sends_the_order_to_the_kitchen_and_the_waiter_flow_continues(self):
		placed = self._send(self.tables[0])
		session = frappe.db.get_value("Restaurant Session", {"qr_guest_ref": placed["order"]}, "name")
		# Accepting needs the staff member's own open shift.
		waiter = ensure_test_user(WAITER, roles=(WAITER_ROLE,), pos_profile=self.till)
		frappe.set_user(waiter)
		no_shift = table_order.accept_qr_order(session, self.till)
		frappe.set_user("Administrator")
		self.assertFalse(no_shift["ok"], no_shift)
		self.assertEqual(frappe.db.get_value("Restaurant Session", session, "qr_status"), "Pending")

		accepted = table_order.accept_qr_order(session, self.till)
		self.assertTrue(accepted["ok"], accepted)
		data = accepted["data"]
		self.assertEqual(
			(data["qr_status"], data["accepted_by"], data["waiter"]),
			("Accepted", "Administrator", "Administrator"),
		)
		order = self._rounds(session)[0]
		self.assertEqual(frappe.db.get_value("Sales Order", order, "docstatus"), 1)
		self.assertEqual(
			len(frappe.get_all("Kitchen Order Ticket", filters={"restaurant_session": session})), 1
		)
		self.assertEqual(
			self._guest(table_order.get_table_order_status, self.codes[self.tables[0]], placed["order"])[
				"status"
			],
			"Accepted",
		)
		# Accepting again changes nothing; rejecting is refused.
		self.assertTrue(table_order.accept_qr_order(session, self.till)["ok"])
		self.assertEqual(
			table_order.reject_qr_order(session, "Too late", self.till)["errors"][0]["code"],
			"QR_ORDER_NOT_PENDING",
		)
		# The waiter flow takes over: more rounds, then the bill. Scanning again adds nothing.
		more = restaurant.create_session_round(session, [{"item_code": self.item, "qty": 1}], str(uuid4()))
		self.assertTrue(more["ok"], more)
		self.assertEqual(self._send(self.tables[0], ok=False), "TABLE_HAS_ORDER")
		# The till bills unfinished dishes, as for any waiter order.
		self._set_till("vunapos_complete_preparation_on_billing", 1)
		preview = restaurant.preview_session_bill(session, self.till)
		self.assertTrue(preview["ok"], preview)
		total = preview["data"]["invoice"]["totals"]
		mode = self.profile.payments[0].mode_of_payment
		paid = restaurant.checkout_session(
			session,
			self.till,
			preview["data"]["fingerprint"],
			[{"mode_of_payment": mode, "amount": total["rounded_total"] or total["grand_total"]}],
		)
		self.assertTrue(paid["ok"], paid)
		# Billing frees the table, as for any waiter order: no Clear table step.
		self.assertTrue(all(row["released_at"] for row in paid["data"]["session"]["tables"]))
		self.assertEqual(self._send(self.tables[0])["status"], "Pending")

	def test_rejecting_deletes_the_draft_and_frees_the_table(self):
		placed = self._send(self.tables[0])
		session = frappe.db.get_value("Restaurant Session", {"qr_guest_ref": placed["order"]}, "name")
		order = self._rounds(session)[0]
		waiter = ensure_test_user(WAITER, roles=(WAITER_ROLE,), pos_profile=self.till)
		frappe.set_user(waiter)
		self.assertEqual(
			table_order.reject_qr_order(session, " ", self.till)["errors"][0]["code"],
			"REJECT_REASON_REQUIRED",
		)
		# No manager PIN and no shift: nothing reached the kitchen.
		self._set_till("vunapos_require_manager_pin_order_cancel", 1)
		rejected = table_order.reject_qr_order(session, "Prank order", self.till)
		frappe.set_user("Administrator")
		self.assertTrue(rejected["ok"], rejected)
		doc = frappe.get_doc("Restaurant Session", session)
		self.assertEqual(
			(doc.status, doc.qr_status, doc.cancel_reason, doc.cancelled_by),
			("Cancelled", "Rejected", "Prank order", waiter),
		)
		self.assertFalse(frappe.db.exists("Sales Order", order))
		self.assertTrue(all(row.released_at for row in doc.tables))
		self.assertEqual(
			self._guest(table_order.get_table_order_status, self.codes[self.tables[0]], placed["order"])[
				"status"
			],
			"Rejected",
		)
		self.assertEqual(self._send(self.tables[0])["status"], "Pending")

	def test_a_table_held_by_any_visit_takes_no_qr_order(self):
		before = frappe.db.count("Restaurant Session", {"order_source": "QR"})
		opened = restaurant.open_session(self.till, str(uuid4()), [self.tables[0]], TEST_TABLE_SERVICE)
		self.assertTrue(opened["ok"], opened)
		self.assertEqual(
			self._guest(table_order.get_table_order, self.codes[self.tables[0]])["state"], "occupied"
		)
		self.assertEqual(self._send(self.tables[0], ok=False), "TABLE_HAS_ORDER")
		self.assertEqual(frappe.db.count("Restaurant Session", {"order_source": "QR"}), before)
		# Stock is checked like any order, and a failed order leaves nothing behind.
		self.assertEqual(self._send(self.tables[1], qty=5000, ok=False), "RESTAURANT_STOCK_SHORTAGE")
		self.assertEqual(frappe.db.count("Restaurant Session", {"order_source": "QR"}), before)

	def test_order_source_is_recorded_for_waiters_and_kiosks(self):
		opened = restaurant.open_session(self.till, str(uuid4()), [self.tables[0]], TEST_TABLE_SERVICE)
		self.assertEqual(opened["data"]["order_source"], "Waiter")
		frappe.set_user(KIOSK_USER)
		placed = kiosk.place_kiosk_order(
			self.kiosk_profile,
			TEST_COUNTER_SERVICE,
			[{"item_code": self.item, "qty": 1, "line_id": str(uuid4())}],
			str(uuid4()),
		)
		frappe.set_user("Administrator")
		self.assertEqual(
			frappe.db.get_value("Restaurant Session", placed["data"]["session"], "order_source"), "Kiosk"
		)
		# Visits from before the field existed are filled in from their kiosk status.
		frappe.db.set_value("Restaurant Session", placed["data"]["session"], "order_source", "")
		from vunapos.patches.v1_0.set_restaurant_session_order_source import execute

		execute()
		self.assertEqual(
			frappe.db.get_value("Restaurant Session", placed["data"]["session"], "order_source"), "Kiosk"
		)
		self.assertEqual(
			frappe.db.get_value("Restaurant Session", opened["data"]["name"], "order_source"), "Waiter"
		)


class TestSharedRestaurantProfile(IntegrationTestCase):
	"""One till with staff, Kiosk Mode limited to one floor, and QR, all at once."""

	_item = fixtures.TestKitchenService._item
	_raw_item = fixtures.TestKitchenService._raw_item
	_station = fixtures.TestKitchenService._station
	_floors = kiosk_tests.TestRestaurantKiosk._floors
	_manager = kiosk_tests.TestRestaurantKiosk._manager
	_kiosk_profile = kiosk_tests.TestRestaurantKiosk._kiosk_profile
	_set_till = kiosk_tests.TestRestaurantKiosk._set_till
	_switch_qr = TestRestaurantQrOrdering._switch_qr
	_code = TestRestaurantQrOrdering._code
	_guest = TestRestaurantQrOrdering._guest
	tearDown = TestRestaurantQrOrdering.tearDown

	def setUp(self):
		kiosk_tests.TestRestaurantKiosk.setUp(self)
		profile = frappe.get_doc("POS Profile", self.till)
		kiosk_profile = frappe.get_doc("POS Profile", self.kiosk_profile)
		profile.update(
			{
				"vunapos_kiosk_mode": 1,
				"vunapos_kiosk_payment_timing": kiosk_profile.vunapos_kiosk_payment_timing,
				"vunapos_kiosk_service_types": [
					{"service_type": row.service_type} for row in kiosk_profile.vunapos_kiosk_service_types
				],
				"vunapos_kiosk_floors": [{"floor": self.kiosk_floor}],
				"vunapos_qr_ordering": 1,
				"vunapos_qr_service_type": TEST_TABLE_SERVICE,
			}
		)
		if not any(row.role == "Manager" and row.enabled for row in profile.vunapos_pin_users):
			profile.append(
				"vunapos_pin_users",
				{
					"sales_person": self._manager(),
					"role": "Manager",
					"pin": kiosk_tests.MANAGER_PIN,
					"enabled": 1,
				},
			)
		profile.save(ignore_permissions=True)
		frappe.clear_document_cache("POS Profile", self.till)
		self.kiosk_on_till = ensure_test_user(
			"_test_shared_kiosk@example.com", roles=(KIOSK_ROLE,), pos_profile=self.till
		)

	def test_kiosk_floors_limit_only_kiosk_logins(self):
		# A waiter orders on a floor the kiosk does not serve.
		opened = restaurant.open_session(
			self.till, str(uuid4()), [self.other_floor_table], TEST_TABLE_SERVICE
		)
		self.assertTrue(opened["ok"], opened)
		menu = restaurant.get_menu(self.till, TEST_TABLE_SERVICE, self.other_floor_table)
		self.assertTrue(menu["ok"], menu)
		round_ = restaurant.create_session_round(
			opened["data"]["name"], [{"item_code": self.item, "qty": 1}], str(uuid4())
		)
		self.assertTrue(round_["ok"], round_)

		# The kiosk login on the same till is still limited to its floor.
		frappe.set_user(self.kiosk_on_till)
		refused = restaurant.validate_cart(
			self.till, TEST_TABLE_SERVICE, [{"item_code": self.item, "qty": 1}], self.other_floor_table
		)
		allowed = kiosk.place_kiosk_order(
			self.till,
			TEST_TABLE_SERVICE,
			[{"item_code": self.item, "qty": 1, "line_id": str(uuid4())}],
			str(uuid4()),
			table=self.tables[0],
		)
		frappe.set_user("Administrator")
		self.assertEqual(refused["errors"][0]["code"], "TABLE_NOT_ON_KIOSK_FLOOR")
		self.assertTrue(allowed["ok"], allowed)

	def test_qr_and_kiosk_orders_on_one_till(self):
		code = self._code(self.other_floor_table)
		placed = self._guest(
			table_order.place_table_order,
			code,
			[{"item_code": self.item, "qty": 1, "line_id": str(uuid4())}],
			str(uuid4()),
		)
		self.assertEqual(placed["status"], "Pending")
		session = frappe.db.get_value("Restaurant Session", {"qr_guest_ref": placed["order"]}, "name")
		self.assertEqual(frappe.db.get_value("Restaurant Session", session, "pos_profile"), self.till)
		accepted = table_order.accept_qr_order(session, self.till)
		self.assertTrue(accepted["ok"], accepted)
		# The kiosk login still cannot use a table off its floor.
		frappe.set_user(self.kiosk_on_till)
		refused = restaurant.validate_cart(
			self.till, TEST_TABLE_SERVICE, [{"item_code": self.item, "qty": 1}], self.other_floor_table
		)
		frappe.set_user("Administrator")
		self.assertEqual(refused["errors"][0]["code"], "TABLE_NOT_ON_KIOSK_FLOOR")
