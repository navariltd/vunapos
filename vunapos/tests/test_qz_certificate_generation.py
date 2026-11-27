import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

import frappe
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from vunapos.setup.qz_signing import generate_certificate


class TestQZCertificateGeneration(TestCase):
	def setUp(self):
		self.folder = tempfile.TemporaryDirectory()
		self.addCleanup(self.folder.cleanup)
		self.private = Path(self.folder.name)
		patch("frappe.get_site_path", return_value=str(self.private / "qz-signing")).start()
		self.permission = patch("frappe.only_for").start()
		patch("vunapos.setup.qz_signing.frappe.local", SimpleNamespace(site="demo.localhost")).start()
		patch("vunapos.setup.qz_signing._", side_effect=lambda value: value).start()
		patch("frappe.throw", side_effect=frappe.ValidationError).start()
		self.addCleanup(patch.stopall)

	def test_generates_restricted_per_site_identity_and_verifies_signatures(self):
		result = generate_certificate("Demo Kitchen Printing", "Demo Cafe")
		directory = self.private / "qz-signing"
		key = serialization.load_pem_private_key((directory / "private-key.pem").read_bytes(), password=None)
		certificate = x509.load_pem_x509_certificate((directory / "digital-certificate.txt").read_bytes())
		message = b"QZ certificate generation verification"
		signature = key.sign(message, padding.PKCS1v15(), hashes.SHA512())
		certificate.public_key().verify(signature, message, padding.PKCS1v15(), hashes.SHA512())
		self.assertEqual(key.key_size, 2048)
		self.assertEqual(
			(directory / "override.crt").read_bytes(), certificate.public_bytes(serialization.Encoding.PEM)
		)
		self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
		self.assertEqual((directory / "private-key.pem").stat().st_mode & 0o777, 0o600)
		self.assertNotIn("PRIVATE KEY", str(result))
		self.assertFalse(result["signing_integration_enabled"])
		self.permission.assert_called_once_with("System Manager")

	def test_never_replaces_an_existing_identity(self):
		generate_certificate("First", "Cafe")
		key = (self.private / "qz-signing/private-key.pem").read_bytes()
		with self.assertRaises(frappe.ValidationError):
			generate_certificate("Replacement", "Cafe")
		self.assertEqual((self.private / "qz-signing/private-key.pem").read_bytes(), key)

	def test_rejects_invalid_inputs_before_writing(self):
		for name, organization, days in (
			("", "Cafe", 365),
			("Demo", "", 365),
			("Demo", "Cafe", 0),
			("Demo", "Cafe", 365.5),
		):
			with self.subTest(name=name, organization=organization, days=days):
				with self.assertRaises(frappe.ValidationError):
					generate_certificate(name, organization, days)
		self.assertFalse((self.private / "qz-signing").exists())

	def test_unauthorized_operator_cannot_generate_files(self):
		self.permission.side_effect = frappe.PermissionError
		with self.assertRaises(frappe.PermissionError):
			generate_certificate("Demo", "Cafe")
		self.assertFalse((self.private / "qz-signing").exists())
