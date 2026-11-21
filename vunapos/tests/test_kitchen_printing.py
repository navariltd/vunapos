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
