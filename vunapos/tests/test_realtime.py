from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.realtime import (
	CHECKOUT_QUEUE_EVENT,
	CONFIGURATION_EVENT,
	publish_checkout_queue_change,
	publish_configuration_change,
)


class TestConfigurationRealtime(IntegrationTestCase):
	def test_publishes_only_configuration_metadata_after_commit(self):
		doc = frappe._dict(doctype="POS Profile", name="Counter 1")

		with (
			patch(
				"vunapos.realtime.frappe.get_all",
				side_effect=[["Counter 1"], ["cashier@example.com", "cashier@example.com"]],
			),
			patch("frappe.publish_realtime") as publish_realtime,
		):
			publish_configuration_change(doc, "on_update")

		publish_realtime.assert_called_once_with(
			CONFIGURATION_EVENT,
			{
				"doctype": "POS Profile",
				"action": "on_update",
				"refresh": "full",
			},
			user="cashier@example.com",
			after_commit=True,
		)

	def test_skips_publication_when_no_enabled_profile_exists(self):
		with (
			patch("vunapos.realtime.frappe.get_all", return_value=[]),
			patch("frappe.publish_realtime") as publish_realtime,
		):
			publish_configuration_change(frappe._dict(doctype="Pricing Rule"), "on_update")

		publish_realtime.assert_not_called()


class TestCheckoutQueueRealtime(IntegrationTestCase):
	def test_publishes_queue_state_only_to_the_owning_cashier(self):
		doc = frappe._dict(
			doctype="Sales Invoice",
			name="ACC-SINV-QUEUE-0001",
			pos_profile="Counter 1",
			vunapos_opening_entry="POS-OPE-0001",
			vunapos_session_cashier="cashier@example.com",
			vunapos_queue_status="Failed",
			vunapos_queue_attempts=2,
			vunapos_queue_error="Insufficient stock",
		)

		with patch("frappe.publish_realtime") as publish_realtime:
			publish_checkout_queue_change(doc)

		publish_realtime.assert_called_once_with(
			CHECKOUT_QUEUE_EVENT,
			{
				"invoice_doctype": "Sales Invoice",
				"invoice_name": "ACC-SINV-QUEUE-0001",
				"pos_profile": "Counter 1",
				"opening_entry": "POS-OPE-0001",
				"status": "Failed",
				"attempts": 2,
				"error": "Insufficient stock",
			},
			user="cashier@example.com",
			after_commit=True,
		)

	def test_skips_queue_event_without_an_owning_cashier(self):
		with patch("frappe.publish_realtime") as publish_realtime:
			publish_checkout_queue_change(frappe._dict(doctype="Sales Invoice", name="SINV-1"))

		publish_realtime.assert_not_called()
