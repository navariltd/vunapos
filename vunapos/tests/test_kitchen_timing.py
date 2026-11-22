from unittest import TestCase
from unittest.mock import patch

from vunapos.services.kitchen_progress_service import derive as derive_progress
from vunapos.services.kitchen_timing_service import derive


class TestKitchenTiming(TestCase):
	def setUp(self):
		self.enterContext(
			patch("vunapos.services.kitchen_timing_service.get_system_timezone", return_value="UTC")
		)
		self.items = [{"line_id": "meal", "qty": 4}]
		self.sent = "2026-11-22 12:00:00"

	def event(self, action, minute, qty=4, status=None, **payload):
		return {
			"action": action,
			"occurred_at": f"2026-11-22 12:{minute:02}:00",
			"to_status": status,
			"item_quantities": {"deltas": {"meal": qty}, **payload},
		}

	def timing(self, status, events, progress=None):
		if progress is None:
			progress = derive_progress(
				self.items, status, [row for row in events if row.get("outcome", "Succeeded") == "Succeeded"]
			)
		return derive(self.items, self.sent, status, events, progress, details=True)

	def full(self):
		return [
			self.event("Accept", 2),
			self.event("Start", 5),
			self.event("Ready", 12, status="Ready"),
			self.event("Serve", 15, status="Served"),
		]

	def test_sent_ticket_waits_for_acceptance(self):
		result = self.timing("Sent", [])
		self.assertEqual(
			result["current"], {"stage": "acceptance", "pending": True, "since": "2026-11-22T12:00:00+00:00"}
		)

	def test_current_stage_restarts_at_each_transition(self):
		for count, status, stage, minute in (
			(1, "Accepted", "queue", "02"),
			(2, "Preparing", "preparation", "05"),
			(3, "Ready", "service", "12"),
		):
			with self.subTest(status=status):
				result = self.timing(status, self.full()[:count])
				self.assertEqual(result["current"]["stage"], stage)
				self.assertEqual(result["current"]["since"], f"2026-11-22T12:{minute}:00+00:00")

	def test_four_stage_durations_and_frozen_served_time(self):
		result = self.timing("Served", self.full())
		self.assertIsNone(result["current"])
		self.assertEqual(result["finished_at"], "2026-11-22T12:15:00+00:00")
		self.assertEqual([row["seconds"] for row in result["batches"]], [120, 180, 420, 180])

	def test_partial_ready_keeps_unfinished_quantities_on_their_own_clock(self):
		events = [
			self.event("Accept", 1),
			self.event("Start", 2),
			self.event("Ready", 5, 2),
			self.event("Ready", 9, 2),
		]
		partial = self.timing("Preparing", events[:3])
		self.assertEqual(partial["current"]["stage"], "preparation")
		self.assertEqual(partial["current"]["since"], "2026-11-22T12:02:00+00:00")
		result = self.timing("Ready", events)
		self.assertEqual(result["current"]["since"], "2026-11-22T12:05:00+00:00")
		self.assertEqual(
			[(row["qty"], row["seconds"]) for row in result["batches"] if row["stage"] == "preparation"],
			[(2, 180), (2, 420)],
		)

	def test_partial_starts_are_matched_in_recorded_order(self):
		events = [
			self.event("Accept", 1, 2),
			self.event("Accept", 2, 2),
			self.event("Start", 3, 2),
			self.event("Start", 5, 2),
			self.event("Ready", 8),
		]
		result = self.timing("Ready", events)
		self.assertEqual(
			[(row["qty"], row["seconds"]) for row in result["batches"] if row["stage"] == "preparation"],
			[(2, 300), (2, 180)],
		)

	def test_addons_do_not_count_as_separate_preparation_batches(self):
		self.items.append({"line_id": "milk", "parent_line_id": "meal", "qty": 8})
		result = self.timing("Served", self.full())
		self.assertEqual(len(result["batches"]), 4)
		self.assertTrue(all(row["line_id"] == "meal" for row in result["batches"]))

	def test_failed_ready_and_billing_completion_do_not_start_service_timer(self):
		failed = {**self.event("Ready", 8), "outcome": "Failed"}
		result = self.timing("Preparing", [*self.full()[:2], failed, self.event("Complete for Billing", 10)])
		self.assertEqual(result["current"]["stage"], "preparation")
		self.assertEqual(len(result["batches"]), 2)

	def test_serving_correction_restarts_waiting_without_altering_previous_batches(self):
		result = self.timing("Ready", [*self.full(), self.event("Undo Serve", 18, 2)])
		self.assertIsNone(result["finished_at"])
		self.assertEqual(result["current"]["since"], "2026-11-22T12:18:00+00:00")
		self.assertEqual(len(result["batches"]), 4)

	def test_waste_audit_does_not_move_the_original_served_time(self):
		result = self.timing("Served", [*self.full(), self.event("Record Waste", 25, 1, status="Served")])
		self.assertEqual(result["finished_at"], "2026-11-22T12:15:00+00:00")

	def test_cancelled_unprepared_quantities_do_not_leave_a_live_timer(self):
		result = self.timing(
			"Cancelled", [self.event("Accept", 1), self.event("Cancel Items", 3, status="Cancelled")]
		)
		self.assertIsNone(result["current"])
		self.assertEqual(result["finished_at"], "2026-11-22T12:03:00+00:00")
		self.assertEqual(len(result["batches"]), 1)

	def test_rejected_ready_quantities_do_not_keep_waiting_for_service(self):
		result = self.timing(
			"Completed",
			[*self.full()[:3], self.event("Reject Items", 14, status="Completed", retired={"meal": 4})],
		)
		self.assertIsNone(result["current"])
		self.assertEqual(result["finished_at"], "2026-11-22T12:14:00+00:00")
		self.assertFalse(any(row["stage"] == "service" for row in result["batches"]))

	def test_imported_ticket_does_not_invent_preparation_times(self):
		result = self.timing("Ready", [])
		self.assertEqual(result["current"]["stage"], "service")
		self.assertIsNone(result["current"]["since"])
		self.assertEqual(result["batches"], [])

	def test_legacy_whole_ticket_events_retain_real_stage_times(self):
		events = [
			{key: value for key, value in row.items() if key != "item_quantities"} for row in self.full()
		]
		result = self.timing("Served", events)
		self.assertEqual([row["seconds"] for row in result["batches"]], [120, 180, 420, 180])

	def test_missing_baseline_timestamp_is_not_estimated_from_sent_time(self):
		event = self.event(
			"Ready",
			8,
			before={"meal": {"accepted_qty": 4, "started_qty": 4, "ready_qty": 0, "served_qty": 0}},
		)
		result = self.timing("Ready", [event])
		self.assertIsNone(result["batches"][0]["seconds"])
		self.assertIsNone(result["batches"][0]["started_at"])

	def test_api_timestamps_carry_the_site_timezone(self):
		with patch(
			"vunapos.services.kitchen_timing_service.get_system_timezone", return_value="Africa/Nairobi"
		):
			result = self.timing("Sent", [])
		self.assertEqual(result["current"]["since"], "2026-11-22T12:00:00+03:00")

	def test_served_quantity_keeps_its_real_finish_time_when_remainder_is_cancelled(self):
		events = [
			self.event("Accept", 1),
			self.event("Start", 2),
			self.event("Ready", 5, 2),
			self.event("Serve", 7, 2, status="Preparing"),
			self.event("Stop Preparation", 10, 2, status="Served"),
		]
		result = self.timing("Served", events)
		self.assertEqual(result["finished_at"], "2026-11-22T12:07:00+00:00")
		self.assertIsNone(result["current"])

	def test_new_remake_ticket_starts_at_its_own_sent_time(self):
		self.sent = "2026-11-22 12:30:00"
		result = self.timing("Sent", [])
		self.assertEqual(result["current"]["since"], "2026-11-22T12:30:00+00:00")

	def test_fractional_uom_quantities_are_not_rounded_to_whole_meals(self):
		self.items[0]["qty"] = 1.5
		result = self.timing("Accepted", [self.event("Accept", 2, 0.5)])
		self.assertEqual(result["batches"][0]["qty"], 0.5)
		self.assertEqual(result["current"]["stage"], "acceptance")
