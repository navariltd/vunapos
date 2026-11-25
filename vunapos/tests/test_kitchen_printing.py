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
			("vunapos.services.kitchen_printing._", {"side_effect": lambda value: value}),
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

	def test_releases_owned_undispatched_claim(self):
		doc = SimpleNamespace(
			status="Claimed",
			claim_token="hashed",
			lease_until=datetime.now(),
		)
		with (
			patch.object(service, "_claimed", return_value=doc) as claimed,
			patch.object(service, "_save") as save,
		):
			service.release_claim("job", "token", "POS A")
			claimed.assert_called_once_with("job", "token", "POS A")
			self.assertIsNone(doc.claim_token)
			self.assertIsNone(doc.lease_until)
			save.assert_called_once_with(doc, "Queued", "Terminal released claim before dispatch.")

	def test_cannot_release_after_dispatch_or_without_claim(self):
		for status in ("Sending", "Submitted", "Uncertain", "Failed", "Queued"):
			with self.subTest(status=status):
				doc = SimpleNamespace(status=status, claim_token="hashed")
				with (
					patch.object(service, "_claimed", return_value=doc),
					patch.object(service, "_save") as save,
				):
					with self.assertRaises(frappe.ValidationError):
						service.release_claim("job", "token")
					save.assert_not_called()
					self.assertEqual(doc.claim_token, "hashed")

	def test_cannot_release_another_users_claim(self):
		doc = SimpleNamespace(
			kitchen_station="station",
			status="Claimed",
			claimed_by="cook",
			claim_token=hashlib.sha256(b"private").hexdigest(),
		)
		with (
			patch.object(service, "station_access"),
			patch.object(frappe, "get_doc", return_value=doc),
			patch.object(frappe, "db", MagicMock()),
			patch.object(frappe, "session", SimpleNamespace(user="other")),
			patch.object(service, "_save") as save,
		):
			with self.assertRaises(frappe.PermissionError):
				service.release_claim("job", "private")
			save.assert_not_called()

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

		doc = SimpleNamespace(
			name="job-001",
			kitchen_station="station-a",
			status="Queued",
			ticket_kind="NEW ORDER",
		)
		with patch.object(frappe, "publish_realtime") as publish:
			KitchenPrintJob.on_update(doc)
			self.assertEqual(
				publish.call_args.kwargs,
				{"doctype": "Kitchen Station", "docname": "station-a", "after_commit": True},
			)
			payload = publish.call_args.args[1]
			self.assertEqual(payload["name"], doc.name)
			self.assertEqual(payload["kitchen_station"], doc.kitchen_station)
			self.assertEqual(payload["status"], doc.status)
			self.assertEqual(payload["ticket_kind"], doc.ticket_kind)
			self.assertEqual(
				set(payload),
				{"name", "kitchen_station", "status", "ticket_kind"},
			)

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
			payload = publish.call_args.args[1]
			self.assertEqual(payload["name"], doc.name)
			self.assertEqual(payload["kitchen_station"], doc.kitchen_station)
			self.assertEqual(payload["action"], doc.action)


class TestCashierPrintingPermissions(unittest.TestCase):
	def setUp(self):
		def throw(message, exc=frappe.ValidationError):
			raise exc(message)

		self.station = MagicMock()
		self.station.restaurant = "Restaurant A"
		self.station.branch = "Branch A"

		self.profile = frappe._dict(
			vunapos_branch="Branch A",
			disabled=0,
			custom_run_kitchen_print_worker_on_pos=1,
		)

		self.roles = patch.object(
			frappe,
			"get_roles",
			return_value=["VunaPOS Cashier"],
		).start()

		self.get_doc = patch.object(
			frappe,
			"get_doc",
			side_effect=self.get_document,
		).start()

		self.restaurant_access = patch.object(
			service,
			"require_restaurant_access",
		).start()

		self.profile_access = patch(
			"vunapos.services.floor_plan_service.require_restaurant_profile",
			return_value="Restaurant A",
		).start()

		patch.object(frappe, "throw", side_effect=throw).start()
		patch.object(service, "_", side_effect=lambda value: value).start()

		self.addCleanup(patch.stopall)

	def get_document(self, doctype, name, **kwargs):
		if doctype == "POS Profile":
			return self.profile
		if doctype == service.STATION:
			return self.station
		raise AssertionError(f"Unexpected DocType: {doctype}")

	def test_assigned_cashier_can_access_matching_station(self):
		self.assertIs(
			service.station_access("Station A", "POS A"),
			self.station,
		)
		self.profile_access.assert_called_once_with("POS A")
		self.restaurant_access.assert_called_once_with(
			"Restaurant A",
			branch="Branch A",
		)
		self.station.check_permission.assert_called_once_with("read")

	def test_cashier_without_profile_is_denied(self):
		with self.assertRaises(frappe.PermissionError):
			service.station_access("Station A")

	def test_unassigned_cashier_is_denied(self):
		self.profile_access.side_effect = frappe.PermissionError
		with self.assertRaises(frappe.PermissionError):
			service.station_access("Station A", "POS A")

	def test_cashier_with_printing_disabled_is_denied(self):
		self.profile.custom_run_kitchen_print_worker_on_pos = 0
		with self.assertRaises(frappe.PermissionError):
			service.station_access("Station A", "POS A")

	def test_disabled_profile_is_denied(self):
		self.profile.disabled = 1
		with self.assertRaises(frappe.PermissionError):
			service.station_access("Station A", "POS A")

	def test_cross_branch_access_is_denied(self):
		self.station.branch = "Branch B"
		with self.assertRaises(frappe.PermissionError):
			service.station_access("Station B", "POS A")

	def test_cross_restaurant_access_is_denied(self):
		self.station.restaurant = "Restaurant B"
		with self.assertRaises(frappe.PermissionError):
			service.station_access("Station B", "POS A")

	def test_station_permission_is_still_required(self):
		self.station.check_permission.side_effect = frappe.PermissionError
		with self.assertRaises(frappe.PermissionError):
			service.station_access("Station A", "POS A")

	def test_waiter_only_cannot_operate_worker(self):
		self.roles.return_value = ["VunaPOS Waiter"]
		with self.assertRaises(frappe.PermissionError):
			service.station_access("Station A", "POS A")

	def test_cashier_cannot_retry_uncertain_delivery(self):
		with self.assertRaises(frappe.PermissionError):
			service.retry("job", "Checked printer")

	def test_cashier_cannot_confirm_delivery(self):
		with self.assertRaises(frappe.PermissionError):
			service.confirm_delivery("job", "Verified paper")

	def test_existing_worker_roles_remain_authorized(self):
		for role in (
			"System Manager",
			"VunaPOS Restaurant Manager",
			"VunaPOS Kitchen User",
		):
			with self.subTest(role=role):
				self.roles.return_value = [role]
				self.assertIs(
					service.station_access("Station A"),
					self.station,
				)
		self.profile_access.assert_not_called()
