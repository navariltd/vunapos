from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.services.restaurant_sound_settings import (
	ensure_sound_defaults,
	get_sound_settings,
	sound_custom_fields,
	validate_sound_settings,
)


class TestRestaurantSoundSettings(IntegrationTestCase):
	def test_saved_global_settings_reach_the_profile_bootstrap(self):
		from vunapos.dto.profile import profile_to_dict
		from vunapos.tests.helpers import ensure_test_pos_profile

		settings = frappe.get_doc("POS Settings")
		settings.vunapos_new_kot_sound_enabled = 0
		settings.vunapos_ready_sound_enabled = 1
		settings.vunapos_ready_sound_tone = "Double beep"
		settings.vunapos_ready_sound_volume = 0
		settings.save(ignore_permissions=True)
		profile = frappe.get_doc("POS Profile", ensure_test_pos_profile())
		profile.vunapos_pos_mode = "Restaurant"
		profile.vunapos_override_restaurant_sounds = 0
		settings = profile_to_dict(profile, "Sales Invoice")["restaurant"]["sound_settings"]
		self.assertFalse(settings["newKot"]["enabled"])
		self.assertEqual(settings["ready"], {"enabled": True, "tone": "double-beep", "volume": 0})
		profile.vunapos_override_restaurant_sounds = 1
		profile.vunapos_new_kot_sound_enabled = 1
		profile.vunapos_ready_sound_volume = 30
		profile.vunapos_ready_sound_tone = "Soft ding"
		settings = profile_to_dict(profile, "Sales Invoice")["restaurant"]["sound_settings"]
		self.assertTrue(settings["newKot"]["enabled"])
		self.assertEqual(settings["ready"]["volume"], 30)
		self.assertEqual(settings["ready"]["tone"], "soft-ding")

	def test_defaults_and_global_inheritance(self):
		with patch("frappe.db.get_singles_dict", return_value={}):
			settings = get_sound_settings(frappe._dict())
		self.assertEqual(
			settings,
			{
				"newKot": {"enabled": True, "tone": "chime", "volume": 70},
				"ready": {"enabled": True, "tone": "bell", "volume": 70},
			},
		)
		with patch(
			"frappe.db.get_singles_dict",
			return_value={
				"vunapos_new_kot_sound_enabled": "0",
				"vunapos_new_kot_sound_volume": "0",
				"vunapos_ready_sound_tone": "Double beep",
				"vunapos_ready_sound_volume": "45",
			},
		):
			settings = get_sound_settings(frappe._dict(vunapos_ready_sound_tone="Soft ding"))
		self.assertFalse(settings["newKot"]["enabled"])
		self.assertEqual(settings["newKot"]["volume"], 0)
		self.assertEqual(settings["ready"], {"enabled": True, "tone": "double-beep", "volume": 45})

	def test_profile_override_is_independent_of_global_settings(self):
		with patch("frappe.db.get_singles_dict") as global_settings:
			settings = get_sound_settings(
				frappe._dict(
					vunapos_override_restaurant_sounds=1,
					vunapos_new_kot_sound_enabled=0,
					vunapos_new_kot_sound_volume=0,
					vunapos_ready_sound_tone="Soft ding",
					vunapos_ready_sound_volume=25,
				)
			)
		global_settings.assert_not_called()
		self.assertEqual(settings["newKot"], {"enabled": False, "tone": "chime", "volume": 0})
		self.assertEqual(settings["ready"], {"enabled": True, "tone": "soft-ding", "volume": 25})

	def test_setup_does_not_reset_explicit_disables_or_zero_volume(self):
		values = {"vunapos_new_kot_sound_enabled": "0", "vunapos_ready_sound_volume": "0"}
		with (
			patch("frappe.db.get_singles_dict", return_value=values),
			patch("frappe.db.set_single_value") as write,
		):
			ensure_sound_defaults()
		fields = {call.args[1] for call in write.call_args_list}
		self.assertNotIn("vunapos_new_kot_sound_enabled", fields)
		self.assertNotIn("vunapos_ready_sound_volume", fields)
		self.assertIn("vunapos_ready_sound_tone", fields)

	def test_invalid_configuration_is_rejected(self):
		for value in (-1, 101, "invalid", float("nan")):
			with self.assertRaises(frappe.ValidationError):
				validate_sound_settings(
					frappe._dict(doctype="POS Settings", vunapos_ready_sound_volume=value)
				)
		with self.assertRaises(frappe.ValidationError):
			validate_sound_settings(frappe._dict(doctype="POS Settings", vunapos_ready_sound_tone="unknown"))
		validate_sound_settings(frappe._dict(doctype="POS Settings", vunapos_ready_sound_volume=0))
		validate_sound_settings(
			frappe._dict(
				doctype="POS Profile", vunapos_override_restaurant_sounds=0, vunapos_ready_sound_volume=-1
			)
		)

	def test_exported_custom_fields_match_setup_order_and_defaults(self):
		for doctype, profile in (("POS Settings", False), ("POS Profile", True)):
			meta = frappe.get_meta(doctype)
			for field in sound_custom_fields(profile):
				actual = meta.get_field(field["fieldname"])
				self.assertIsNotNone(actual, field["fieldname"])
				self.assertEqual(actual.insert_after, field["insert_after"])
				if "default" in field:
					self.assertEqual(str(actual.default), field["default"])
