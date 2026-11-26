import math

import frappe
from frappe import _
from frappe.utils import cint, flt

TONES = {"Chime": "chime", "Bell": "bell", "Double beep": "double-beep", "Soft ding": "soft-ding"}
ALERTS = (("new_kot", "newKot", "New KOT", "Chime"), ("ready", "ready", "Food Ready", "Bell"))


def sound_custom_fields(profile=False):
	section = "vunapos_restaurant_sounds_section"
	fields = [
		{
			"fieldname": section,
			"label": "Restaurant Sound Alerts",
			"fieldtype": "Section Break",
			"insert_after": "vunapos_cancellation_charge_item"
			if profile
			else "vunapos_salesperson_pin_session_minutes",
		}
	]
	previous = section
	if profile:
		fields[0]["depends_on"] = "eval:doc.vunapos_pos_mode=='Restaurant'"
		previous = "vunapos_override_restaurant_sounds"
		fields.append(
			{
				"fieldname": previous,
				"label": "Override Sound Defaults",
				"fieldtype": "Check",
				"default": "0",
				"insert_after": section,
				"description": "Leave off to use the sound alerts configured in POS Settings.",
			}
		)
	for prefix, _key, label, tone in ALERTS:
		if prefix == "ready":
			fieldname = "vunapos_restaurant_sounds_column"
			fields.append({"fieldname": fieldname, "fieldtype": "Column Break", "insert_after": previous})
			previous = fieldname
		for suffix, title, fieldtype, default in (
			("enabled", f"Enable {label} Sound", "Check", "1"),
			("tone", f"{label} Tone", "Select", tone),
			("volume", f"{label} Volume", "Percent", "70"),
		):
			fieldname = f"vunapos_{prefix}_sound_{suffix}"
			field = {
				"fieldname": fieldname,
				"label": title,
				"fieldtype": fieldtype,
				"default": default,
				"insert_after": previous,
			}
			if fieldtype == "Select":
				field["options"] = "\n".join(TONES)
			if profile:
				field["depends_on"] = (
					"eval:doc.vunapos_pos_mode=='Restaurant' && doc.vunapos_override_restaurant_sounds"
				)
			fields.append(field)
			previous = fieldname
	return fields


def ensure_sound_defaults():
	values = frappe.db.get_singles_dict("POS Settings")
	for field in sound_custom_fields():
		if "default" in field and values.get(field["fieldname"]) in (None, ""):
			frappe.db.set_single_value("POS Settings", field["fieldname"], field["default"])


def get_sound_settings(profile):
	values = (
		profile
		if cint(profile.get("vunapos_override_restaurant_sounds"))
		else frappe.db.get_singles_dict("POS Settings")
	)
	result = {}
	for prefix, key, _label, tone in ALERTS:
		enabled = values.get(f"vunapos_{prefix}_sound_enabled")
		volume = values.get(f"vunapos_{prefix}_sound_volume")
		result[key] = {
			"enabled": True if enabled in (None, "") else bool(cint(enabled)),
			"tone": TONES.get(values.get(f"vunapos_{prefix}_sound_tone"), TONES[tone]),
			"volume": 70 if volume in (None, "") else max(0, min(100, flt(volume))),
		}
	return result


def validate_sound_settings(doc, method=None):
	if doc.doctype == "POS Profile" and not cint(doc.get("vunapos_override_restaurant_sounds")):
		return
	for prefix, _key, label, _tone in ALERTS:
		tone = doc.get(f"vunapos_{prefix}_sound_tone")
		if tone and tone not in TONES:
			frappe.throw(_("Choose a valid tone for {0} sound.").format(_(label)))
		volume = doc.get(f"vunapos_{prefix}_sound_volume")
		if volume not in (None, ""):
			try:
				valid = math.isfinite(float(volume)) and 0 <= float(volume) <= 100
			except (TypeError, ValueError):
				valid = False
			if not valid:
				frappe.throw(_("{0} sound volume must be between 0 and 100.").format(_(label)))
