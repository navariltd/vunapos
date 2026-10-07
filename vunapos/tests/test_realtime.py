from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from vunapos.realtime import (
	CHECKOUT_QUEUE_EVENT,
	CONFIGURATION_EVENT,
	GATEWAY_PAYMENT_EVENT,
	capture_pos_profile_realtime_recipients,
	publish_checkout_queue_change,
	publish_configuration_change,
	publish_gateway_payment_change,
)
from vunapos.services.gateway_payment_service import (
	cancel_gateway_payment_link,
	expire_stale_gateway_payment_links,
	sync_gateway_payment_source_change,
)


class TestConfigurationRealtime(IntegrationTestCase):
	def test_captures_previous_profile_members_and_scope_before_save(self):
		doc = frappe._dict(
			doctype="POS Profile",
			name="Counter 1",
			flags=frappe._dict(),
			is_new=lambda: False,
		)
		previous = frappe._dict(
			company="Test Company",
			warehouse="Main Warehouse",
			disabled=0,
			applicable_for_users=[frappe._dict(user="old@example.com", default=1)],
		)

		with patch("vunapos.realtime.frappe.get_doc", return_value=previous):
			capture_pos_profile_realtime_recipients(doc)

		self.assertEqual(doc.flags.vunapos_previous_profile_users, {"old@example.com"})
		self.assertEqual(
			doc.flags.vunapos_previous_profile_access_signature,
			(
				"Test Company",
				"Main Warehouse",
				False,
				(("old@example.com", True),),
			),
		)

	def test_new_profile_starts_without_a_previous_scope(self):
		doc = frappe._dict(
			doctype="POS Profile",
			name="Counter 1",
			flags=frappe._dict(),
			is_new=lambda: True,
		)

		capture_pos_profile_realtime_recipients(doc)

		self.assertEqual(doc.flags.vunapos_previous_profile_users, set())
		self.assertIsNone(doc.flags.vunapos_previous_profile_access_signature)

	def test_publishes_only_configuration_metadata_after_commit(self):
		doc = frappe._dict(
			doctype="POS Profile",
			name="Counter 1",
			company="Test Company",
			warehouse="Main Warehouse",
			disabled=0,
			applicable_for_users=[frappe._dict(user="cashier@example.com", default=1)],
			flags=frappe._dict(
				vunapos_previous_profile_users={"cashier@example.com"},
				vunapos_previous_profile_access_signature=(
					"Test Company",
					"Main Warehouse",
					False,
					(("cashier@example.com", True),),
				),
			),
		)

		with (
			patch("frappe.publish_realtime") as publish_realtime,
		):
			publish_configuration_change(doc, "on_update")

		publish_realtime.assert_called_once_with(
			CONFIGURATION_EVENT,
			{"resource": "referenceDataChanged"},
			user="cashier@example.com",
			after_commit=True,
		)

	def test_profile_scope_change_notifies_old_and_new_users(self):
		doc = frappe._dict(
			doctype="POS Profile",
			name="Counter 1",
			company="Test Company",
			warehouse="New Warehouse",
			disabled=0,
			applicable_for_users=[frappe._dict(user="new@example.com", default=1)],
			flags=frappe._dict(
				vunapos_previous_profile_users={"removed@example.com"},
				vunapos_previous_profile_access_signature=(
					"Test Company",
					"Old Warehouse",
					False,
					(("removed@example.com", True),),
				),
			),
		)

		with patch("frappe.publish_realtime") as publish_realtime:
			publish_configuration_change(doc, "on_update")

		self.assertCountEqual(
			[call.kwargs for call in publish_realtime.call_args_list],
			[
				{"user": "removed@example.com", "after_commit": True},
				{"user": "new@example.com", "after_commit": True},
			],
		)
		for call in publish_realtime.call_args_list:
			self.assertEqual(call.args, (CONFIGURATION_EVENT, {"resource": "posProfileChanged"}))

	def test_profile_delete_notifies_former_users(self):
		doc = frappe._dict(
			doctype="POS Profile",
			name="Counter 1",
			company="Test Company",
			warehouse="Main Warehouse",
			disabled=0,
			applicable_for_users=[frappe._dict(user="former@example.com", default=1)],
			flags=frappe._dict(),
		)

		with patch("frappe.publish_realtime") as publish_realtime:
			publish_configuration_change(doc, "on_trash")

		publish_realtime.assert_called_once_with(
			CONFIGURATION_EVENT,
			{"resource": "posProfileChanged"},
			user="former@example.com",
			after_commit=True,
		)

	def test_skips_publication_when_no_enabled_profile_exists(self):
		with (
			patch("vunapos.realtime.frappe.get_all", return_value=[]),
			patch("frappe.publish_realtime") as publish_realtime,
		):
			publish_configuration_change(frappe._dict(doctype="Pricing Rule"), "on_update")

		publish_realtime.assert_not_called()

	def test_company_scoped_tax_change_skips_other_company_profiles(self):
		def get_all(doctype, filters=None, pluck=None):
			if doctype == "POS Profile":
				self.assertEqual(filters, {"disabled": 0, "company": "Company A"})
				return ["Counter A"]
			self.assertEqual(filters["parent"], ["in", ["Counter A"]])
			return ["cashier-a@example.com"]

		with (
			patch("vunapos.realtime.frappe.get_all", side_effect=get_all),
			patch("frappe.publish_realtime") as publish_realtime,
		):
			publish_configuration_change(
				frappe._dict(
					doctype="Item Tax Template",
					company="Company A",
					get_doc_before_save=lambda: None,
				),
				"on_update",
			)

		publish_realtime.assert_called_once_with(
			CONFIGURATION_EVENT,
			{"resource": "referenceDataChanged"},
			user="cashier-a@example.com",
			after_commit=True,
		)

	def test_company_move_notifies_both_old_and_new_company(self):
		def get_all(doctype, filters=None, pluck=None):
			if doctype == "POS Profile":
				return ["Counter A"] if filters["company"] == "Company A" else ["Counter B"]
			return [
				user
				for profile, user in (
					("Counter A", "cashier-a@example.com"),
					("Counter B", "cashier-b@example.com"),
				)
				if profile in filters["parent"][1]
			]

		for doctype in ("Sales Taxes and Charges Template", "Item Tax Template", "Pricing Rule"):
			with self.subTest(doctype=doctype):
				doc = frappe._dict(
					doctype=doctype,
					name="Company-scoped document",
					company="Company B",
					get_doc_before_save=lambda: frappe._dict(company="Company A"),
				)
				with (
					patch("vunapos.realtime.frappe.get_all", side_effect=get_all),
					patch("frappe.publish_realtime") as publish_realtime,
				):
					publish_configuration_change(doc, "on_update")

				self.assertCountEqual(
					[call.kwargs["user"] for call in publish_realtime.call_args_list],
					["cashier-a@example.com", "cashier-b@example.com"],
				)

	def test_company_scoped_delete_uses_current_company_only(self):
		doc = frappe._dict(
			doctype="Pricing Rule",
			company="Company A",
			get_doc_before_save=lambda: self.fail("Deletion must not read pre-save state"),
		)

		def get_all(doctype, filters=None, pluck=None):
			if doctype == "POS Profile":
				self.assertEqual(filters, {"disabled": 0, "company": "Company A"})
				return ["Counter A"]
			return ["cashier-a@example.com"]

		with (
			patch("vunapos.realtime.frappe.get_all", side_effect=get_all),
			patch("frappe.publish_realtime") as publish_realtime,
		):
			publish_configuration_change(doc, "on_trash")

		publish_realtime.assert_called_once_with(
			CONFIGURATION_EVENT,
			{"resource": "referenceDataChanged"},
			user="cashier-a@example.com",
			after_commit=True,
		)

	def test_payment_mode_change_only_notifies_profiles_using_it(self):
		def get_all(doctype, filters=None, pluck=None):
			if doctype == "POS Profile":
				return ["Counter A", "Counter B"]
			if doctype == "POS Payment Method":
				self.assertEqual(filters["mode_of_payment"], "Cash")
				return ["Counter B"]
			self.assertEqual(filters["parent"], ["in", ["Counter B"]])
			return ["cashier-b@example.com"]

		with (
			patch("vunapos.realtime.frappe.get_all", side_effect=get_all),
			patch("frappe.publish_realtime") as publish_realtime,
		):
			publish_configuration_change(frappe._dict(doctype="Mode of Payment", name="Cash"), "on_update")

		self.assertEqual(publish_realtime.call_args.kwargs["user"], "cashier-b@example.com")
		publish_realtime.assert_called_once()

	def test_global_item_price_change_keeps_customer_pricing_profiles_in_scope(self):
		def get_all(doctype, filters=None, pluck=None):
			if doctype == "POS Profile":
				self.assertEqual(filters, {"disabled": 0})
				return ["Counter A", "Counter B"]
			return ["cashier-a@example.com", "cashier-b@example.com"]

		with (
			patch("vunapos.realtime.frappe.get_all", side_effect=get_all),
			patch("frappe.publish_realtime") as publish_realtime,
		):
			publish_configuration_change(
				frappe._dict(doctype="Item Price", price_list="Customer Price List"), "on_update"
			)

		self.assertCountEqual(
			[call.kwargs["user"] for call in publish_realtime.call_args_list],
			["cashier-a@example.com", "cashier-b@example.com"],
		)


