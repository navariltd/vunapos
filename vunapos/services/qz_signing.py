"""Site-scoped signing for permitted kitchen printer operations, not a general signing oracle."""

import base64
import hashlib
import json
import math
import re
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

import frappe
from bs4 import BeautifulSoup
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from frappe import _


def _access(pos_profile):
	from vunapos.services.kitchen_printing import configuration

	if frappe.session.user == "Guest":
		frappe.throw(_("Sign in to use kitchen printing."), frappe.PermissionError)
	config = configuration(pos_profile)
	if not config["can_print"]:
		frappe.throw(_("You are not allowed to use kitchen printing."), frappe.PermissionError)
	return config


def _identity(private=False):
	try:
		directory = Path(frappe.get_site_path("private", "qz-signing"))
		cert_path = directory / "digital-certificate.txt"
		if directory.is_symlink() or cert_path.is_symlink():
			raise ValueError
		certificate = x509.load_pem_x509_certificate(cert_path.read_bytes())
		now = datetime.now(UTC)
		if not certificate.not_valid_before_utc <= now < certificate.not_valid_after_utc:
			raise ValueError
		key = None
		if private:
			key_path = directory / "private-key.pem"
			if key_path.is_symlink() or key_path.stat().st_mode & 0o077 or directory.stat().st_mode & 0o077:
				raise ValueError
			key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
			if not isinstance(key, rsa.RSAPrivateKey) or key.key_size < 2048:
				raise ValueError
			if key.public_key().public_numbers() != certificate.public_key().public_numbers():
				raise ValueError
		return certificate, key
	except (OSError, ValueError, TypeError, AttributeError):
		frappe.throw(
			_("QZ signing files are missing, expired or invalid. Ask your administrator to check them.")
		)


def certificate(pos_profile):
	_access(pos_profile)
	if not frappe.conf.get("vunapos_qz_signing_enabled"):
		return {"enabled": False, "certificate": None}
	cert, _key = _identity()
	return {"enabled": True, "certificate": cert.public_bytes(serialization.Encoding.PEM).decode()}


def _validate_html(html):
	if not isinstance(html, str) or not html.strip():
		frappe.throw(_("Only HTML kitchen slips can be signed."))
	doc = BeautifulSoup(html, "html.parser")
	if doc.find(["script", "iframe", "object", "embed", "base", "meta"]):
		# Charset and viewport metadata are harmless; reject only active/meta refresh below.
		if doc.find(["script", "iframe", "object", "embed", "base"]) or doc.find(
			"meta", attrs={"http-equiv": True}
		):
			frappe.throw(_("The kitchen slip contains unsupported active content."))
	host = urlparse(frappe.utils.get_url()).netloc.lower()
	for element in doc.find_all(True):
		for name, value in element.attrs.items():
			if name.lower().startswith("on"):
				frappe.throw(_("The kitchen slip contains unsupported active content."))
			if name.lower() in ("src", "href", "action", "srcset"):
				_validate_resource(str(value), host)
	for style in [tag.get_text() for tag in doc.find_all("style")] + [
		str(tag.get("style")) for tag in doc.find_all(style=True)
	]:
		if re.search(r"@import|expression\s*\(|-moz-binding|behavior\s*:", style, re.I):
			frappe.throw(_("The kitchen slip contains unsupported styling."))
		for resource in re.findall(r"url\s*\(\s*['\"]?([^)'\"]+)", style, re.I):
			_validate_resource(resource.strip(), host)


def _validate_resource(value, host):
	if value.startswith("data:image/") and not value.startswith("data:image/svg"):
		return
	url = urlparse(value.strip())
	if url.scheme not in ("", "http", "https") or (url.netloc and url.netloc.lower() != host):
		frappe.throw(_("Kitchen slips may only load resources from this POS site."))


def sign(message, pos_profile):
	config = _access(pos_profile)
	if not frappe.conf.get("vunapos_qz_signing_enabled"):
		frappe.throw(_("QZ signing is not enabled for this site."))
	if not isinstance(message, str) or len(message.encode()) > 2_000_000:
		frappe.throw(_("Invalid QZ signing request."))
	try:
		payload = json.loads(message)
	except (TypeError, ValueError):
		frappe.throw(_("Invalid QZ signing request."))
	if not isinstance(payload, dict) or set(payload) != {"call", "params", "timestamp"}:
		frappe.throw(_("Invalid QZ signing request."))
	timestamp = payload["timestamp"]
	if (
		isinstance(timestamp, bool)
		or not isinstance(timestamp, (int, float))
		or not math.isfinite(timestamp)
		or abs(timestamp - time.time() * 1000) > 120_000
	):
		frappe.throw(_("The printing request expired. Check the terminal clock and try again."))
	params = payload["params"]
	if not isinstance(params, dict):
		frappe.throw(_("Invalid QZ signing request."))
	if payload["call"] == "printers.find":
		if set(params) - {"query"} or (
			params.get("query") is not None and not isinstance(params["query"], str)
		):
			frappe.throw(_("Invalid printer discovery request."))
	elif payload["call"] == "print":
		allowed = {
			row["printer_name"] for row in config["stations"] if row["output_mode"] in ("Printer", "Both")
		}
		printer, options, data = params.get("printer"), params.get("options"), params.get("data")
		if (
			set(params) != {"printer", "options", "data"}
			or not isinstance(printer, dict)
			or set(printer) != {"name"}
			or printer["name"] not in allowed
		):
			frappe.throw(
				_("This printer is not assigned to a permitted kitchen station."), frappe.PermissionError
			)
		if (
			not isinstance(options, dict)
			or options.get("copies", 1) != 1
			or options.get("forceRaw")
			or not isinstance(data, list)
			or len(data) != 1
		):
			frappe.throw(_("Only single-copy HTML kitchen printing is supported."))
		item = data[0]
		if (
			not isinstance(item, dict)
			or set(item) - {"type", "format", "flavor", "data", "options"}
			or (item.get("type"), item.get("format"), item.get("flavor")) != ("pixel", "html", "plain")
		):
			frappe.throw(_("Only HTML kitchen slips can be signed."))
		_validate_html(item.get("data"))
	else:
		frappe.throw(_("This QZ operation is not allowed."), frappe.PermissionError)
	_cert, key = _identity(private=True)
	# qz-tray 2.2.x requests a signature of the SHA-256 hex digest, not raw JSON.
	digest = hashlib.sha256(message.encode()).hexdigest().encode()
	return base64.b64encode(key.sign(digest, padding.PKCS1v15(), hashes.SHA512())).decode()
