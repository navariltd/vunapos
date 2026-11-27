"""Operator-only certificate generation; deliberately not a whitelisted API."""

import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import frappe
from frappe import _


def generate_certificate(common_name: str, organization: str, validity_days: int = 365) -> dict:
	"""Create a site's directly trusted QZ signing identity without overwriting keys."""
	frappe.only_for("System Manager")
	if not isinstance(common_name, str) or not common_name.strip() or len(common_name) > 128:
		frappe.throw(_("Enter a certificate name of at most 128 characters."))
	if not isinstance(organization, str) or not organization.strip() or len(organization) > 128:
		frappe.throw(_("Enter an organization name of at most 128 characters."))
	try:
		days = int(validity_days)
	except (TypeError, ValueError):
		frappe.throw(_("Certificate validity must be a whole number of days."))
	if str(days) != str(validity_days) or not 1 <= days <= 825:
		frappe.throw(_("Certificate validity must be between 1 and 825 whole days."))
	directory = Path(frappe.get_site_path("private", "qz-signing"))
	if directory.exists() or directory.is_symlink():
		frappe.throw(_("QZ signing files already exist. Review them before generating another identity."))

	from cryptography import x509
	from cryptography.hazmat.primitives import hashes, serialization
	from cryptography.hazmat.primitives.asymmetric import rsa
	from cryptography.x509.oid import NameOID

	key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
	name = x509.Name(
		[
			x509.NameAttribute(NameOID.ORGANIZATION_NAME, organization.strip()),
			x509.NameAttribute(NameOID.COMMON_NAME, common_name.strip()),
		]
	)
	now = datetime.now(UTC)
	certificate = (
		x509.CertificateBuilder()
		.subject_name(name)
		.issuer_name(name)
		.public_key(key.public_key())
		.serial_number(x509.random_serial_number())
		.not_valid_before(now - timedelta(minutes=5))
		.not_valid_after(now + timedelta(days=days))
		.add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
		.add_extension(
			x509.KeyUsage(
				digital_signature=True,
				content_commitment=False,
				key_encipherment=False,
				data_encipherment=False,
				key_agreement=False,
				key_cert_sign=True,
				crl_sign=True,
				encipher_only=False,
				decipher_only=False,
			),
			critical=True,
		)
		.add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
		.add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(key.public_key()), critical=False)
		.sign(key, hashes.SHA256())
	)
	key_bytes = key.private_bytes(
		serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
	)
	certificate_bytes = certificate.public_bytes(serialization.Encoding.PEM)
	# mkdir is exclusive: a concurrent invocation cannot replace this site's identity.
	try:
		directory.mkdir(mode=0o700)
	except FileExistsError:
		frappe.throw(_("QZ signing files already exist. Review them before generating another identity."))
	for filename, payload, mode in (
		("private-key.pem", key_bytes, 0o600),
		("digital-certificate.txt", certificate_bytes, 0o644),
		("override.crt", certificate_bytes, 0o644),
	):
		with os.fdopen(
			os.open(directory / filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode), "wb"
		) as file:
			file.write(payload)
	# Only public metadata and paths may be returned or printed by bench execute.
	return {
		"site": frappe.local.site,
		"directory": str(directory.resolve()),
		"certificate": "digital-certificate.txt",
		"terminal_trust_file": "override.crt",
		"fingerprint_sha256": certificate.fingerprint(hashes.SHA256()).hex(),
		"valid_until": certificate.not_valid_after_utc.isoformat(),
		"signing_integration_enabled": False,
	}