class TestCheckoutQueueRealtime(IntegrationTestCase):
	def test_publishes_queue_state_only_to_the_owning_cashier(self):
		doc = frappe._dict(
			doctype="Sales Invoice",
			name="ACC-SINV-QUEUE-0001",
			pos_profile="Counter 1",
			vunapos_opening_entry="POS-OPE-0001",
			vunapos_session_cashier="cashier@example.com",
			vunapos_queue_status="Failed",
			vunapos_queue_attempts=2,
			vunapos_queue_error="Insufficient stock",
		)

		with patch("frappe.publish_realtime") as publish_realtime:
			publish_checkout_queue_change(doc)

		publish_realtime.assert_called_once_with(
			CHECKOUT_QUEUE_EVENT,
			{
				"invoice_doctype": "Sales Invoice",
				"invoice_name": "ACC-SINV-QUEUE-0001",
				"pos_profile": "Counter 1",
				"opening_entry": "POS-OPE-0001",
				"status": "Failed",
				"attempts": 2,
				"error": "Insufficient stock",
			},
			user="cashier@example.com",
			after_commit=True,
		)

	def test_skips_queue_event_without_an_owning_cashier(self):
		with patch("frappe.publish_realtime") as publish_realtime:
			publish_checkout_queue_change(frappe._dict(doctype="Sales Invoice", name="SINV-1"))

		publish_realtime.assert_not_called()


