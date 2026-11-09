import json
from pathlib import Path
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.boot import add_setup_app_entry
from vunapos.hooks import add_to_apps_screen


class TestVunaPOSDesktopNavigation(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")

	def test_apps_screen_keeps_terminal_and_setup_as_separate_entries(self):
		entries = {entry["title"]: entry for entry in add_to_apps_screen}
		self.assertEqual(entries["VunaPOS"]["route"], "/vunapos")
		self.assertEqual(entries["VunaPOS Setup"]["route"], "/desk/vunapos/pos-profile")
		self.assertNotEqual(entries["VunaPOS"]["name"], entries["VunaPOS Setup"]["name"])
		for entry in entries.values():
			self.assertEqual(entry["has_permission"], "vunapos.permissions.has_app_permission")

	def test_frappe_apps_response_includes_both_destinations(self):
		from frappe.apps import get_apps

		entries = {entry["title"]: entry for entry in get_apps() if entry["name"] == "vunapos"}
		self.assertEqual(entries["VunaPOS"]["route"], "/vunapos")
		self.assertEqual(entries["VunaPOS Setup"]["route"], "/desk/vunapos/pos-profile")

	def test_desktop_grid_fixture_opens_the_existing_sidebar(self):
		root = Path(__file__).resolve().parents[1]
		icon = json.loads((root / "desktop_icon" / "vunapos_setup.json").read_text())
		sidebar = json.loads((root / "vunapos" / "sidebar" / "vunapos" / "vunapos.json").read_text())
		self.assertEqual(icon["label"], "VunaPOS Setup")
		self.assertEqual(icon["link"], "/desk/vunapos/pos-profile")
		self.assertEqual(icon["link_type"], "External")
		self.assertEqual(sidebar["name"], "VunaPOS")
		self.assertTrue(any(row.get("link_to") == "POS Profile" for row in sidebar["items"]))
		# Restaurant navigation can live in its own sidebar; this launcher opens POS setup.
		self.assertTrue(any(row.get("link_to") == "POS Settings" for row in sidebar["items"]))

	def test_desk_boot_payload_includes_setup_without_changing_terminal_route(self):
		from frappe.boot import get_app_data

		boot = frappe._dict(app_data=get_app_data())
		add_setup_app_entry(boot)
		add_setup_app_entry(boot)
		setup = [row for row in boot.app_data if row.get("app_name") == "vunapos_setup"]
		self.assertEqual(len(setup), 1)
		self.assertEqual(setup[0]["app_title"], "VunaPOS Setup")
		self.assertEqual(setup[0]["app_route"], "/desk/vunapos/pos-profile")
		terminal = next(row for row in boot.app_data if row.get("app_name") == "vunapos")
		self.assertEqual(terminal["app_route"], "/vunapos")

	def test_setup_boot_entry_respects_app_permissions(self):
		boot = frappe._dict(app_data=[{"app_name": "vunapos", "on_apps_screen": True}])
		with patch("vunapos.permissions.has_app_permission", return_value=False):
			add_setup_app_entry(boot)
		self.assertEqual(len(boot.app_data), 1)

	def test_setup_is_not_added_if_app_is_hidden(self):
		boot = frappe._dict(app_data=[{"app_name": "vunapos", "on_apps_screen": False}])
		add_setup_app_entry(boot)
		self.assertEqual(len(boot.app_data), 1)

	def test_setup_opens_a_real_list_in_the_vunapos_shell_not_a_removed_workspace(self):
		from frappe.boot import get_module_sidebars

		sidebar = get_module_sidebars()["VunaPOS"]
		self.assertTrue(any(row.get("link_to") == "POS Profile" for row in sidebar["items"]))
		self.assertFalse(frappe.get_meta("POS Profile").issingle)
		setup = next(row for row in add_to_apps_screen if row["name"] == "vunapos_setup")
		self.assertEqual(setup["route"].strip("/").split("/"), ["desk", "vunapos", "pos-profile"])

	def test_legacy_launcher_migration_does_not_redirect_setup_icon(self):
		from vunapos.patches.v1_0.remove_vunapos_workspace import execute

		with (
			patch("frappe.get_all", return_value=["VunaPOS"]) as get_all,
			patch("frappe.db.exists", return_value=False),
			patch("frappe.db.set_value") as set_value,
			patch("frappe.cache.delete_key"),
		):
			execute()
			self.assertEqual(get_all.call_args.kwargs["filters"]["label"], ["!=", "VunaPOS Setup"])
			set_value.assert_called_once_with(
				"Desktop Icon",
				"VunaPOS",
				{"link": "/vunapos", "link_type": "External"},
				update_modified=False,
			)
