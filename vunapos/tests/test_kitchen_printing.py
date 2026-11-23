import hashlib
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import frappe

from vunapos.services import kitchen_printing as service


class TestKitchenDelivery(unittest.TestCase):
	def setUp(self):
		def throw(message, exc=frappe.ValidationError):
			raise exc(message)

		for target, kwargs in [
			("frappe.throw", {"side_effect": throw}),
			("vunapos.services.kitchen_printing.now_datetime", {"side_effect": datetime.now}),
		]:
			mock = patch(target, **kwargs)
			mock.start()
			self.addCleanup(mock.stop)

	def test_claim_token_is_checked_against_its_hash_and_actor(self):
		doc = SimpleNamespace(
			kitchen_station="station", claimed_by="cook", claim_token=hashlib.sha256(b"private").hexdigest()
		)
		with (
			patch.object(service, "station_access"),
			patch.object(frappe, "get_doc", return_value=doc),
			patch.object(frappe, "db", MagicMock()),
			patch.object(frappe, "session", SimpleNamespace(user="cook")),
		):
			self.assertIs(service._claimed("job", "private"), doc)
			with self.assertRaises(frappe.PermissionError):
				service._claimed("job", "wrong")
			with self.assertRaises(frappe.PermissionError):
				service._claimed("job", doc.claim_token)

	def test_dispatch_cannot_replay_an_already_sending_job(self):
		doc = SimpleNamespace(status="Sending", lease_until=datetime.now() + timedelta(minutes=1))
		with (
			patch.object(service, "_claimed", return_value=doc),
			patch("vunapos.services.print_service.render_kitchen_ticket") as render,
		):
			with self.assertRaises(frappe.ValidationError):
				service.dispatch("job", "token")
			render.assert_not_called()

	def test_render_failure_never_enters_sending(self):
		doc = SimpleNamespace(
			name="job",
			status="Claimed",
			lease_until=datetime.now() + timedelta(days=1),
			kitchen_ticket="ticket",
			action_event=None,
			attempts=1,
			ticket_kind="NEW ORDER",
			last_error="",
		)
		with (
			patch.object(service, "_claimed", return_value=doc),
			patch.object(service, "_save") as save,
			patch(
				"vunapos.services.print_service.render_kitchen_ticket",
				side_effect=ValueError("invalid template"),
			),
		):
			service.dispatch("job", "token")
			self.assertEqual(save.call_args.args[1], "Failed")

	def test_acknowledgement_replay_does_not_downgrade_submitted(self):
		with (
			patch.object(service, "_claimed", return_value=SimpleNamespace(status="Submitted")),
			patch.object(service, "_save") as save,
		):
			service.acknowledge("job", "token", submitted=False)
			save.assert_not_called()

	def test_expired_sending_is_uncertain_but_unsent_claim_is_safe_to_queue(self):
		for status, expected in [("Sending", "Uncertain"), ("Claimed", "Queued")]:
			doc = MagicMock(status=status, lease_until=datetime.now() - timedelta(days=1))
			with (
				patch.object(frappe, "get_all", return_value=["job"]),
				patch.object(frappe, "get_doc", return_value=doc),
				patch.object(service, "_save") as save,
			):
				service._recover_station("station")
				self.assertEqual(save.call_args.args[1], expected)

	def test_non_manager_cannot_retry_uncertain_delivery(self):
		with patch.object(frappe, "get_roles", return_value=["VunaPOS Kitchen User"]):
			with self.assertRaises(frappe.PermissionError):
				service.retry("job", "checked printer")

	def test_many_rejects_malformed_and_unbounded_station_lists(self):
		for value in ([], {}, [""], [1], ["station"] * 101):
			with self.assertRaises(frappe.ValidationError):
				service._normalize_stations(value)
		self.assertEqual(service._normalize_stations('["b", "a", "b"]'), ["a", "b"])

	def test_many_checks_every_station_before_any_claim(self):
		with (
			patch.object(service, "station_access", side_effect=[None, frappe.PermissionError("denied")]),
			patch.object(service, "claim") as claim,
		):
			with self.assertRaises(frappe.PermissionError):
				service.claim_many(["a", "b"])
			claim.assert_not_called()

	def test_blocked_station_does_not_block_another_station(self):
		with (
			patch.object(service, "station_access"),
			patch.object(service, "claim", side_effect=[None, {"name": "job"}]),
		):
			self.assertEqual(service.claim_many(["a", "b"]), {"name": "job"})

	def test_realtime_uses_station_room_after_commit_without_claim_secrets(self):
		from vunapos.vunapos.doctype.kitchen_print_job.kitchen_print_job import KitchenPrintJob

		doc = SimpleNamespace(kitchen_station="station-a", status="Queued", ticket_kind="NEW ORDER")
		with patch.object(frappe, "publish_realtime") as publish:
			KitchenPrintJob.on_update(doc)
			self.assertEqual(
				publish.call_args.kwargs,
				{"doctype": "Kitchen Station", "docname": "station-a", "after_commit": True},
			)
			self.assertEqual(set(publish.call_args.args[1]), {"kitchen_station", "status", "ticket_kind"})

	def test_all_day_covers_next_page_and_keeps_units_separate(self):
		def ticket(qty, ready=0, cancelled=0, uom="Nos"):
			return frappe._dict(
				status="Preparing",
				items=[
					dict(
						item_code="tea",
						item_name="Tea",
						qty=qty,
						ready_qty=ready,
						cancelled_qty=cancelled,
						uom=uom,
					)
				],
			)

		with patch(
			"vunapos.services.kitchen_lifecycle_service.list_board",
			side_effect=[
				{"tickets": [ticket(5, 1, 1)], "has_more": True},
				{"tickets": [ticket(2), ticket(4, uom="Cup")], "has_more": False},
			],
		) as board:
			result = service.all_day("profile", "station")
			self.assertEqual({row["uom"]: row["remaining"] for row in result["items"]}, {"Nos": 5, "Cup": 4})
			self.assertFalse(result["partial"])
			self.assertEqual(board.call_args.kwargs["start"], 100)

	def test_saved_cancellation_notifies_kds_even_without_print_output(self):
		doc = SimpleNamespace(
			action="Cancel Items",
			outcome="Succeeded",
			kitchen_station="station",
			kitchen_ticket="ticket",
			name="event",
		)
		with (
			patch.object(frappe, "publish_realtime") as publish,
			patch.object(frappe, "get_doc"),
			patch.object(service, "_enqueue"),
		):
			service.enqueue_action(doc)
			self.assertEqual(publish.call_args.args[0], "vunapos_kitchen_action_saved")
			self.assertTrue(publish.call_args.kwargs["after_commit"])
			self.assertEqual(publish.call_args.kwargs["docname"], "station")
