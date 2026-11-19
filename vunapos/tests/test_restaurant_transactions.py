from unittest import TestCase
from unittest.mock import MagicMock, call, patch

import frappe

from vunapos.api import gateway, restaurant
from vunapos.utils.response import failure, success
from vunapos.utils.transactions import rollback_savepoint


class DatabaseOperationalError(Exception):
	pass


class TestRestaurantTransactions(TestCase):
	def setUp(self):
		self.db = MagicMock(OperationalError=DatabaseOperationalError)
		self.flags = frappe._dict()
		self.local = frappe._dict(message_log=["Earlier message"], cache={"old": "snapshot"})
		self.enterContext(patch("frappe.db", self.db))
		self.enterContext(patch("frappe.flags", self.flags))
		self.enterContext(patch("frappe.local", self.local))
		self.enterContext(patch("vunapos.api.restaurant._", side_effect=lambda value: value))

	def test_snapshot_conflict_restarts_the_whole_request_with_the_same_key(self):
		keys = []

		@restaurant._atomic_write
		def command(key):
			keys.append(key)
			try:
				if len(keys) == 1:
					self.local.message_log.append("Aborted attempt")
					raise frappe.QueryDeadlockError(1020, "Snapshot changed")
				return success({"key": key})
			except Exception as exc:
				return restaurant._failure_from_exception(exc)

		response = command("original-request")
		self.assertTrue(response["ok"], response)
		self.assertEqual(keys, ["original-request", "original-request"])
		self.db.rollback.assert_called_once_with()
		self.assertEqual(self.db.savepoint.call_count, 2)
		self.assertEqual(self.local.cache, {})
		self.assertEqual(self.local.message_log, ["Earlier message"])
		self.assertIsNone(self.flags.vunapos_retrying_database)
		self.db.commit.assert_not_called()

	def test_retry_limit_rolls_back_and_returns_a_clear_retryable_error(self):
		command = MagicMock(side_effect=frappe.QueryDeadlockError(1213, "Deadlock"))
		response = restaurant._retry_database_conflicts(command)()
		self.assertFalse(response["ok"])
		self.assertEqual(response["errors"][0]["code"], "RESTAURANT_TRANSACTION_CONFLICT")
		self.assertTrue(response["meta"]["retryable"])
		self.assertEqual(command.call_count, 3)
		self.assertEqual(self.db.rollback.call_args_list, [call(), call(), call()])
		self.assertIsNone(self.flags.vunapos_retrying_database)
		self.db.commit.assert_not_called()

	def test_lock_timeout_is_retried_only_after_a_full_rollback(self):
		command = MagicMock(side_effect=[frappe.QueryTimeoutError("Lock wait"), success("saved")])
		self.assertTrue(restaurant._retry_database_conflicts(command)()["ok"])
		self.assertEqual(command.call_count, 2)
		self.db.rollback.assert_called_once_with()

	def test_nested_command_conflict_retries_the_outer_request_not_just_the_inner_write(self):
		events = []
		self.db.rollback.side_effect = lambda: events.append("rollback")

		@restaurant._atomic_write
		def inner():
			events.append("inner")
			if events.count("inner") == 1:
				raise frappe.QueryDeadlockError(1020, "Snapshot changed")
			return success("saved")

		@restaurant._atomic_write
		def outer():
			events.append("outer")
			return inner()

		self.assertTrue(outer()["ok"])
		self.assertEqual(events, ["outer", "inner", "rollback", "outer", "inner"])
		self.db.rollback.assert_called_once_with()

	def test_business_rejection_rolls_back_once_without_replaying(self):
		command = MagicMock(return_value=failure("Review changed", code="SESSION_BILL_CHANGED"))
		response = restaurant._atomic_write(command)()
		self.assertEqual(response["errors"][0]["code"], "SESSION_BILL_CHANGED")
		command.assert_called_once_with()
		self.db.rollback.assert_called_once_with(save_point=self.db.savepoint.call_args.args[0])

	def test_unknown_provider_timeout_is_not_automatically_replayed(self):
		command = MagicMock(side_effect=TimeoutError("Provider outcome unknown"))
		with self.assertRaises(TimeoutError):
			restaurant._atomic_write(command)()
		command.assert_called_once_with()
		self.db.rollback.assert_called_once_with(save_point=self.db.savepoint.call_args.args[0])
		self.assertIsNone(self.flags.vunapos_retrying_database)

	def test_missing_savepoint_does_not_replace_the_original_exception(self):
		original = frappe.ValidationError("Original failure")
		self.db.rollback.side_effect = [DatabaseOperationalError(1305, "SAVEPOINT missing"), None]
		command = restaurant._atomic_write(MagicMock(side_effect=original))
		with self.assertRaises(frappe.ValidationError) as raised:
			command()
		self.assertIs(raised.exception, original)
		self.assertEqual(
			self.db.rollback.call_args_list, [call(save_point=self.db.savepoint.call_args.args[0]), call()]
		)

	def test_other_cleanup_failures_are_not_hidden_or_rolled_back_twice(self):
		self.db.rollback.side_effect = DatabaseOperationalError(2006, "Connection lost")
		with self.assertRaises(DatabaseOperationalError):
			restaurant._atomic_write(lambda: failure("Rejected"))()
		self.db.rollback.assert_called_once()

	def test_savepoint_cleanup_keeps_normal_savepoint_behavior(self):
		rollback_savepoint("original-savepoint")
		self.db.rollback.assert_called_once_with(save_point="original-savepoint")

	def test_restaurant_gateway_request_retries_with_the_original_visit(self):
		visits = []

		@gateway._restaurant_payment_write
		def command(restaurant_session=None):
			visits.append(restaurant_session)
			try:
				if len(visits) == 1:
					raise frappe.QueryDeadlockError(1020, "Snapshot changed")
				return success("queued")
			except Exception as exc:
				return gateway._failure_from_exception(exc)

		self.assertTrue(command("original-visit")["ok"])
		self.assertEqual(visits, ["original-visit", "original-visit"])
		self.db.rollback.assert_called_once_with()

	def test_retail_gateway_request_is_not_automatically_replayed(self):
		visits = []

		@gateway._restaurant_payment_write
		def command(restaurant_session=None):
			visits.append(restaurant_session)
			return gateway._failure_from_exception(frappe.QueryDeadlockError(1020, "Snapshot changed"))

		self.assertFalse(command()["ok"])
		self.assertEqual(visits, [None])
		self.db.rollback.assert_not_called()
