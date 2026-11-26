from pathlib import Path
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.www.vunapos import get_context


class TestPOSPageContext(IntegrationTestCase):
	def test_socket_namespace_uses_the_actual_site_even_when_accessed_through_localhost(self):
		context = frappe._dict()
		get_context(context)
		self.assertEqual(context.vunapos_site_name, frappe.local.site)
		self.assertNotEqual(context.vunapos_site_name, "localhost")
		root = Path(__file__).resolve().parents[2]
		template = (root / "vunapos_spa" / "index.html").read_text()
		site_script = next(line for line in template.splitlines() if "window.frappe_site_name" in line)
		with patch("frappe.local.request", frappe._dict(host="localhost:8000"), create=True):
			rendered = frappe.render_template(site_script, context)
		self.assertIn(f'window.frappe_site_name = "{frappe.local.site}";', rendered)
		self.assertNotIn("no such element", rendered)
		self.assertNotIn("frappe.local.site", template)
