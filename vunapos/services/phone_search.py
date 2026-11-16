"""Find customers by a phone number typed in any common format.

0790 001 011, 790001011, +254790001011 and +254-790001011 all reduce to the same
national digits (790001011), which appear in the saved number whatever its format.
"""

import re

import frappe
from frappe.geo.country_info import get_country_info

PHONE_QUERY = re.compile(r"[\d\s+\-().]+")


def country_isd(country):
	"""Dialling code digits for a country, e.g. "254" for Kenya."""
	return ((get_country_info(country) or {}).get("isd") or "").lstrip("+") if country else ""


def profile_isd(profile=None):
	country = (
		frappe.get_cached_value("Company", profile.company, "country")
		if profile and profile.get("company")
		else frappe.db.get_default("country")
	)
	return country_isd(country)


def national_digits(value, isd=""):
	"""A phone number's digits without its trunk 0 or this country's dialling code.

	Returns None for text that isn't a phone number, so name searches are unaffected.
	"""
	value = (value or "").strip()
	if not PHONE_QUERY.fullmatch(value):
		return None
	digits = re.sub(r"\D", "", value)
	international = value.startswith("+") or digits.startswith("00")
	if digits.startswith("00"):
		digits = digits[2:]
	# Without a + the dialling code only counts when a full number follows it.
	if isd and digits.startswith(isd) and (international or len(digits) > len(isd) + 6):
		digits = digits[len(isd) :]
		international = False
	if not international and digits.startswith("0"):
		digits = digits[1:]
	return digits if len(digits) >= 3 else None
