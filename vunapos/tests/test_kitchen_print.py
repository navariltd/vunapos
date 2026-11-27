import json
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

import frappe
from jinja2 import Environment

from vunapos.services.print_service import render_kitchen_ticket


class TestKitchenPrint(TestCase):
	def setUp(self):
		self.ticket = Mock(name="ticket")
		self.ticket.name = "KOT-1"
		self.ticket.restaurant = "Restaurant A"
		self.ticket.branch = "Branch A"
		self.ticket.kitchen_station = "Station A"
		self.ticket.docstatus = 1
		self.station = Mock()
		self.station.get.return_value = None
		self.format = SimpleNamespace(
			name="Kitchen Order Ticket", doc_type="Kitchen Order Ticket", disabled=0, raw_printing=0
		)
		self.docs = patch("frappe.get_doc", side_effect=[self.ticket, self.station, self.format]).start()
		self.access = patch("vunapos.services.restaurant_service.require_restaurant_access").start()
		self.render = patch("frappe.get_print", return_value="<p>Ticket</p>").start()
		self.throw = patch("frappe.throw", side_effect=frappe.ValidationError).start()
		self.translate = patch("vunapos.services.print_service._", side_effect=lambda value: value).start()
		patch(
			"frappe.get_meta", return_value=SimpleNamespace(default_print_format="Kitchen Order Ticket")
		).start()
		self.addCleanup(patch.stopall)

	def test_renders_saved_ticket_without_mutating_or_submitting_it(self):
		result = render_kitchen_ticket("KOT-1")
		self.assertEqual(result["ticket"], "KOT-1")
		self.access.assert_called_once_with("Restaurant A", branch="Branch A")
		self.assertEqual([c.args[0] for c in self.ticket.check_permission.call_args_list], ["read", "print"])
		self.station.check_permission.assert_called_once_with("read")
		self.render.assert_called_once_with(
			"Kitchen Order Ticket",
			"KOT-1",
			print_format="Kitchen Order Ticket",
			doc=self.ticket,
			no_letterhead=1,
		)
		self.ticket.save.assert_not_called()
		self.ticket.submit.assert_not_called()
		self.ticket.db_set.assert_not_called()

	def test_denied_restaurant_never_renders(self):
		self.access.side_effect = frappe.PermissionError
		with self.assertRaises(frappe.PermissionError):
			render_kitchen_ticket("KOT-1")
		self.render.assert_not_called()

	def test_station_format_overrides_doctype_default(self):
		self.station.get.return_value = "Compact Kitchen Ticket"
		self.format.name = "Compact Kitchen Ticket"
		result = render_kitchen_ticket("KOT-1")
		self.assertEqual(result["print_format"], "Compact Kitchen Ticket")
		self.assertEqual(self.render.call_args.kwargs["print_format"], "Compact Kitchen Ticket")

	def test_respects_changed_doctype_default(self):
		with patch("frappe.get_meta", return_value=SimpleNamespace(default_print_format="Branch Default")):
			self.format.name = "Branch Default"
			self.assertEqual(render_kitchen_ticket("KOT-1")["print_format"], "Branch Default")

	def test_standard_fallback_when_doctype_has_no_default(self):
		with patch("frappe.get_meta", return_value=SimpleNamespace(default_print_format=None)):
			self.assertEqual(render_kitchen_ticket("KOT-1")["print_format"], "Standard")

	def test_denied_station_never_renders(self):
		self.station.check_permission.side_effect = frappe.PermissionError
		with self.assertRaises(frappe.PermissionError):
			render_kitchen_ticket("KOT-1")
		self.render.assert_not_called()

	def test_denied_ticket_read_never_renders(self):
		self.ticket.check_permission.side_effect = frappe.PermissionError
		with self.assertRaises(frappe.PermissionError):
			render_kitchen_ticket("KOT-1")
		self.render.assert_not_called()

	def test_read_does_not_grant_print(self):
		self.ticket.check_permission.side_effect = [None, frappe.PermissionError]
		with self.assertRaises(frappe.PermissionError):
			render_kitchen_ticket("KOT-1")
		self.render.assert_not_called()

	def test_draft_ticket_never_renders(self):
		self.ticket.docstatus = 0
		with self.assertRaises(frappe.ValidationError):
			render_kitchen_ticket("KOT-1")
		self.render.assert_not_called()

	def test_disabled_or_wrong_format_never_falls_back(self):
		for field, value in (("disabled", 1), ("raw_printing", 1), ("doc_type", "Sales Invoice")):
			with self.subTest(field=field):
				self.docs.side_effect = [self.ticket, self.station, self.format]
				old = getattr(self.format, field)
				setattr(self.format, field, value)
				with self.assertRaises(frappe.ValidationError):
					render_kitchen_ticket("KOT-1")
				setattr(self.format, field, old)
		self.render.assert_not_called()

	def cancellation_event(self, **changes):
		event = Mock()
		for key, value in dict(
			name="KACT-1",
			kitchen_ticket="KOT-1",
			kitchen_station=self.ticket.kitchen_station,
			restaurant=self.ticket.restaurant,
			branch=self.ticket.branch,
			outcome="Succeeded",
			action="Cancel Items",
			item_quantities='{"deltas":{"dish":1}}',
			occurred_at="2026-11-20 12:00",
			actor="Waiter",
			reason="Guest changed order",
		).items():
			setattr(event, key, changes.get(key, value))
		self.ticket.items = [SimpleNamespace(line_id="dish", qty=2, item_name="Tea", uom="Nos")]
		self.docs.side_effect = [self.ticket, self.station, event, self.format]
		return event

	def test_cancellation_uses_saved_delta_without_mutating_original_quantity(self):
		event = self.cancellation_event()
		render_kitchen_ticket("KOT-1", action="KACT-1")
		event.check_permission.assert_called_once_with("read")
		self.assertEqual(self.ticket.print_action.lines[0].qty, 1)
		self.assertEqual(self.ticket.items[0].qty, 2)
		self.ticket.save.assert_not_called()
		event.save.assert_not_called()

	def test_cancellation_rejects_unrelated_failed_and_non_cancellation_events(self):
		for changes in (
			{"kitchen_ticket": "KOT-2"},
			{"branch": "Other"},
			{"outcome": "Failed"},
			{"action": "Ready"},
		):
			self.cancellation_event(**changes)
			with self.assertRaises(frappe.ValidationError):
				render_kitchen_ticket("KOT-1", action="KACT-1")
		self.render.assert_not_called()

	def test_cancellation_requires_event_read_permission(self):
		event = self.cancellation_event()
		event.check_permission.side_effect = frappe.PermissionError
		with self.assertRaises(frappe.PermissionError):
			render_kitchen_ticket("KOT-1", action="KACT-1")
		self.render.assert_not_called()

	def test_cancellation_rejects_missing_unknown_and_invalid_deltas(self):
		for deltas in ({}, {"other": 1}, {"dish": -1}, {"dish": 3}, {"dish": "nan"}):
			self.cancellation_event(item_quantities=json.dumps({"deltas": deltas}))
			with self.assertRaises(frappe.ValidationError):
				render_kitchen_ticket("KOT-1", action="KACT-1")
		self.render.assert_not_called()

	def test_whole_order_cancellation_does_not_invent_item_deltas(self):
		self.cancellation_event(action="Cancel Order", item_quantities=None)
		render_kitchen_ticket("KOT-1", action="KACT-1")
		self.assertEqual(self.ticket.print_action.lines, [])


