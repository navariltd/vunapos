import json

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import now_datetime

from vunapos.api import restaurant
from vunapos.services.floor_plan_service import (
	FLOOR_DOCTYPE,
	TABLE_DOCTYPE,
	get_floor_plan_version,
	save_floor_plan,
)
from vunapos.services.pos_closing import close_pos_session, get_closing_preview
from vunapos.services.pos_entry import create_pos_opening_entry
from vunapos.services.profile_service import get_bootstrap_data
from vunapos.services.restaurant_order_service import ORDER_DOCTYPE
from vunapos.services.sync_service import get_pos_bootstrap, get_pos_bootstrap_config
from vunapos.setup.utils import (
	CASHIER_ROLE,
	RESTAURANT_MANAGER_ROLE,
	RESTAURANT_ROLES,
	WAITER_ROLE,
	ensure_vunapos_roles,
)
from vunapos.tests.helpers import (
	create_invoice_with_item,
	ensure_test_item,
	ensure_test_restaurant_profile,
	ensure_test_user,
	set_invoice_mode,
)

WAITER = "_test_vunapos_role_waiter@example.com"
CASHIER = "_test_vunapos_role_cashier@example.com"
MANAGER = "_test_vunapos_role_manager@example.com"
MANAGER_CASHIER = "_test_vunapos_role_manager_cashier@example.com"
SERVICE_TYPE = "Dine In"


