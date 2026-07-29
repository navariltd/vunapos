from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.realtime import CONFIGURATION_EVENT, publish_configuration_change


class TestConfigurationRealtime(IntegrationTestCase):
	def test_publishes_only_configuration_metadata_after_commit(self):
		doc = frappe._dict(doctype="POS Profile", name="Counter 1")

		with patch("frappe.publish_realtime") as publish_realtime:
			publish_configuration_change(doc, "on_update")

		publish_realtime.assert_called_once_with(
			CONFIGURATION_EVENT,
			{
				"doctype": "POS Profile",
				"action": "on_update",
				"refresh": "full",
			},
			after_commit=True,
		)
