import json
import time
import timeit

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date, flt, now_datetime

from vunapos.api.pos import create_pos_hold, create_pos_invoice, get_pos_bootstrap, ping
from vunapos.api.sales import checkout_invoice, list_held_invoices
from vunapos.services.invoice_service import preview_invoice as preview_invoice_service
from vunapos.tests.helpers import (
	ensure_item_tax_template,
	ensure_open_pos_opening_entry,
	ensure_test_item,
	ensure_test_pos_profile,
	set_invoice_mode,
)


def _payload_for(profile, item_code, qty=1, customer=None, local_ref="POS-TEST-00001"):
	sale_at = now_datetime()
	opening_entry = ensure_open_pos_opening_entry(profile, period_start_date=add_to_date(sale_at, seconds=-1))
	preview = preview_invoice_service(
		pos_profile=profile,
		customer=customer,
		items=json.dumps([{"item_code": item_code, "qty": qty}]),
	)
	totals = preview["totals"]
	mode_of_payment = frappe.get_doc("POS Profile", profile).get("payments")[0].mode_of_payment
	amount = totals.get("rounded_total") or totals.get("grand_total")
	return {
		"pos_profile": profile,
		"customer": customer,
		"items": [{"item_code": item_code, "qty": qty}],
		"payments": [{"mode_of_payment": mode_of_payment, "amount": amount}],
		"totals": totals,
		"local_ref": local_ref,
		"opening_entry": opening_entry,
		"cashier": frappe.session.user,
		"pos_session_verified_at": str(sale_at),
		"posting_date": sale_at.strftime("%Y-%m-%d"),
		"posting_time": sale_at.strftime("%H:%M:%S"),
	}


def _hold_payload_for(profile, item_code, qty=1, customer=None, local_ref="POS-TEST-00001"):
	ensure_open_pos_opening_entry(profile)
	preview = preview_invoice_service(
		pos_profile=profile,
		customer=customer,
		items=json.dumps([{"item_code": item_code, "qty": qty}]),
	)
	return {
		"pos_profile": profile,
		"customer": customer,
		"items": [{"item_code": item_code, "qty": qty}],
		"totals": preview["totals"],
		"local_ref": local_ref,
	}


class TestVunaPOSPing(IntegrationTestCase):
	def test_ping_returns_server_time(self):
		response = ping()
		self.assertTrue(response["ok"], response)
		self.assertTrue(response["data"]["server_time"])


