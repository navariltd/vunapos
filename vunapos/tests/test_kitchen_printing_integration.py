from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, now_datetime

from vunapos.api import restaurant
from vunapos.services import kitchen_printing as printing
from vunapos.services.kitchen_notes import update_preparation_notes
from vunapos.tests import test_kitchen_service as fixtures


class TestKitchenPrintingIntegration(IntegrationTestCase):
	setUp = fixtures.TestKitchenService.setUp
	tearDown = fixtures.TestKitchenService.tearDown
	_item = fixtures.TestKitchenService._item
	_raw_item = fixtures.TestKitchenService._raw_item
	_station = fixtures.TestKitchenService._station
	_send = fixtures.TestKitchenService._send
	_tickets = fixtures.TestKitchenService._tickets

	def _place(self):
		frappe.db.set_value(
			"Kitchen Station", self.station, {"output_mode": "Both", "printer_name": "Test Kitchen Printer"}
		)
		key = str(uuid4())
		placed = self._send(key=key)
		self.assertTrue(placed["ok"], placed)
		ticket = self._tickets(placed["data"]["name"])[0]
		return placed["data"]["name"], ticket, key

	def test_print_delivery_and_placement_retries_do_not_repeat_production(self):
		order, ticket, key = self._place()
		retry = self._send(key=key)
		self.assertTrue(retry["ok"], retry)
		self.assertEqual(retry["data"]["name"], order)
		self.assertEqual(frappe.db.count("Kitchen Print Job", {"kitchen_ticket": ticket}), 1)
		work_order = frappe.db.get_value("Kitchen Order Ticket Item", {"parent": ticket}, "work_order")
		before = frappe.db.count("Stock Entry", {"work_order": work_order})
		job = printing.claim(self.station)
		self.assertIsNotNone(job)
		self.assertIsNone(printing.claim(self.station))
		payload = printing.dispatch(job["name"], job["token"])
		self.assertIn("NEW ORDER", payload["html"])
		printing.acknowledge(job["name"], job["token"], submitted=True)
		printing.acknowledge(job["name"], job["token"], submitted=False)
		self.assertEqual(frappe.db.get_value("Kitchen Print Job", job["name"], "status"), "Submitted")
		self.assertEqual(frappe.db.count("Stock Entry", {"work_order": work_order}), before)
		self.assertEqual(frappe.db.get_value("Work Order", work_order, "produced_qty"), 0)

	def test_station_print_format_and_doctype_default_render_real_tickets(self):
		from vunapos.services.print_service import render_kitchen_ticket

		_, ticket, _ = self._place()
		default = render_kitchen_ticket(ticket)
		self.assertEqual(default["print_format"], "Kitchen Order Ticket")
		custom = frappe.copy_doc(frappe.get_doc("Print Format", "Kitchen Order Ticket"))
		custom.name = f"_Test Kitchen Format {uuid4().hex[:8]}"
		custom.standard = "No"
		custom.html = "<div>Station format: {{ doc.name }}</div>"
		custom.insert()
		station = frappe.get_doc("Kitchen Station", self.station)
		station.print_format = custom.name
		station.save()
		printed = render_kitchen_ticket(ticket)
		self.assertEqual(printed["print_format"], custom.name)
		self.assertIn(f"Station format: {ticket}", printed["html"])
		custom.disabled = 1
		custom.save()
		with self.assertRaises(frappe.ValidationError):
			render_kitchen_ticket(ticket)
		with self.assertRaises(frappe.ValidationError):
			station.save()

	def test_expired_undispatched_claim_recovers_but_sending_requires_review(self):
		self._place()
		first = printing.claim(self.station)
		frappe.db.set_value(
			"Kitchen Print Job", first["name"], "lease_until", add_to_date(now_datetime(), seconds=-1)
		)
		second = printing.claim(self.station)
		self.assertEqual(second["name"], first["name"])
		self.assertNotEqual(second["token"], first["token"])
		with self.assertRaises(frappe.PermissionError):
			printing.dispatch(first["name"], first["token"])
		printing.dispatch(second["name"], second["token"])
		frappe.db.set_value(
			"Kitchen Print Job", second["name"], "lease_until", add_to_date(now_datetime(), seconds=-1)
		)
		self.assertIsNone(printing.claim(self.station))
		self.assertEqual(frappe.db.get_value("Kitchen Print Job", second["name"], "status"), "Uncertain")
		printing.confirm_delivery(second["name"], "Verified existing paper copy")
		self.assertEqual(frappe.db.get_value("Kitchen Print Job", second["name"], "status"), "Submitted")

	def test_notes_and_partial_cancellation_preserve_timing_and_queue_each_delta_once(self):
		order, ticket, _key = self._place()
		before_note = (
			frappe.db.get_value("Kitchen Order Ticket Item", {"parent": ticket, "line_id": "main"}, "note")
			or ""
		)
		request_key = str(uuid4())
		self.assertTrue(
			update_preparation_notes(ticket, "main", "No salt", before_note, request_key)["queued"]
		)
		update_preparation_notes(ticket, "main", "No salt", before_note, request_key)
		quote = restaurant.preview_item_cancellation(order)
		self.assertTrue(quote["ok"], quote)
		key = str(uuid4())
		for _attempt in range(2):
			result = restaurant.cancel_order_items(
				order, {"main": 1}, key, quote["data"]["fingerprint"], "Guest changed order"
			)
			self.assertTrue(result["ok"], result)
		jobs = frappe.get_all("Kitchen Print Job", filters={"kitchen_ticket": ticket}, fields=["ticket_kind"])
		self.assertCountEqual(
			[row.ticket_kind for row in jobs], ["NEW ORDER", "MODIFIED INSTRUCTIONS", "CANCELLATION"]
		)
		detail = restaurant.get_kitchen_ticket(ticket)
		self.assertTrue(detail["ok"], detail)
		self.assertEqual(detail["data"]["items"][0]["note"], "No salt")
		self.assertEqual(detail["data"]["items"][0]["cancelled_qty"], 1)
		self.assertEqual(detail["data"]["timing"]["current"]["stage"], "acceptance")