class TestGatewayPaymentRealtime(IntegrationTestCase):
	def _gateway_link(self, status="Pending"):
		link = frappe.get_doc(
			{
				"doctype": "VunaPOS Gateway Payment Link",
				"name": f"VUNAPOS-GPAY-TEST-{frappe.generate_hash(length=8)}",
				"source_doctype": "Payment Entry",
				"source_name": "PAYMENT-ENTRY-TEST",
				"payment_gateway": "_Test Gateway Account",
				"mode_of_payment": "M-Pesa",
				"status": status,
				"pos_profile": "_Test VunaPOS Profile",
				"opening_entry": "POS-OPE-TEST",
				"cashier": frappe.session.user,
				"amount": 100,
				"currency": "KES",
			}
		)
		link.insert(ignore_permissions=True, ignore_links=True, set_name=False)
		return link

	def test_publishes_gateway_payment_state_only_to_the_owning_cashier(self):
		doc = frappe._dict(
			doctype="VunaPOS Gateway Payment Link",
			name="VUNAPOS-GPAY-0001",
			source_doctype="KE Payment Request",
			source_name="KE-PR-0001",
			payment_gateway="Mpesa - KES - NL",
			mode_of_payment="M-Pesa",
			status="Paid",
			transaction_reference="R123",
			pos_profile="Counter 1",
			opening_entry="POS-OPE-0001",
			cashier="cashier@example.com",
			customer="_Test Customer",
			amount=100,
			currency="KES",
			consumed=0,
		)

		with patch("frappe.publish_realtime") as publish_realtime:
			publish_gateway_payment_change(doc)

		publish_realtime.assert_called_once_with(
			GATEWAY_PAYMENT_EVENT,
			{
				"name": "VUNAPOS-GPAY-0001",
				"source_doctype": "KE Payment Request",
				"source_name": "KE-PR-0001",
				"payment_gateway": "Mpesa - KES - NL",
				"mode_of_payment": "M-Pesa",
				"status": "Paid",
				"transaction_reference": "R123",
				"pos_profile": "Counter 1",
				"opening_entry": "POS-OPE-0001",
				"customer": "_Test Customer",
				"amount": 100.0,
				"currency": "KES",
				"consumed": 0,
			},
			user="cashier@example.com",
			after_commit=True,
		)

	def test_skips_gateway_event_without_an_owning_cashier(self):
		with patch("frappe.publish_realtime") as publish_realtime:
			publish_gateway_payment_change(
				frappe._dict(doctype="VunaPOS Gateway Payment Link", name="VUNAPOS-GPAY-0001")
			)

		publish_realtime.assert_not_called()

	def test_syncs_gateway_links_when_ke_source_changes(self):
		source = frappe._dict(doctype="KE Payment Request", name="KE-PR-0001")
		link = frappe._dict(name="VUNAPOS-GPAY-0001")

		with (
			patch(
				"vunapos.services.gateway_payment_service.frappe.get_all",
				return_value=["VUNAPOS-GPAY-0001"],
			),
			patch("vunapos.services.gateway_payment_service.frappe.get_doc", return_value=link),
			patch(
				"vunapos.services.gateway_payment_service._sync_link_from_source",
				return_value=link,
			) as sync_link,
			patch("vunapos.realtime.publish_gateway_payment_change") as publish_change,
		):
			sync_gateway_payment_source_change(source)

		sync_link.assert_called_once_with(link)
		publish_change.assert_called_once_with(link)

	def test_cancel_gateway_payment_link_marks_unconsumed_pending_link_cancelled(self):
		link = self._gateway_link()

		with patch(
			"vunapos.services.gateway_payment_service._sync_link_from_source",
			side_effect=lambda gateway_link: gateway_link,
		):
			result = cancel_gateway_payment_link(link.name)

		self.assertEqual(result["status"], "Cancelled")
		self.assertEqual(
			frappe.db.get_value("VunaPOS Gateway Payment Link", link.name, "status"),
			"Cancelled",
		)

	def test_expire_stale_gateway_payment_links_skips_paid_links(self):
		pending = self._gateway_link()
		paid = self._gateway_link(status="Paid")
		for link in (pending, paid):
			frappe.db.set_value(
				"VunaPOS Gateway Payment Link",
				link.name,
				"creation",
				"2000-01-01 00:00:00",
				update_modified=False,
			)

		with patch(
			"vunapos.services.gateway_payment_service._sync_link_from_source",
			side_effect=lambda gateway_link: gateway_link,
		):
			result = expire_stale_gateway_payment_links()

		self.assertIn(pending.name, result["expired"])
		self.assertEqual(
			frappe.db.get_value("VunaPOS Gateway Payment Link", pending.name, "status"),
			"Expired",
		)
		self.assertEqual(frappe.db.get_value("VunaPOS Gateway Payment Link", paid.name, "status"), "Paid")