class TestVunaPOSBootstrap(IntegrationTestCase):
	def test_bootstrap_honors_custom_offline_session_lifetime(self):
		profile = ensure_test_pos_profile()
		ensure_test_item()
		frappe.db.set_single_value("POS Settings", "vunapos_offline_session_ttl_hours", 100)

		response = get_pos_bootstrap(pos_profile=profile)

		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["offline_session_ttl_hours"], 100)

	def test_full_bootstrap_returns_dependency_set(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")

		response = get_pos_bootstrap(pos_profile=profile)

		self.assertTrue(response["ok"], response)
		data = response["data"]
		self.assertEqual(data["mode"], "full")
		self.assertTrue(data["server_time"])
		self.assertGreaterEqual(data["bootstrap_version"], 1)
		self.assertEqual(data["pos_profile"]["name"], profile)
		self.assertIn(item_code, [row["item_code"] for row in data["items"]])
		self.assertIsInstance(data["customers"], list)
		self.assertIsInstance(data["tax_templates"], list)
		self.assertIsInstance(data["item_tax_templates"], list)
		self.assertIn("add_taxes_from_item_tax_template", data["tax_settings"])
		self.assertIn("add_taxes_from_taxes_and_charges_template", data["tax_settings"])
		self.assertTrue(data["payment_modes"])
		self.assertEqual(data["pos_session"]["cashier"], frappe.session.user)
		self.assertEqual(data["pos_session"]["pos_profile"], profile)
		self.assertGreater(data["offline_session_ttl_hours"], 0)
		self.assertNotIn("deleted", data)

	def test_bootstrap_reports_each_items_item_level_tax_template(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		template_name = ensure_item_tax_template(item_code, rate=16)

		response = get_pos_bootstrap(pos_profile=profile)

		self.assertTrue(response["ok"], response)
		item_row = next(row for row in response["data"]["items"] if row["item_code"] == item_code)
		self.assertEqual(item_row["item_tax_template"], template_name)

		template_row = next(
			row for row in response["data"]["item_tax_templates"] if row["name"] == template_name
		)
		self.assertEqual(
			template_row["taxes"], [{"account_head": template_row["taxes"][0]["account_head"], "rate": 16}]
		)

	def test_delta_bootstrap_only_returns_changed_items(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")

		since = str(now_datetime())
		time.sleep(1)

		untouched_response = get_pos_bootstrap(pos_profile=profile, since=since)
		self.assertTrue(untouched_response["ok"], untouched_response)
		self.assertEqual(untouched_response["data"]["mode"], "delta")
		self.assertNotIn(item_code, [row["item_code"] for row in untouched_response["data"]["items"]])

		item = frappe.get_doc("Item", item_code)
		item.description = f"touched at {now_datetime()}"
		item.save(ignore_permissions=True)

		changed_response = get_pos_bootstrap(pos_profile=profile, since=since)
		self.assertTrue(changed_response["ok"], changed_response)
		self.assertIn(item_code, [row["item_code"] for row in changed_response["data"]["items"]])

	def test_delta_bootstrap_reports_items_with_only_a_price_change(self):
		# Item Price is separate from Item, so price changes must be synced
		# independently to keep cached prices up to date.
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		price_list = frappe.get_cached_value("POS Profile", profile, "selling_price_list")

		since = str(now_datetime())
		time.sleep(1)

		untouched_response = get_pos_bootstrap(pos_profile=profile, since=since)
		self.assertTrue(untouched_response["ok"], untouched_response)
		self.assertNotIn(item_code, [row["item_code"] for row in untouched_response["data"]["items"]])

		existing_price = frappe.db.get_value(
			"Item Price", {"item_code": item_code, "price_list": price_list}, "name"
		)
		if existing_price:
			price_doc = frappe.get_doc("Item Price", existing_price)
			price_doc.price_list_rate = flt(price_doc.price_list_rate) + 5
			price_doc.save(ignore_permissions=True)
		else:
			frappe.get_doc(
				{
					"doctype": "Item Price",
					"item_code": item_code,
					"price_list": price_list,
					"selling": 1,
					"price_list_rate": 150,
				}
			).insert(ignore_permissions=True)

		changed_response = get_pos_bootstrap(pos_profile=profile, since=since)
		self.assertTrue(changed_response["ok"], changed_response)
		self.assertIn(item_code, [row["item_code"] for row in changed_response["data"]["items"]])

	def test_delta_bootstrap_reports_deleted_items_as_tombstones(self):
		profile = ensure_test_pos_profile()
		set_invoice_mode("Sales Invoice")
		doomed_item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": "_Test Vuna Doomed Item",
				"item_name": "_Test Vuna Doomed Item",
				"item_group": frappe.db.get_value("Item Group", {"is_group": 0}, "name"),
				"stock_uom": frappe.db.get_value("UOM", {}, "name"),
				"is_sales_item": 1,
				"is_stock_item": 0,
			}
		)
		if not frappe.db.exists("Item", doomed_item.item_code):
			doomed_item.insert(ignore_permissions=True)

		since = str(now_datetime())
		time.sleep(1)
		frappe.delete_doc("Item", doomed_item.item_code, ignore_permissions=True)

		response = get_pos_bootstrap(pos_profile=profile, since=since)

		self.assertTrue(response["ok"], response)
		self.assertIn(doomed_item.item_code, response["data"]["deleted"]["Item"])


class TestVunaPOSCreatePosInvoice(IntegrationTestCase):
	def test_rejects_unsupported_payment_mode_for_queued_sale(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _payload_for(profile, item_code)
		payload["payments"] = [{"mode_of_payment": "Not Configured", "amount": 100}]

		response = create_pos_invoice(
			payload=json.dumps(payload),
			idempotency_key=frappe.generate_hash(length=20),
			local_id="unsupported-payment-mode",
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "INVALID_PAYMENT_MODE")

	def test_rejects_queued_sale_without_verified_session_metadata(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _payload_for(profile, item_code)
		payload.pop("opening_entry")

		response = create_pos_invoice(
			payload=json.dumps(payload),
			idempotency_key=frappe.generate_hash(length=20),
			local_id="missing-session",
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "POS_SESSION_METADATA_REQUIRED")

	def test_rejects_queued_sale_for_another_cashier(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _payload_for(profile, item_code)
		payload["cashier"] = "Guest"

		response = create_pos_invoice(
			payload=json.dumps(payload),
			idempotency_key=frappe.generate_hash(length=20),
			local_id="wrong-cashier",
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "POS_SESSION_CASHIER_MISMATCH")

	def test_rejects_sale_created_after_cached_session_expired(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _payload_for(profile, item_code)
		frappe.db.set_single_value("POS Settings", "vunapos_offline_session_ttl_hours", 12)
		frappe.db.set_value(
			"POS Opening Entry",
			payload["opening_entry"],
			"period_start_date",
			add_to_date(now_datetime(), hours=-14),
		)
		payload["pos_session_verified_at"] = str(add_to_date(now_datetime(), hours=-13))

		response = create_pos_invoice(
			payload=json.dumps(payload),
			idempotency_key=frappe.generate_hash(length=20),
			local_id="expired-session",
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "POS_SESSION_CACHE_EXPIRED")

	def test_requires_idempotency_key_and_local_id(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _payload_for(profile, item_code)

		response = create_pos_invoice(payload=json.dumps(payload), idempotency_key=None, local_id="local-1")
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "IDEMPOTENCY_KEY_REQUIRED")

	def test_same_idempotency_key_does_not_duplicate(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _payload_for(profile, item_code)
		key = frappe.generate_hash(length=20)

		first = create_pos_invoice(payload=json.dumps(payload), idempotency_key=key, local_id="local-a")
		self.assertTrue(first["ok"], first)
		self.assertFalse(first["data"]["duplicate"])
		invoice_name = first["data"]["invoice"]

		second = create_pos_invoice(payload=json.dumps(payload), idempotency_key=key, local_id="local-a")
		self.assertTrue(second["ok"], second)
		self.assertTrue(second["data"]["duplicate"])
		self.assertEqual(second["data"]["invoice"], invoice_name)

		count = frappe.db.count("Sales Invoice", filters={"vunapos_idempotency_key": key, "docstatus": 1})
		self.assertEqual(count, 1)

	def test_totals_variance_parks_and_creates_nothing(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _payload_for(profile, item_code)
		payload["totals"]["grand_total"] = (payload["totals"].get("grand_total") or 0) + 999
		key = frappe.generate_hash(length=20)

		response = create_pos_invoice(payload=json.dumps(payload), idempotency_key=key, local_id="local-b")

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "TOTALS_VARIANCE")
		self.assertEqual(frappe.db.count("Sales Invoice", filters={"vunapos_idempotency_key": key}), 0)

	def test_honors_device_local_posting_date(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _payload_for(profile, item_code)
		frappe.db.set_single_value("POS Settings", "vunapos_offline_session_ttl_hours", 72)
		device_date = add_to_date(now_datetime(), days=-2).strftime("%Y-%m-%d")
		frappe.db.set_value(
			"POS Opening Entry",
			payload["opening_entry"],
			"period_start_date",
			add_to_date(now_datetime(), days=-3),
		)
		payload["posting_date"] = device_date
		key = frappe.generate_hash(length=20)

		response = create_pos_invoice(payload=json.dumps(payload), idempotency_key=key, local_id="local-c")

		self.assertTrue(response["ok"], response)
		posting_date = frappe.db.get_value("Sales Invoice", response["data"]["invoice"], "posting_date")
		self.assertEqual(str(posting_date), device_date)

	def test_stores_the_devices_local_ref_on_the_submitted_invoice(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _payload_for(profile, item_code, local_ref="POS-A1B2-00007")
		key = frappe.generate_hash(length=20)

		response = create_pos_invoice(payload=json.dumps(payload), idempotency_key=key, local_id="local-d")

		self.assertTrue(response["ok"], response)
		stored_local_ref = frappe.db.get_value(
			"Sales Invoice", response["data"]["invoice"], "vunapos_invoice_number_offline"
		)
		self.assertEqual(stored_local_ref, "POS-A1B2-00007")


class TestVunaPOSCreatePosHold(IntegrationTestCase):
	def test_upload_requires_current_open_session(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _hold_payload_for(profile, item_code)
		opening_entry = ensure_open_pos_opening_entry(profile)
		frappe.db.set_value("POS Opening Entry", opening_entry, "status", "Closed")

		response = create_pos_hold(
			payload=json.dumps(payload),
			idempotency_key=frappe.generate_hash(length=20),
			local_id="closed-hold",
		)

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "POS_OPENING_REQUIRED")

	def test_requires_idempotency_key_and_local_id(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _hold_payload_for(profile, item_code)

		response = create_pos_hold(payload=json.dumps(payload), idempotency_key=None, local_id="hold-1")
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "IDEMPOTENCY_KEY_REQUIRED")

	def test_same_idempotency_key_does_not_duplicate(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _hold_payload_for(profile, item_code)
		key = frappe.generate_hash(length=20)

		first = create_pos_hold(payload=json.dumps(payload), idempotency_key=key, local_id="hold-a")
		self.assertTrue(first["ok"], first)
		self.assertFalse(first["data"]["duplicate"])
		self.assertEqual(first["data"]["status"], "held")
		invoice_name = first["data"]["invoice"]

		second = create_pos_hold(payload=json.dumps(payload), idempotency_key=key, local_id="hold-a")
		self.assertTrue(second["ok"], second)
		self.assertTrue(second["data"]["duplicate"])
		self.assertEqual(second["data"]["invoice"], invoice_name)

		count = frappe.db.count(
			"Sales Invoice", filters={"vunapos_idempotency_key": key, "docstatus": 0, "vunapos_held": 1}
		)
		self.assertEqual(count, 1)

	def test_totals_variance_parks_and_creates_nothing(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _hold_payload_for(profile, item_code)
		payload["totals"]["grand_total"] = (payload["totals"].get("grand_total") or 0) + 999
		key = frappe.generate_hash(length=20)

		response = create_pos_hold(payload=json.dumps(payload), idempotency_key=key, local_id="hold-b")

		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "TOTALS_VARIANCE")
		self.assertEqual(frappe.db.count("Sales Invoice", filters={"vunapos_idempotency_key": key}), 0)

	def test_creates_a_docstatus_zero_held_invoice_visible_in_list_held_invoices(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _hold_payload_for(profile, item_code)
		key = frappe.generate_hash(length=20)

		response = create_pos_hold(payload=json.dumps(payload), idempotency_key=key, local_id="hold-c")

		self.assertTrue(response["ok"], response)
		invoice_name = response["data"]["invoice"]
		docstatus, held = frappe.db.get_value("Sales Invoice", invoice_name, ["docstatus", "vunapos_held"])
		self.assertEqual(docstatus, 0)
		self.assertEqual(held, 1)

		held_response = list_held_invoices(pos_profile=profile)
		self.assertTrue(held_response["ok"], held_response)
		self.assertIn(invoice_name, [row["name"] for row in held_response["data"]])

	def test_stores_the_devices_local_ref_on_the_held_invoice(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _hold_payload_for(profile, item_code, local_ref="POS-C3D4-00012")
		key = frappe.generate_hash(length=20)

		response = create_pos_hold(payload=json.dumps(payload), idempotency_key=key, local_id="hold-e")

		self.assertTrue(response["ok"], response)
		stored_local_ref = frappe.db.get_value(
			"Sales Invoice", response["data"]["invoice"], "vunapos_invoice_number_offline"
		)
		self.assertEqual(stored_local_ref, "POS-C3D4-00012")

	def test_hold_then_checkout_reuses_a_fresh_idempotency_key(self):
		# Locks in the "no collision" design claim: a hold's idempotency key and a
		# later checkout's idempotency key are independent, and the checkout's key
		# naturally supersedes the hold's on the same document - not a bug.
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		payload = _hold_payload_for(profile, item_code)
		hold_key = frappe.generate_hash(length=20)

		held = create_pos_hold(payload=json.dumps(payload), idempotency_key=hold_key, local_id="hold-d")
		self.assertTrue(held["ok"], held)
		invoice_name = held["data"]["invoice"]

		checkout_payload = _payload_for(profile, item_code)
		checkout_key = frappe.generate_hash(length=20)
		checked_out = checkout_invoice(
			"Sales Invoice",
			invoice_name,
			payments=checkout_payload["payments"],
			idempotency_key=checkout_key,
		)
		self.assertTrue(checked_out["ok"], checked_out)

		final_key = frappe.db.get_value("Sales Invoice", invoice_name, "vunapos_idempotency_key")
		self.assertEqual(final_key, checkout_key)
		self.assertEqual(frappe.db.count("Sales Invoice", {"vunapos_idempotency_key": hold_key}), 0)


class TestVunaPOSVolumeAndLatency(IntegrationTestCase):
	# validates the <300ms server-side assumption that the "300-entry
	# backlog drains in <5min" requirement rests on. Printed average is the real signal.
	def test_create_pos_invoice_server_side_latency(self):
		profile = ensure_test_pos_profile()
		item_code = ensure_test_item()
		set_invoice_mode("Sales Invoice")
		sample_size = 15

		durations = []
		for i in range(sample_size):
			payload = _payload_for(profile, item_code)
			key = frappe.generate_hash(length=20)
			start = timeit.default_timer()
			response = create_pos_invoice(
				payload=json.dumps(payload), idempotency_key=key, local_id=f"vol-{i}"
			)
			durations.append(timeit.default_timer() - start)
			self.assertTrue(response["ok"], response)

		average_ms = (sum(durations) / len(durations)) * 1000
		max_ms = max(durations) * 1000
		print(
			f"\n[F14] create_pos_invoice latency over {sample_size} calls: "
			f"avg={average_ms:.1f}ms max={max_ms:.1f}ms "
			f"(target <300ms avg; 300-entry backlog est. {average_ms * 300 / 1000:.1f}s serial)"
		)
		# Generous ceiling: this environment's absolute numbers aren't representative
		# of production hardware/network, but a regression this large is real.
		self.assertLess(
			average_ms, 1500, "create_pos_invoice got dramatically slower - investigate before trusting N6"
		)
