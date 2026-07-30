import frappe
from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry
from erpnext.stock.doctype.stock_reservation_entry.stock_reservation_entry import (
	get_available_qty_to_reserve,
)
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, nowdate

from vunapos.services.invoice_service import create_invoice_from_cart
from vunapos.services.stock_reservation_service import (
	create_invoice_stock_reservations,
	release_invoice_stock_reservations,
	validate_invoice_stock_reservations,
)
from vunapos.tests.helpers import (
	ensure_batch_stock,
	ensure_test_batch_item,
	ensure_test_pos_profile,
	ensure_test_stock_item,
	set_invoice_mode,
)


class TestVunaPOSStockReservationService(IntegrationTestCase):
	def setUp(self):
		self.profile_name = ensure_test_pos_profile()
		self.profile = frappe.get_doc("POS Profile", self.profile_name)
		self.item_code = ensure_test_stock_item()
		for reservation in frappe.get_all(
			"Stock Reservation Entry",
			filters={"item_code": self.item_code, "voucher_type": "Sales Invoice", "docstatus": 1},
			pluck="name",
		):
			frappe.get_doc("Stock Reservation Entry", reservation).cancel()
		set_invoice_mode("Sales Invoice")
		frappe.db.set_single_value("Stock Settings", "enable_stock_reservation", 1)
		make_stock_entry(
			item_code=self.item_code,
			to_warehouse=self.profile.warehouse,
			qty=10,
			rate=100,
		)

	def _draft(self, qty=2):
		invoice = create_invoice_from_cart(
			pos_profile=self.profile_name,
			items=[{"item_code": self.item_code, "qty": qty}],
		)
		return frappe.get_doc(invoice["doctype"], invoice["name"])

	def test_reserves_stock_against_exact_sales_invoice_item(self):
		doc = self._draft(qty=2)

		reservations = create_invoice_stock_reservations(doc)

		self.assertEqual(len(reservations), 1)
		sre = frappe.get_doc("Stock Reservation Entry", reservations[0])
		self.assertEqual(sre.docstatus, 1)
		self.assertEqual(sre.voucher_type, "Sales Invoice")
		self.assertEqual(sre.voucher_no, doc.name)
		self.assertEqual(sre.voucher_detail_no, doc.items[0].name)
		self.assertEqual(sre.reserved_qty, 2)
		validate_invoice_stock_reservations(doc)

	def test_release_cancels_reservations(self):
		doc = self._draft(qty=2)
		reservations = create_invoice_stock_reservations(doc)

		release_invoice_stock_reservations(doc)

		self.assertEqual(frappe.db.get_value("Stock Reservation Entry", reservations[0], "docstatus"), 2)

	def test_repeated_reservation_returns_existing_entry(self):
		doc = self._draft(qty=2)
		first = create_invoice_stock_reservations(doc)

		second = create_invoice_stock_reservations(doc)

		self.assertEqual(second, first)
		self.assertEqual(
			frappe.db.count(
				"Stock Reservation Entry",
				{"voucher_type": "Sales Invoice", "voucher_no": doc.name, "docstatus": 1},
			),
			1,
		)

	def test_reservation_rejects_quantity_above_live_availability(self):
		available = get_available_qty_to_reserve(self.item_code, self.profile.warehouse)
		first = self._draft(qty=available - 1)
		doc = self._draft(qty=2)
		create_invoice_stock_reservations(first)

		with self.assertRaises(frappe.ValidationError) as context:
			create_invoice_stock_reservations(doc)

		self.assertEqual(context.exception.vuna_error_code, "INSUFFICIENT_STOCK_TO_RESERVE")
		self.assertFalse(
			frappe.db.exists(
				"Stock Reservation Entry",
				{"voucher_type": "Sales Invoice", "voucher_no": doc.name, "docstatus": 1},
			)
		)

	def test_modified_invoice_row_fails_reservation_integrity_check(self):
		doc = self._draft(qty=2)
		create_invoice_stock_reservations(doc)
		doc.items[0].qty = 3
		doc.items[0].stock_qty = 3

		with self.assertRaises(frappe.ValidationError) as context:
			validate_invoice_stock_reservations(doc)

		self.assertEqual(context.exception.vuna_error_code, "STOCK_RESERVATION_MISMATCH")

	def test_reserves_exact_multi_batch_bundle_entries(self):
		item_code = ensure_test_batch_item("_Test VunaPOS Reserved Multi Batch Item")
		ensure_batch_stock(
			item_code,
			self.profile.warehouse,
			[
				("VUNA-RESERVE-BATCH-A", 3, add_days(nowdate(), 30)),
				("VUNA-RESERVE-BATCH-B", 4, add_days(nowdate(), 60)),
			],
		)
		invoice = create_invoice_from_cart(
			pos_profile=self.profile_name,
			items=[
				{
					"item_code": item_code,
					"qty": 5,
					"batch_allocations": [
						{"batch_no": "VUNA-RESERVE-BATCH-A", "qty": 2},
						{"batch_no": "VUNA-RESERVE-BATCH-B", "qty": 3},
					],
				}
			],
		)
		doc = frappe.get_doc(invoice["doctype"], invoice["name"])

		reservations = create_invoice_stock_reservations(doc)

		sre = frappe.get_doc("Stock Reservation Entry", reservations[0])
		self.assertEqual(sre.reservation_based_on, "Serial and Batch")
		self.assertTrue(sre.has_batch_no)
		self.assertEqual(
			[(entry.batch_no, entry.qty) for entry in sre.sb_entries],
			[("VUNA-RESERVE-BATCH-A", 2), ("VUNA-RESERVE-BATCH-B", 3)],
		)
		validate_invoice_stock_reservations(doc)

	def test_reserves_single_batch_as_a_native_tracking_entry(self):
		item_code = ensure_test_batch_item("_Test VunaPOS Reserved Single Batch Item")
		ensure_batch_stock(
			item_code,
			self.profile.warehouse,
			[("VUNA-RESERVE-SINGLE-BATCH", 4, add_days(nowdate(), 30))],
		)
		invoice = create_invoice_from_cart(
			pos_profile=self.profile_name,
			items=[
				{
					"item_code": item_code,
					"qty": 2,
					"batch_allocations": [{"batch_no": "VUNA-RESERVE-SINGLE-BATCH", "qty": 2}],
				}
			],
		)
		doc = frappe.get_doc(invoice["doctype"], invoice["name"])

		reservations = create_invoice_stock_reservations(doc)

		sre = frappe.get_doc("Stock Reservation Entry", reservations[0])
		self.assertEqual(sre.reservation_based_on, "Serial and Batch")
		self.assertEqual(len(sre.sb_entries), 1)
		self.assertEqual(sre.sb_entries[0].batch_no, "VUNA-RESERVE-SINGLE-BATCH")
		self.assertEqual(sre.sb_entries[0].qty, 2)

	def test_reserves_exact_serials_with_their_batches(self):
		item_code = ensure_test_batch_item("_Test VunaPOS Reserved Serial Batch Item", has_serial_no=1)
		batch_no = f"VUNA-RESERVE-SERIAL-BATCH-{frappe.generate_hash(length=6)}"
		frappe.get_doc(
			{
				"doctype": "Batch",
				"batch_id": batch_no,
				"item": item_code,
				"expiry_date": add_days(nowdate(), 30),
			}
		).insert(ignore_permissions=True)
		serials = [
			f"VUNA-RESERVE-SERIAL-{frappe.generate_hash(length=8)}",
			f"VUNA-RESERVE-SERIAL-{frappe.generate_hash(length=8)}",
		]
		for serial_no in serials:
			frappe.get_doc(
				{
					"doctype": "Serial No",
					"serial_no": serial_no,
					"item_code": item_code,
					"company": self.profile.company,
					"batch_no": batch_no,
				}
			).insert(ignore_permissions=True)
		make_stock_entry(
			item_code=item_code,
			to_warehouse=self.profile.warehouse,
			qty=2,
			rate=100,
			serial_no=serials,
			batch_no=batch_no,
		)
		invoice = create_invoice_from_cart(
			pos_profile=self.profile_name,
			items=[
				{
					"item_code": item_code,
					"qty": 2,
					"serial_allocations": [
						{"serial_no": serial_no, "batch_no": batch_no} for serial_no in serials
					],
				}
			],
		)
		doc = frappe.get_doc(invoice["doctype"], invoice["name"])

		reservations = create_invoice_stock_reservations(doc)

		sre = frappe.get_doc("Stock Reservation Entry", reservations[0])
		self.assertEqual(sre.reservation_based_on, "Serial and Batch")
		self.assertTrue(sre.has_serial_no)
		self.assertTrue(sre.has_batch_no)
		self.assertEqual(
			{(entry.serial_no, entry.batch_no, entry.qty) for entry in sre.sb_entries},
			{(serial_no, batch_no, 1) for serial_no in serials},
		)
		validate_invoice_stock_reservations(doc)
