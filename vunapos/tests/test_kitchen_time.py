import unittest
from datetime import UTC, datetime, timezone
from unittest.mock import patch

from vunapos.services.kitchen_service import ticket_time


class TestKitchenTime(unittest.TestCase):
	def test_site_wall_time_has_explicit_offset(self):
		with patch("frappe.utils.get_system_timezone", return_value="Asia/Kolkata"):
			value = ticket_time("2026-11-21 03:26:00")
		self.assertEqual(value, "2026-11-21T03:26:00+05:30")
		from zoneinfo import ZoneInfo

		self.assertEqual(
			datetime.fromisoformat(value).astimezone(ZoneInfo("Africa/Nairobi")).strftime("%H:%M"), "00:56"
		)

	def test_aware_instant_is_not_shifted_twice(self):
		value = datetime(2026, 11, 20, 21, 56, tzinfo=UTC)
		self.assertEqual(datetime.fromisoformat(ticket_time(value)), value)
