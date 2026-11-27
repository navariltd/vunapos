import base64
import copy
import hashlib
import json
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

import frappe
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding

from vunapos.services import qz_signing as signing
from vunapos.setup.qz_signing import generate_certificate


class TestQZSigning(TestCase):
	def setUp(self):
		self.temp = tempfile.TemporaryDirectory()
		self.addCleanup(self.temp.cleanup)
		self.directory = Path(self.temp.name) / "qz-signing"
		patch("frappe.get_site_path", return_value=str(self.directory)).start()
		patch("frappe.only_for").start()
		patch("frappe.local", SimpleNamespace(site="demo.localhost")).start()
		patch("frappe.session", SimpleNamespace(user="chef@example.com")).start()
		self.conf = {"vunapos_qz_signing_enabled": 1}
		patch("frappe.conf", self.conf).start()
		patch("frappe.utils.get_url", return_value="https://cafe.example.com").start()
		patch(
			"frappe.throw",
			side_effect=lambda message, exc=frappe.ValidationError: (_ for _ in ()).throw(exc(message)),
		).start()
		patch("vunapos.setup.qz_signing._", side_effect=lambda value: value).start()
		patch("vunapos.services.qz_signing._", side_effect=lambda value: value).start()
		self.access = patch(
			"vunapos.services.kitchen_printing.configuration",
			return_value={
				"can_print": True,
				"stations": [{"printer_name": "epos", "output_mode": "Both"}],
			},
		).start()
		self.addCleanup(patch.stopall)
		generate_certificate("Demo Printing", "Demo")

	def payload(self):
		return {
			"call": "print",
			"timestamp": int(time.time() * 1000),
			"params": {
				"printer": {"name": "epos"},
				"options": {"copies": 1},
				"data": [
					{
						"type": "pixel",
						"format": "html",
						"flavor": "plain",
						"data": '<html><head><meta charset="UTF-8"><link href="/assets/print.css"></head><body><p>Tea</p></body></html>',
					}
				],
			},
		}

	def test_signature_matches_qz_sha256_digest_and_sha512_rsa(self):
		message = json.dumps(self.payload(), separators=(",", ":"))
		signature = signing.sign(message, "Till 1")
		certificate = x509.load_pem_x509_certificate(
			(self.directory / "digital-certificate.txt").read_bytes()
		)
		certificate.public_key().verify(
			base64.b64decode(signature),
			hashlib.sha256(message.encode()).hexdigest().encode(),
			padding.PKCS1v15(),
			hashes.SHA512(),
		)
		self.assertNotIn("PRIVATE KEY", str(signing.certificate("Till 1")))

	def test_discovery_is_supported_but_arbitrary_operations_and_printers_are_rejected(self):
		payload = self.payload()
		payload.update(call="printers.find", params={"query": None})
		self.assertTrue(signing.sign(json.dumps(payload), "Till 1"))
		for call in ("file.write", "usb.sendData", "socket.sendData", "networking.devices"):
			payload["call"] = call
			with self.assertRaises(frappe.PermissionError):
				signing.sign(json.dumps(payload), "Till 1")
		payload = self.payload()
		payload["params"]["printer"] = {"name": "Other customer's printer"}
		with self.assertRaises(frappe.PermissionError):
			signing.sign(json.dumps(payload), "Till 1")

	def test_rejects_dangerous_print_payloads(self):
		for change in (
			lambda p: p["params"].update(printer={"file": "/tmp/output"}),
			lambda p: p["params"]["options"].update(forceRaw=True),
			lambda p: p["params"]["options"].update(copies=2),
			lambda p: p["params"]["data"][0].update(type="raw"),
			lambda p: p["params"]["data"][0].update(flavor="file"),
			lambda p: p["params"]["data"][0].update(data="<script>alert(1)</script>"),
			lambda p: p["params"]["data"][0].update(data='<img src="file:///etc/passwd">'),
			lambda p: p["params"]["data"][0].update(data='<img src="http://192.168.1.1/">'),
			lambda p: p["params"]["data"][0].update(data='<p onclick="run()">Tea</p>'),
			lambda p: p["params"]["data"][0].update(data='<style>@import "http://evil/";</style>'),
			lambda p: p.update(timestamp=0),
		):
			payload = copy.deepcopy(self.payload())
			change(payload)
			with self.assertRaises((frappe.ValidationError, frappe.PermissionError)):
				signing.sign(json.dumps(payload), "Till 1")
		with self.assertRaises(frappe.ValidationError):
			signing.sign("arbitrary digest", "Till 1")

	def test_permissions_disabled_signing_and_missing_site_files_fail_closed(self):
		self.conf["vunapos_qz_signing_enabled"] = 0
		self.assertEqual(signing.certificate("Till 1"), {"enabled": False, "certificate": None})
		with self.assertRaises(frappe.ValidationError):
			signing.sign(json.dumps(self.payload()), "Till 1")
		self.conf["vunapos_qz_signing_enabled"] = 1
		self.access.return_value["can_print"] = False
		with self.assertRaises(frappe.PermissionError):
			signing.sign(json.dumps(self.payload()), "Till 1")
		self.access.return_value["can_print"] = True
		with patch("frappe.get_site_path", return_value=str(self.directory / "another-site")):
			with self.assertRaises(frappe.ValidationError):
				signing.sign(json.dumps(self.payload()), "Till 1")
		(self.directory / "private-key.pem").chmod(0o644)
		with self.assertRaises(frappe.ValidationError):
			signing.sign(json.dumps(self.payload()), "Till 1")
