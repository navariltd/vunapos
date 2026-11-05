from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.api import restaurant as api
from vunapos.services.restaurant_location_service import validate_location_snapshot
from vunapos.tests.helpers import (
	ensure_open_pos_opening_entry,
	ensure_test_item,
	ensure_test_restaurant_profile,
	set_invoice_mode,
)


class TestRestaurantLocationSnapshots(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.profile = frappe.get_doc("POS Profile", ensure_test_restaurant_profile())
		ensure_open_pos_opening_entry(self.profile.name)
		self.service = next(
			row.service_type
			for row in frappe.get_doc("Restaurant", self.profile.vunapos_restaurant).service_types
			if not frappe.get_cached_value("Restaurant Service Type", row.service_type, "requires_table")
		)
		self.item = ensure_test_item()
		set_invoice_mode("Sales Invoice")

	def _order(self):
		response = api.create_order(
			self.profile.name,
			service_type=self.service,
			items=[{"item_code": self.item, "qty": 1}],
			idempotency_key=str(uuid4()),
		)
		self.assertTrue(response["ok"], response)
		return frappe.get_doc("Sales Order", response["data"]["name"])

	def _bill(self, order):
		preview = api.preview_order(order.name)
		self.assertTrue(preview["ok"], preview)
		invoice = preview["data"]["invoice"]
		self.assertEqual(invoice["branch"], order.vunapos_branch)
		total = invoice["totals"]["rounded_total"] or invoice["totals"]["grand_total"]
		response = api.checkout_order(
			order.name,
			payments=[{"mode_of_payment": self.profile.payments[0].mode_of_payment, "amount": total}],
			idempotency_key=str(uuid4()),
		)
		self.assertTrue(response["ok"], response)
		return frappe.get_doc(response["data"]["invoice"]["doctype"], response["data"]["invoice"]["name"])

	def test_order_stores_and_returns_both_location_fields(self):
		order = self._order()
		self.assertEqual(
			(order.vunapos_restaurant, order.vunapos_branch),
			(self.profile.vunapos_restaurant, self.profile.vunapos_branch),
		)
		self.assertEqual(api.get_order(order.name)["data"]["branch"], order.vunapos_branch)
		self.assertEqual(api.list_orders(self.profile.name)["data"][0]["branch"], order.vunapos_branch)

	def test_legacy_sales_invoice_billing_stores_location(self):
		order = self._order()
		invoice = self._bill(order)
		self.assertEqual(
			(invoice.vunapos_restaurant, invoice.vunapos_branch),
			(order.vunapos_restaurant, order.vunapos_branch),
		)

	def test_legacy_pos_invoice_billing_stores_location(self):
		set_invoice_mode("POS Invoice")
		order = self._order()
		invoice = self._bill(order)
		self.assertEqual(invoice.doctype, "POS Invoice")
		self.assertEqual(invoice.vunapos_branch, order.vunapos_branch)

	def test_order_location_cannot_be_changed_after_placement(self):
		order = self._order()
		branch = frappe.get_doc(
			{
				"doctype": "Branch",
				"branch": f"Snapshot {uuid4().hex[:8]}",
				"vunapos_company": self.profile.company,
			}
		).insert()
		order.vunapos_branch = branch.name
		order.flags.ignore_validate_update_after_submit = True
		with self.assertRaises(frappe.ValidationError) as error:
			order.save()
		self.assertEqual(error.exception.vuna_error_code, "RESTAURANT_LOCATION_MISMATCH")

	def test_invoice_location_cannot_be_cleared(self):
		invoice = self._bill(self._order())
		invoice.vunapos_branch = None
		invoice.flags.ignore_validate_update_after_submit = True
		with self.assertRaises(frappe.ValidationError) as error:
			invoice.save()
		self.assertEqual(error.exception.vuna_error_code, "RESTAURANT_LOCATION_MISMATCH")

	def test_mixed_location_source_orders_are_rejected(self):
		doc = frappe.get_doc(
			{
				"doctype": "Sales Invoice",
				"company": self.profile.company,
				"items": [{"sales_order": "A"}, {"sales_order": "B"}],
			}
		)
		with patch(
			"frappe.get_all",
			return_value=[
				frappe._dict(
					vunapos_restaurant="Restaurant", vunapos_branch=branch, company=self.profile.company
				)
				for branch in ("A", "B")
			],
		):
			with self.assertRaises(frappe.ValidationError):
				validate_location_snapshot(doc)

	def test_retail_documents_are_not_given_restaurant_snapshots(self):
		for doctype in ("Sales Order", "Sales Invoice", "POS Invoice"):
			doc = frappe.get_doc({"doctype": doctype, "company": self.profile.company})
			validate_location_snapshot(doc)
			self.assertFalse(doc.get("vunapos_restaurant"))
			self.assertFalse(doc.get("vunapos_branch"))

	def test_copy_honoring_no_copy_does_not_inherit_visit_or_location(self):
		order = self._order()
		order.vunapos_restaurant_session = "Original visit"
		copied = frappe.copy_doc(order, ignore_no_copy=False)
		for field in ("vunapos_restaurant", "vunapos_branch", "vunapos_restaurant_session"):
			self.assertFalse(copied.get(field))

	def test_restaurant_order_without_originating_profile_is_rejected(self):
		doc = frappe.get_doc(
			{
				"doctype": "Sales Order",
				"company": self.profile.company,
				"vunapos_restaurant": self.profile.vunapos_restaurant,
			}
		)
		with self.assertRaises(frappe.ValidationError) as error:
			validate_location_snapshot(doc)
		self.assertEqual(error.exception.vuna_error_code, "RESTAURANT_LOCATION_MISMATCH")

	def test_backfill_fills_blanks_without_overwriting_snapshots_or_modified_time(self):
		from vunapos.patches.v1_0.backfill_restaurant_document_locations import _stamp

		order = self._order()
		modified = order.modified
		location = (order.vunapos_restaurant, order.vunapos_branch, order.company)
		frappe.db.set_value("Sales Order", order.name, "vunapos_branch", None, update_modified=False)
		_stamp("Sales Order", order.name, location)
		order.reload()
		self.assertEqual(order.vunapos_branch, location[1])
		self.assertEqual(order.modified, modified)
		_stamp("Sales Order", order.name, (location[0], "Other Branch", location[2]))
		self.assertEqual(frappe.db.get_value("Sales Order", order.name, "vunapos_branch"), location[1])

	def test_backfill_does_not_guess_when_legacy_order_has_no_source_profile(self):
		from vunapos.patches.v1_0.backfill_restaurant_document_locations import execute

		with (
			patch("vunapos.setup.utils.ensure_vunapos_custom_fields"),
			patch("frappe.get_all", side_effect=[["Legacy"], [], []]),
			patch("frappe.db.sql", return_value=[]),
			patch(
				"frappe.db.get_value",
				return_value=frappe._dict(vunapos_restaurant_session=None, vunapos_pos_profile=None),
			) as get_value,
			patch("frappe.db.set_value") as set_value,
		):
			execute()
			get_value.assert_called_once()
			set_value.assert_not_called()