class TestVunaPOSRestaurantRoles(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		frappe.set_user("Administrator")
		ensure_vunapos_roles()
		set_invoice_mode("Sales Invoice")
		cls.profile = ensure_test_restaurant_profile()
		cls.item = ensure_test_item()
		if not frappe.db.exists("VunaPOS Service Type", SERVICE_TYPE):
			frappe.get_doc(
				{"doctype": "VunaPOS Service Type", "service_type_name": SERVICE_TYPE, "requires_table": 1}
			).insert(ignore_permissions=True)
		# Each user holds only the VunaPOS roles under test, so these tests prove
		# the roles work without Sales User or Accounts User.
		ensure_test_user(WAITER, roles=(WAITER_ROLE,), pos_profile=cls.profile)
		ensure_test_user(CASHIER, roles=(CASHIER_ROLE,), pos_profile=cls.profile)
		ensure_test_user(MANAGER, roles=(RESTAURANT_MANAGER_ROLE,), pos_profile=cls.profile)
		ensure_test_user(
			MANAGER_CASHIER, roles=(RESTAURANT_MANAGER_ROLE, CASHIER_ROLE), pos_profile=cls.profile
		)
		# Built once: billed orders link their invoice to the table, so it can't
		# be deleted between tests.
		cls.table = cls._create_floor_plan()

	def setUp(self):
		frappe.set_user("Administrator")
		ensure_vunapos_roles()
		# Free the table for the next order.
		frappe.db.delete(ORDER_DOCTYPE, {"pos_profile": self.profile, "status": "Open"})

	def tearDown(self):
		frappe.set_user("Administrator")

	@classmethod
	def _create_floor_plan(cls):
		frappe.db.delete(ORDER_DOCTYPE, {"pos_profile": cls.profile})
		for name in frappe.get_all(TABLE_DOCTYPE, filters={"pos_profile": cls.profile}, pluck="name"):
			frappe.delete_doc(TABLE_DOCTYPE, name, ignore_permissions=True)
		for name in frappe.get_all(FLOOR_DOCTYPE, filters={"pos_profile": cls.profile}, pluck="name"):
			frappe.delete_doc(FLOOR_DOCTYPE, name, ignore_permissions=True)
		result = save_floor_plan(
			cls.profile,
			{
				"version": get_floor_plan_version(cls.profile),
				"floors": [
					{
						"client_id": "f1",
						"floor_name": "Main Hall",
						"elements": [],
						"tables": [
							{
								"client_id": "t1",
								"table_label": "T1",
								"seats": 4,
								"shape": "Square",
								"x": 100,
								"y": 100,
								"width": 80,
								"height": 80,
							}
						],
					}
				],
			},
		)
		return result["id_map"]["tables"]["t1"]

	def _ok(self, response):
		self.assertTrue(response["ok"], response)
		return response["data"]

	def _create_order(self):
		return self._ok(
			restaurant.create_order(
				pos_profile=self.profile,
				service_type=SERVICE_TYPE,
				table=self.table,
				items=json.dumps([{"item_code": self.item, "qty": 2}]),
			)
		)

	def _amount_due(self, order):
		totals = self._ok(restaurant.preview_order(order))["invoice"]["totals"]
		return totals.get("rounded_total") or totals["grand_total"]

	def _payment_modes(self):
		return [row.mode_of_payment for row in frappe.get_doc("POS Profile", self.profile).payments]

	# ---- role creation ----

	def test_all_restaurant_roles_exist_after_setup(self):
		for role in RESTAURANT_ROLES:
			self.assertTrue(frappe.db.exists("Role", role), role)

	def test_missing_roles_are_created_when_the_manager_role_already_exists(self):
		# Regression: ensure_vunapos_roles used to return as soon as the manager
		# role existed, so roles added later were never created.
		for role in (CASHIER_ROLE, WAITER_ROLE):
			frappe.db.delete("Custom DocPerm", {"role": role})
			frappe.db.delete("Role", {"name": role})
		self.assertTrue(frappe.db.exists("Role", RESTAURANT_MANAGER_ROLE))

		ensure_vunapos_roles()

		for role in (CASHIER_ROLE, WAITER_ROLE):
			self.assertTrue(frappe.db.exists("Role", role), role)
		self.assertTrue(
			frappe.db.exists("Custom DocPerm", {"parent": "POS Opening Entry", "role": CASHIER_ROLE})
		)

	def test_role_setup_is_idempotent(self):
		ensure_vunapos_roles()
		ensure_vunapos_roles()
		for role in RESTAURANT_ROLES:
			self.assertEqual(
				frappe.db.count("Custom DocPerm", {"parent": "POS Profile", "role": role, "permlevel": 0}),
				1,
				role,
			)

	def test_rules_grant_only_the_listed_rights(self):
		# Custom DocPerm defaults read and export to 1; neither may leak in.
		for role in RESTAURANT_ROLES:
			account = frappe.db.get_value(
				"Custom DocPerm",
				{"parent": "Account", "role": role, "permlevel": 0},
				["select", "read", "export"],
				as_dict=True,
			)
			self.assertEqual((account.select, account.read, account.export), (1, 0, 0), role)
			self.assertFalse(
				frappe.db.exists("Custom DocPerm", {"role": role, "permlevel": 0, "export": 1}), role
			)
		self.assertFalse(frappe.has_permission("Account", "read", user=WAITER))
		self.assertTrue(frappe.has_permission("Account", "select", user=WAITER))

	def test_existing_rules_for_other_roles_are_kept(self):
		# Adding the first custom rule must copy the doctype's standard rules, or
		# every other role (and so Retail) would lose its access.
		self.assertTrue(frappe.has_permission("Sales Invoice", "submit", user="Administrator"))
		self.assertTrue(
			frappe.db.exists(
				"Custom DocPerm", {"parent": "Sales Invoice", "role": "Accounts User", "submit": 1}
			)
		)

	# ---- permissions ----

	def test_every_restaurant_role_can_read_pos_profile(self):
		for user in (WAITER, CASHIER, MANAGER):
			self.assertTrue(frappe.has_permission("POS Profile", "read", user=user), user)

	def test_waiter_permissions(self):
		def can(doctype, ptype, doc=None):
			return frappe.has_permission(doctype, ptype, doc=doc, user=WAITER)

		self.assertTrue(can(ORDER_DOCTYPE, "create"))
		self.assertTrue(can(ORDER_DOCTYPE, "write"))
		self.assertFalse(can(ORDER_DOCTYPE, "delete"))
		for doctype in ("VunaPOS Service Type", FLOOR_DOCTYPE, TABLE_DOCTYPE, "Item", "Customer"):
			self.assertTrue(can(doctype, "read"), doctype)
		self.assertFalse(can(FLOOR_DOCTYPE, "write"))
		self.assertFalse(can("Sales Invoice", "create"))
		self.assertFalse(can("POS Opening Entry", "create"))
		self.assertFalse(can("POS Closing Entry", "create"))

	def test_invoice_read_for_waiter_and_manager_is_only_if_creator(self):
		# Doctype-level read passes ERPNext's pricing check, but invoices created
		# by someone else stay hidden.
		invoice = create_invoice_with_item("Sales Invoice")
		for user in (WAITER, MANAGER):
			self.assertTrue(frappe.has_permission("Sales Invoice", "read", user=user), user)
			self.assertFalse(
				frappe.has_permission("Sales Invoice", "read", doc=invoice["name"], user=user), user
			)

	def test_cashier_permissions(self):
		def can(doctype, ptype):
			return frappe.has_permission(doctype, ptype, user=CASHIER)

		for doctype in ("Sales Invoice", "POS Invoice"):
			for ptype in ("read", "write", "create", "submit"):
				self.assertTrue(can(doctype, ptype), (doctype, ptype))
			for ptype in ("cancel", "amend", "delete"):
				self.assertFalse(can(doctype, ptype), (doctype, ptype))
		for doctype in ("POS Opening Entry", "POS Closing Entry"):
			for ptype in ("read", "create", "submit"):
				self.assertTrue(can(doctype, ptype), (doctype, ptype))
			self.assertFalse(can(doctype, "cancel"), doctype)
		self.assertTrue(can(ORDER_DOCTYPE, "create"))
		self.assertFalse(can(FLOOR_DOCTYPE, "write"))

	def test_manager_without_cashier_cannot_open_a_shift_or_bill(self):
		self.assertFalse(frappe.has_permission("POS Opening Entry", "create", user=MANAGER))
		self.assertFalse(frappe.has_permission("Sales Invoice", "create", user=MANAGER))

	# ---- bootstrap ----

	def test_bootstrap_can_take_payment_requires_the_cashier_role(self):
		expected = {
			WAITER: (False, [WAITER_ROLE]),
			CASHIER: (True, [CASHIER_ROLE]),
			MANAGER: (False, [RESTAURANT_MANAGER_ROLE]),
			MANAGER_CASHIER: (True, [CASHIER_ROLE, RESTAURANT_MANAGER_ROLE]),
		}
		for user, (can_take_payment, roles) in expected.items():
			frappe.set_user(user)
			data = get_bootstrap_data(self.profile)
			self.assertIs(data["can_take_payment"], can_take_payment, user)
			self.assertEqual(data["restaurant_roles"], roles, user)

	def test_spa_bootstrap_payloads_carry_the_restaurant_rights(self):
		# The SPA caches pos_profile from these endpoints, not get_bootstrap_data,
		# so the rights must travel there (full and delta sync alike).
		expected = {
			WAITER: (False, [WAITER_ROLE]),
			CASHIER: (True, [CASHIER_ROLE]),
			MANAGER: (False, [RESTAURANT_MANAGER_ROLE]),
			MANAGER_CASHIER: (True, [CASHIER_ROLE, RESTAURANT_MANAGER_ROLE]),
		}
		for user, (can_take_payment, roles) in expected.items():
			frappe.set_user(user)
			payloads = {
				"config": get_pos_bootstrap_config(self.profile),
				"full": get_pos_bootstrap(self.profile),
				"delta": get_pos_bootstrap(self.profile, since=str(now_datetime())),
			}
			for kind, payload in payloads.items():
				profile = payload["pos_profile"]
				self.assertIs(profile["can_take_payment"], can_take_payment, (user, kind))
				self.assertEqual(profile["restaurant_roles"], roles, (user, kind))
				self.assertIn(SERVICE_TYPE, [row["name"] for row in profile["restaurant"]["service_types"]])

	# ---- end to end, each user holding only their VunaPOS role ----

	def test_waiter_takes_orders_without_a_shift_but_cannot_bill(self):
		frappe.set_user(WAITER)
		self.assertTrue(get_bootstrap_data(self.profile)["pos_profile"])
		self._ok(restaurant.get_floor_plan(self.profile))
		menu = self._ok(restaurant.get_menu(self.profile, service_type=SERVICE_TYPE, table=self.table))
		self.assertIn(self.item, [item["item_code"] for item in menu["items"]])

		order = self._create_order()
		self._ok(restaurant.add_order_items(order["name"], json.dumps([{"item_code": self.item}])))
		self.assertGreater(self._amount_due(order["name"]), 0)

		response = restaurant.checkout_order(
			order["name"],
			payments=json.dumps([{"mode_of_payment": self._payment_modes()[0], "amount": 1000}]),
			idempotency_key=frappe.generate_hash(length=12),
		)
		self.assertFalse(response["ok"], response)
		# Refused by permission, before the shift check: a waiter can't bill even
		# with an open shift.
		self.assertEqual(response["errors"][0]["code"], "PermissionError", response)
		self.assertEqual(frappe.db.get_value(ORDER_DOCTYPE, order["name"], "status"), "Open")

	def test_cashier_opens_a_shift_bills_an_order_and_closes_the_shift(self):
		frappe.set_user(CASHIER)
		modes = self._payment_modes()
		opening = create_pos_opening_entry(
			pos_profile=self.profile,
			opening_balance=[{"mode_of_payment": mode, "opening_amount": 0} for mode in modes],
			user=CASHIER,
		)
		self.assertEqual(opening.docstatus, 1)

		order = self._create_order()
		due = self._amount_due(order["name"])
		result = self._ok(
			restaurant.checkout_order(
				order["name"],
				payments=json.dumps([{"mode_of_payment": modes[0], "amount": due}]),
				idempotency_key=frappe.generate_hash(length=12),
			)
		)
		self.assertEqual(result["order"]["status"], "Billed")
		invoice = frappe.db.get_value(
			result["invoice"]["doctype"], result["invoice"]["name"], ["docstatus", "owner"], as_dict=True
		)
		self.assertEqual((invoice.docstatus, invoice.owner), (1, CASHIER))

		preview = get_closing_preview(self.profile)
		closing = close_pos_session(
			self.profile,
			[
				{"mode_of_payment": row["mode_of_payment"], "closing_amount": row["expected_amount"]}
				for row in preview["payments"]
			],
		)
		self.assertEqual(frappe.db.get_value("POS Closing Entry", closing["name"], "docstatus"), 1)