class TestKitchenPrintTemplate(TestCase):
	def test_delivery_hides_internal_job_id_but_preserves_retry_warning(self):
		path = (
			Path(__file__).parents[1] / "vunapos/print_format/kitchen_order_ticket/kitchen_order_ticket.json"
		)
		template = Environment(autoescape=False).from_string(json.loads(path.read_text())["html"])
		doc = SimpleNamespace(
			station_label="Kitchen",
			service_type="Takeaway",
			table_labels="",
			name="KOT-1",
			sales_order="SO-1",
			print_action=SimpleNamespace(
				action="Cancel Order",
				occurred_at="2026-11-27 08:00",
				actor="Waiter",
				reason="Cancelled",
				lines=[],
			),
		)
		for attempt in (1, 2):
			doc.print_delivery = SimpleNamespace(name="internal-random-hash", attempt=attempt)
			html = template.render(
				doc=doc,
				_=lambda value: value,
				frappe=SimpleNamespace(utils=SimpleNamespace(get_system_timezone=lambda: "Africa/Nairobi")),
			)
			self.assertNotIn("internal-random-hash", html)
			self.assertIn("KOT-1", html)
			self.assertEqual("RETRY — CHECK FOR AN EARLIER COPY" in html, attempt > 1)

	def test_escapes_notes_and_marks_cancelled_replacement_as_manual_copy(self):
		path = (
			Path(__file__).parents[1] / "vunapos/print_format/kitchen_order_ticket/kitchen_order_ticket.json"
		)
		format_doc = json.loads(path.read_text())
		row = SimpleNamespace(
			line_id="dish",
			parent_line_id=None,
			qty=2,
			uom="Box",
			item_name="Tea <special>",
			note='<img src=x onerror="alert(1)">',
			modifiers='[{"label":"<script>bad()</script>"}]',
		)
		addon = SimpleNamespace(
			line_id="extra",
			parent_line_id="dish",
			qty=1,
			uom="Cup",
			item_name="Milk",
			note="",
			modifiers="[]",
		)
		doc = SimpleNamespace(
			station_label="Grill",
			name="KOT-1",
			status="Cancelled",
			remake_of="KOT-0",
			remake_reason="Wrong dish",
			restaurant="Restaurant A",
			branch="Branch A",
			sales_order="SO-1",
			service_type="Dine In",
			table_labels="4",
			sent_at="2026-11-19 12:00",
			waiter="Waiter",
			sent_by="Waiter",
			order_note="No onions",
			items=[row, addon],
		)
		html = (
			Environment(autoescape=False)
			.from_string(format_doc["html"])
			.render(
				doc=doc,
				_=lambda value: value,
				frappe=SimpleNamespace(
					utils=SimpleNamespace(parse_json=json.loads, get_system_timezone=lambda: "Asia/Kolkata")
				),
			)
		)
		for text in (
			"MANUAL COPY",
			"CANCELLED — DO NOT PREPARE",
			"REPLACEMENT",
			"Original order copy",
			"2 Box",
			"Add-on",
			"For: Tea &lt;special&gt;",
			"No onions",
		):
			self.assertIn(text, html)
		self.assertNotIn("<img", html)
		self.assertNotIn("<script", html)
		self.assertIn("&lt;script&gt;", html)
		self.assertNotIn("Grand total", html)

	def test_cancellation_prints_only_event_lines_and_escapes_reason(self):
		path = (
			Path(__file__).parents[1] / "vunapos/print_format/kitchen_order_ticket/kitchen_order_ticket.json"
		)
		doc = SimpleNamespace(
			station_label="Kitchen",
			service_type="Takeaway",
			table_labels="",
			name="KOT-1",
			sales_order="SO-1",
			items=[SimpleNamespace(item_name="DO NOT PRINT ORIGINAL")],
			print_action=SimpleNamespace(
				name="KACT-1",
				action="Cancel Items",
				occurred_at="2026-11-20 12:00",
				actor="Waiter",
				reason="<script>unsafe</script>",
				lines=[SimpleNamespace(qty=1, uom="Nos", item_name="Tea")],
			),
		)
		html = (
			Environment(autoescape=False)
			.from_string(json.loads(path.read_text())["html"])
			.render(
				doc=doc,
				_=lambda x: x,
				frappe=SimpleNamespace(utils=SimpleNamespace(get_system_timezone=lambda: "Asia/Kolkata")),
			)
		)
		self.assertIn("CANCEL 1 \u00d7 Tea", html)
		self.assertIn("KACT-1", html)
		self.assertNotIn("DO NOT PRINT ORIGINAL", html)
		self.assertNotIn("<script>", html)
		self.assertIn("&lt;script&gt;", html)
