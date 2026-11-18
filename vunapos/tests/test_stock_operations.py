from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import nowdate

from vunapos.api import stock
from vunapos.tests.helpers import (
	ensure_open_pos_opening_entry,
	ensure_test_pos_profile,
	ensure_test_stock_item,
)


class TestPOSStockOperations(IntegrationTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.token = uuid4().hex[:8]
		base = frappe.get_doc("POS Profile", ensure_test_pos_profile())
		self.company = base.company
		self.target = self._warehouse("Target")
		self.source = self._warehouse("Source")
		self.transit = self._warehouse("Transit", transit=True)
		self.profile = frappe.copy_doc(base)
		self.profile.set("__newname", f"_Test Stock Till {self.token}")
		self.profile.warehouse = self.target
		self.profile.vunapos_allow_stock_requests = 1
		self.profile.vunapos_allow_end_transit = 1
		self.profile.set(
			"vunapos_workflow_configuration",
			[{"transaction_doctype": "Material Request", "apply_workflow": 1}],
		)
		for row in self.profile.applicable_for_users:
			row.default = 0
		self.profile.set("item_groups", [])
		self.profile.insert()
		ensure_open_pos_opening_entry(self.profile.name)
		self.item = ensure_test_stock_item(f"_Test Request Item {self.token}")
		self.uom = frappe.get_cached_value("Item", self.item, "stock_uom")

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_request_barcode_resolves_item_and_barcode_uom_without_stock(self):
		item = frappe.get_doc("Item", self.item)
		item.sales_uom = "Box"
		item.append("uoms", {"uom": "Box", "conversion_factor": 24})
		barcode = f"REQUEST-{self.token}"
		item.append("barcodes", {"barcode": barcode, "uom": self.uom})
		item.save()
		response = stock.scan_request_item(self.profile.name, barcode)
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["item"]["item_code"], self.item)
		self.assertEqual(response["data"]["uom"], self.uom)
		self.assertEqual(response["data"]["item"]["actual_qty"], 0)
		self.assertTrue(stock.scan_request_item(self.profile.name, self.item)["ok"])
		self.assertFalse(stock.scan_request_item(self.profile.name, "unknown-barcode")["ok"])

	def test_request_barcode_enforces_profile_and_item_restrictions(self):
		self.profile.db_set("vunapos_allow_stock_requests", 0)
		self.assertFalse(stock.scan_request_item(self.profile.name, self.item)["ok"])
		self.profile.db_set("vunapos_allow_stock_requests", 1)
		frappe.db.set_value("Item", self.item, "disabled", 1)
		self.assertFalse(stock.scan_request_item(self.profile.name, self.item)["ok"])
		frappe.db.set_value("Item", self.item, "disabled", 0)

	def test_profile_switches_hide_and_block_stock_operations_independently(self):
		self.profile.db_set("vunapos_allow_stock_requests", 0)
		access = stock.capabilities(self.profile.name)["data"]
		self.assertFalse(access["can_request"])
		self.assertTrue(access["can_receive"])
		self.assertFalse(self._request()["ok"])
		self.assertFalse(stock.catalogue(self.profile.name)["ok"])
		self.assertFalse(stock.held_requests(self.profile.name)["ok"])
		self.profile.db_set("vunapos_allow_end_transit", 0)
		self.assertFalse(stock.capabilities(self.profile.name)["data"]["can_receive"])
		self.assertFalse(stock.list_transit(self.profile.name)["ok"])
		self.assertFalse(stock.transit_details(self.profile.name, "missing")["ok"])
		self.assertFalse(stock.end_transit(self.profile.name, "missing", "x")["ok"])
		self.assertFalse(stock.list_requests(self.profile.name)["ok"])
		self.assertFalse(stock.request_details(self.profile.name, "missing")["ok"])

	def test_request_history_is_warehouse_scoped_and_includes_held_drafts(self):
		name = stock.create_request(
			self.profile.name,
			[{"item_code": self.item, "qty": 2, "uom": self.uom}],
			nowdate(),
			"history",
			hold=True,
		)["data"]["name"]
		listing = stock.list_requests(self.profile.name)
		self.assertTrue(listing["ok"], listing)
		self.assertIn(name, [row.name for row in listing["data"]])
		details = stock.request_details(self.profile.name, name)
		self.assertTrue(details["ok"], details)
		self.assertEqual(details["data"]["items"][0]["qty"], 2)
		self.assertTrue(details["data"]["result"]["is_held"])
		self.assertEqual(stock.list_requests(self.profile.name, query="no-match")["data"], [])
		self.profile.db_set("warehouse", self.source)
		self.assertEqual(stock.list_requests(self.profile.name)["data"], [])
		self.assertFalse(stock.request_details(self.profile.name, name)["ok"])

	def test_request_history_remains_available_to_receivers_without_request_creation(self):
		name = self._request()["data"]["name"]
		self.profile.db_set("vunapos_allow_stock_requests", 0)
		self.assertTrue(stock.capabilities(self.profile.name)["data"]["can_view_requests"])
		self.assertTrue(stock.list_requests(self.profile.name)["ok"])
		self.assertTrue(stock.request_details(self.profile.name, name)["ok"])

	def test_request_history_includes_desk_requests_but_only_shows_own_warehouse_items(self):
		doc = frappe.get_doc(
			{
				"doctype": "Material Request",
				"material_request_type": "Material Transfer",
				"company": self.company,
				"schedule_date": nowdate(),
				"items": [
					{"item_code": self.item, "qty": 2, "warehouse": self.target, "schedule_date": nowdate()},
					{"item_code": self.item, "qty": 7, "warehouse": self.source, "schedule_date": nowdate()},
				],
			}
		).insert()
		listing = stock.list_requests(self.profile.name)
		self.assertTrue(listing["ok"], listing)
		self.assertIn(doc.name, [row.name for row in listing["data"]])
		details = stock.request_details(self.profile.name, doc.name)["data"]
		self.assertTrue(details["has_other_warehouses"])
		self.assertEqual(len(details["items"]), 1)
		self.assertEqual(details["items"][0]["qty"], 2)

	def test_profile_workflow_option_does_not_bypass_native_approval(self):
		self.profile.set("vunapos_workflow_configuration", [])
		self.profile.save()
		with patch("vunapos.services.stock_service.get_workflow_name", return_value="Approval required"):
			self.assertIsNone(stock.capabilities(self.profile.name)["data"]["request_workflow"])
			response = self._request()
			self.assertTrue(response["ok"], response)
			self.assertEqual(response["data"]["docstatus"], 0)
			self.assertNotIn("workflow", response["data"])
			self.assertFalse(
				stock.request_workflow_action(
					self.profile.name, response["data"]["name"], "Approve", response["data"]["modified"]
				)["ok"]
			)

	def test_hold_resume_and_submit_same_request(self):
		items = [{"item_code": self.item, "qty": 2, "uom": self.uom}]
		held = stock.create_request(
			self.profile.name, items, nowdate(), "hold-key", "For tomorrow", hold=True
		)
		self.assertTrue(held["ok"], held)
		name = held["data"]["name"]
		self.assertEqual(held["data"]["docstatus"], 0)
		self.assertTrue(held["data"]["is_held"])
		retry = stock.create_request(
			self.profile.name, items, nowdate(), "hold-key", "For tomorrow", hold=True
		)
		self.assertEqual(retry["data"]["name"], name)
		self.assertIn(name, [row.name for row in stock.held_requests(self.profile.name)["data"]])
		draft = stock.held_request(self.profile.name, name)["data"]
		self.assertEqual(draft["notes"], "For tomorrow")
		items[0]["qty"] = 4
		response = stock.create_request(
			self.profile.name,
			items,
			nowdate(),
			"resume",
			"Updated",
			draft_name=name,
			draft_modified=draft["modified"],
		)
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["name"], name)
		self.assertEqual(response["data"]["docstatus"], 1)
		self.assertFalse(response["data"]["is_held"])
		self.assertEqual(frappe.get_doc("Material Request", name).items[0].qty, 4)
		self.assertEqual(stock.held_requests(self.profile.name)["data"], [])
		retry = stock.create_request(
			self.profile.name,
			items,
			nowdate(),
			"resume",
			"Updated",
			draft_name=name,
			draft_modified=draft["modified"],
		)
		self.assertTrue(retry["ok"], retry)
		self.assertEqual(retry["data"]["name"], name)

	def test_held_request_rejects_stale_edits_and_other_users(self):
		items = [{"item_code": self.item, "qty": 2, "uom": self.uom}]
		name = stock.create_request(self.profile.name, items, nowdate(), "held", hold=True)["data"]["name"]
		response = stock.create_request(
			self.profile.name, items, nowdate(), "held-edit", draft_name=name, draft_modified="stale"
		)
		self.assertFalse(response["ok"])
		frappe.db.set_value("Material Request", name, "owner", "Guest")
		self.assertFalse(stock.held_request(self.profile.name, name)["ok"])
		self.assertFalse(
			stock.create_request(self.profile.name, items, nowdate(), "held-edit", draft_name=name)["ok"]
		)

	def _warehouse(self, label, transit=False):
		if transit and not frappe.db.exists("Warehouse Type", "Transit"):
			frappe.get_doc({"doctype": "Warehouse Type", "name": "Transit"}).insert()
		return (
			frappe.get_doc(
				{
					"doctype": "Warehouse",
					"warehouse_name": f"_Test {label} {self.token}",
					"company": self.company,
					"warehouse_type": "Transit" if transit else None,
				}
			)
			.insert()
			.name
		)

	def _request(self, qty=3, key=None, **changes):
		return stock.create_request(
			self.profile.name,
			[{"item_code": self.item, "qty": qty, "uom": self.uom, **changes}],
			nowdate(),
			key or str(uuid4()),
		)

	def _dispatch(self, qty=3, extra=None):
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

		response = self._request(qty)
		self.assertTrue(response["ok"], response)
		request = frappe.get_doc("Material Request", response["data"]["name"])
		make_stock_entry(item_code=self.item, to_warehouse=self.source, qty=qty + 5, rate=100)
		rows = [
			{
				"item_code": self.item,
				"qty": qty,
				"s_warehouse": self.source,
				"t_warehouse": self.transit,
				"material_request": request.name,
				"material_request_item": request.items[0].name,
			}
		]
		if extra:
			rows.append(extra)
		entry = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"stock_entry_type": "Material Transfer",
				"purpose": "Material Transfer",
				"add_to_transit": 1,
				"company": self.company,
				"from_warehouse": self.source,
				"to_warehouse": self.transit,
				"items": rows,
			}
		)
		entry.insert()
		entry.submit()
		return entry

	def _review(self, entry):
		response = stock.transit_details(self.profile.name, entry.name)
		self.assertTrue(response["ok"], response)
		return response["data"]

	def _draft_receipt(self, entry):
		from erpnext.stock.doctype.stock_entry.stock_entry import make_stock_in_entry

		doc = make_stock_in_entry(entry.name)
		doc.insert()
		return doc

	def _inspection_receipt(self):
		entry = self._dispatch()
		draft = self._draft_receipt(entry)
		draft.inspection_required = 1
		draft.save()
		return entry, draft

	def _inspection(self, draft, status="Accepted"):
		return frappe.get_doc(
			{
				"doctype": "Quality Inspection",
				"inspection_type": "Outgoing",
				"reference_type": "Stock Entry",
				"reference_name": draft.name,
				"child_row_reference": draft.items[0].name,
				"item_code": self.item,
				"inspected_by": frappe.session.user,
				"sample_size": 1,
				"status": status,
			}
		).insert()

	def test_inspection_required_receipt_is_saved_as_draft_without_moving_stock(self):
		from erpnext.stock.doctype.stock_entry.stock_entry import make_stock_in_entry

		from vunapos.services.stock_service import _save

		entry = self._dispatch()
		draft = make_stock_in_entry(entry.name)
		draft.inspection_required = 1
		result = _save(draft)
		self.assertEqual(result["docstatus"], 0)
		self.assertTrue(result["inspection_required"])
		self.assertEqual(self._qty(self.target), 0)
		self.assertFalse(frappe.db.exists("Quality Inspection", {"reference_name": result["name"]}))

	def test_receipt_inspection_context_is_row_specific_and_submission_waits_for_approval(self):
		frappe.db.set_single_value("Stock Settings", "action_if_quality_inspection_is_not_submitted", "Stop")
		frappe.db.set_single_value("Stock Settings", "action_if_quality_inspection_is_rejected", "Stop")
		entry, draft = self._inspection_receipt()
		details = stock.receipt_details(self.profile.name, entry.name, draft.name)
		self.assertTrue(details["ok"], details)
		self.assertFalse(details["data"]["can_submit"])
		self.assertTrue(details["data"]["inspection_messages"])
		row = details["data"]["items"][0]
		self.assertTrue(row["inspection"]["create_url"])
		context = stock.inspection_context(self.profile.name, entry.name, draft.name, row["name"])
		self.assertTrue(context["ok"], context)
		self.assertEqual(context["data"]["defaults"]["child_row_reference"], draft.items[0].name)
		self.assertNotIn("status", context["data"]["defaults"])
		self.assertFalse(
			stock.complete_receipt(self.profile.name, entry.name, draft.name, details["data"]["review"])["ok"]
		)
		qi = self._inspection(draft)
		pending = stock.receipt_details(self.profile.name, entry.name, draft.name)["data"]
		self.assertFalse(pending["can_submit"])
		self.assertEqual(pending["items"][0]["inspection"]["name"], qi.name)
		self.assertIsNone(pending["items"][0]["inspection"]["create_url"])
		qi.submit()
		ready = stock.receipt_details(self.profile.name, entry.name, draft.name)["data"]
		self.assertTrue(ready["can_submit"])
		self.assertEqual(ready["inspection_messages"], [])
		response = stock.complete_receipt(self.profile.name, entry.name, draft.name, ready["review"])
		self.assertTrue(response["ok"], response)
		self.assertEqual(self._qty(self.target), 3)

	def test_rejected_inspection_respects_stock_settings_stop_and_warn_policies(self):
		frappe.db.set_single_value("Stock Settings", "action_if_quality_inspection_is_not_submitted", "Stop")
		frappe.db.set_single_value("Stock Settings", "action_if_quality_inspection_is_rejected", "Stop")
		entry, draft = self._inspection_receipt()
		qi = self._inspection(draft, status="Rejected")
		qi.submit()
		details = stock.receipt_details(self.profile.name, entry.name, draft.name)["data"]
		self.assertFalse(details["can_submit"])
		self.assertFalse(
			stock.complete_receipt(self.profile.name, entry.name, draft.name, details["review"])["ok"]
		)
		frappe.db.set_single_value("Stock Settings", "action_if_quality_inspection_is_rejected", "Warn")
		ready = stock.receipt_details(self.profile.name, entry.name, draft.name)["data"]
		self.assertTrue(ready["can_submit"])
		response = stock.complete_receipt(self.profile.name, entry.name, draft.name, ready["review"])
		self.assertTrue(response["ok"], response)

	def test_inspection_creation_requires_permission_and_valid_receipt_row(self):
		entry, draft = self._inspection_receipt()
		self.assertFalse(
			stock.inspection_context(self.profile.name, entry.name, draft.name, "another-row")["ok"]
		)
		original = frappe.has_permission

		def permission(doctype, ptype="read", *args, **kwargs):
			return False if doctype == "Quality Inspection" else original(doctype, ptype, *args, **kwargs)

		with patch("frappe.has_permission", side_effect=permission):
			details = stock.receipt_details(self.profile.name, entry.name, draft.name)["data"]
			self.assertIsNone(details["items"][0]["inspection"]["create_url"])
			self.assertFalse(
				stock.inspection_context(self.profile.name, entry.name, draft.name, draft.items[0].name)["ok"]
			)

	def _pos_inspection(self, entry, draft, payload=None):
		args = (self.profile.name, entry.name, draft.name, draft.items[0].name)
		return stock.inspection_details(*args) if payload is None else stock.save_inspection(*args, payload)

	def test_pos_inspection_can_be_created_submitted_and_receipt_completed_without_desk(self):
		frappe.db.set_single_value("Stock Settings", "action_if_quality_inspection_is_not_submitted", "Stop")
		entry, draft = self._inspection_receipt()
		opened = self._pos_inspection(entry, draft)
		self.assertTrue(opened["ok"], opened)
		self.assertIsNone(opened["data"]["name"])
		self.assertEqual(opened["data"]["status"], "Rejected")
		self.assertFalse(frappe.db.exists("Quality Inspection", {"reference_name": draft.name}))
		payload = {"sample_size": 1, "remarks": "Checked packaging", "status": "Accepted", "readings": []}
		saved = self._pos_inspection(entry, draft, payload)
		self.assertTrue(saved["ok"], saved)
		self.assertEqual(saved["data"]["docstatus"], 0)
		retry = self._pos_inspection(entry, draft, payload)
		self.assertTrue(retry["ok"], retry)
		self.assertEqual(saved["data"]["name"], retry["data"]["name"])
		self.assertFalse(
			stock.receipt_details(self.profile.name, entry.name, draft.name)["data"]["can_submit"]
		)
		submitted = self._pos_inspection(entry, draft, {**saved["data"], "submit": True})
		self.assertTrue(submitted["ok"], submitted)
		self.assertEqual(submitted["data"]["docstatus"], 1)
		qi = frappe.get_doc("Quality Inspection", submitted["data"]["name"])
		self.assertEqual(qi.child_row_reference, draft.items[0].name)
		ready = stock.receipt_details(self.profile.name, entry.name, draft.name)["data"]
		self.assertTrue(ready["can_submit"])
		result = stock.complete_receipt(self.profile.name, entry.name, draft.name, ready["review"])
		self.assertTrue(result["ok"], result)
		self.assertEqual(self._qty(self.target), 3)

	def test_pos_inspection_rejects_blank_results_stale_updates_and_wrong_context(self):
		entry, draft = self._inspection_receipt()
		payload = {"sample_size": 1, "readings": []}
		self.assertFalse(self._pos_inspection(entry, draft, payload)["ok"])
		self.assertFalse(
			self._pos_inspection(entry, draft, {**payload, "status": "Accepted", "sample_size": -1})["ok"]
		)
		saved = self._pos_inspection(entry, draft, {**payload, "status": "Rejected"})
		self.assertTrue(saved["ok"], saved)
		self.assertFalse(self._pos_inspection(entry, draft, {**saved["data"], "modified": "old"})["ok"])
		self.assertFalse(
			stock.inspection_details(self.profile.name, entry.name, draft.name, "wrong-row")["ok"]
		)
		self.profile.db_set("vunapos_allow_end_transit", 0)
		self.assertFalse(self._pos_inspection(entry, draft)["ok"])

	def test_pos_inspection_uses_native_numeric_value_and_formula_criteria(self):
		parameters = []
		for label in ("Temperature", "Appearance", "Seal"):
			parameters.append(
				frappe.get_doc(
					{"doctype": "Quality Inspection Parameter", "parameter": f"{label} {self.token}"}
				)
				.insert()
				.name
			)
		template = frappe.get_doc(
			{
				"doctype": "Quality Inspection Template",
				"quality_inspection_template_name": f"_Test POS Inspection {self.token}",
				"item_quality_inspection_parameter": [
					{"specification": parameters[0], "numeric": 1, "min_value": 2, "max_value": 8},
					{"specification": parameters[1], "numeric": 0, "value": "Good"},
					{
						"specification": parameters[2],
						"numeric": 0,
						"formula_based_criteria": 1,
						"acceptance_formula": 'reading_value in ("Intact", "OK")',
					},
				],
			}
		).insert()
		frappe.db.set_value("Item", self.item, "quality_inspection_template", template.name)
		frappe.clear_document_cache("Item", self.item)
		entry, draft = self._inspection_receipt()
		opened = self._pos_inspection(entry, draft)
		self.assertTrue(opened["ok"], opened)
		data = opened["data"]
		self.assertEqual(len(data["readings"]), 3)
		self.assertTrue(all(row["status"] == "Rejected" for row in data["readings"]))
		self.assertFalse(self._pos_inspection(entry, draft, data)["ok"])
		data["readings"][0].update(
			{"values": ["12"] + [""] * 9, "max_value": 100, "manual_inspection": 1, "status": "Accepted"}
		)
		data["readings"][1]["reading_value"] = "Good"
		data["readings"][2]["reading_value"] = "Intact"
		rejected = self._pos_inspection(entry, draft, data)
		self.assertTrue(rejected["ok"], rejected)
		self.assertEqual(rejected["data"]["status"], "Rejected")
		self.assertEqual(rejected["data"]["readings"][0]["max_value"], 8)
		data = rejected["data"]
		data["readings"][0]["values"][0] = "5"
		accepted = self._pos_inspection(entry, draft, {**data, "submit": True})
		self.assertTrue(accepted["ok"], accepted)
		self.assertEqual(accepted["data"]["status"], "Accepted")

	def _inspection_template(self, suffix="A"):
		parameter = frappe.get_doc(
			{"doctype": "Quality Inspection Parameter", "parameter": f"_Test Template {suffix} {self.token}"}
		).insert()
		return frappe.get_doc(
			{
				"doctype": "Quality Inspection Template",
				"quality_inspection_template_name": f"_Test Inspection {suffix} {self.token}",
				"item_quality_inspection_parameter": [
					{"specification": parameter.name, "numeric": 1, "min_value": 2, "max_value": 8}
				],
			}
		).insert()

	def test_pos_inspection_template_can_be_selected_previewed_and_changed_on_a_draft(self):
		entry, draft = self._inspection_receipt()
		a, b = self._inspection_template(), self._inspection_template("B")
		args = (self.profile.name, entry.name, draft.name, draft.items[0].name)
		listed = stock.inspection_templates(*args, query=self.token)
		self.assertTrue(listed["ok"], listed)
		self.assertIn(a.name, [r.name for r in listed["data"]])
		preview = stock.inspection_template_details(*args, template=a.name)
		self.assertTrue(preview["ok"], preview)
		self.assertFalse(frappe.db.exists("Quality Inspection", {"reference_name": draft.name}))
		data = preview["data"]
		self.assertEqual(data["template"], a.name)
		self.assertEqual(data["readings"][0]["status"], "Rejected")
		data["readings"][0]["values"][0] = "5"
		saved = self._pos_inspection(entry, draft, data)
		self.assertTrue(saved["ok"], saved)
		self.assertEqual(saved["data"]["template"], a.name)
		qi_name = saved["data"]["name"]
		preview = stock.inspection_template_details(*args, template=b.name)
		self.assertTrue(preview["ok"], preview)
		self.assertEqual(
			frappe.db.get_value("Quality Inspection", qi_name, "quality_inspection_template"), a.name
		)
		data = preview["data"]
		data["readings"][0]["values"][0] = "6"
		changed = self._pos_inspection(entry, draft, {**data, "submit": True})
		self.assertTrue(changed["ok"], changed)
		self.assertEqual(changed["data"]["name"], qi_name)
		self.assertEqual(changed["data"]["template"], b.name)
		self.assertFalse(stock.inspection_template_details(*args, template=a.name)["ok"])

	def test_pos_inspection_template_selection_enforces_read_permissions_and_context(self):
		entry, draft = self._inspection_receipt()
		template = self._inspection_template()
		args = (self.profile.name, entry.name, draft.name, draft.items[0].name)
		self.assertFalse(stock.inspection_template_details(*args, template="missing-template")["ok"])
		original = frappe.permissions.has_permission

		def permission(doctype, ptype="read", *args, **kwargs):
			if doctype == "Quality Inspection Template" and ptype == "read":
				return False
			return original(doctype, ptype, *args, **kwargs)

		with patch("frappe.permissions.has_permission", side_effect=permission):
			self.assertFalse(stock.inspection_template_details(*args, template=template.name)["ok"])
			self.assertFalse(
				self._pos_inspection(
					entry, draft, {"template": template.name, "sample_size": 1, "readings": []}
				)["ok"]
			)
		self.assertFalse(
			stock.inspection_template_details(
				self.profile.name, entry.name, draft.name, "wrong-row", template.name
			)["ok"]
		)

	def test_pos_inspection_manual_flag_does_not_change_the_numeric_reading_type(self):
		entry, draft = self._inspection_receipt()
		template = self._inspection_template()
		preview = stock.inspection_template_details(
			self.profile.name, entry.name, draft.name, draft.items[0].name, template.name
		)
		self.assertTrue(preview["ok"], preview)
		data = preview["data"]
		data["readings"][0]["values"][0] = "12"
		data.update(manual_inspection=True, status="Accepted")
		saved = self._pos_inspection(entry, draft, data)
		self.assertTrue(saved["ok"], saved)
		self.assertTrue(saved["data"]["manual_inspection"])
		self.assertEqual(saved["data"]["status"], "Accepted")
		self.assertEqual(saved["data"]["readings"][0]["numeric"], 1)
		self.assertEqual(saved["data"]["readings"][0]["status"], "Rejected")
		data = saved["data"]
		data["manual_inspection"] = False
		automatic = self._pos_inspection(entry, draft, data)
		self.assertTrue(automatic["ok"], automatic)
		self.assertEqual(automatic["data"]["status"], "Rejected")

	def test_inspection_live_preview_updates_numeric_status_without_saving(self):
		entry, draft = self._inspection_receipt()
		template = self._inspection_template()
		args = (self.profile.name, entry.name, draft.name, draft.items[0].name)
		data = stock.inspection_template_details(*args, template.name)["data"]
		before = str(frappe.db.get_value("Stock Entry", draft.name, "modified"))
		for value, status in (("5", "Accepted"), ("12", "Rejected"), ("", "Rejected")):
			data["readings"][0]["values"][0] = value
			result = stock.preview_inspection(*args, data)
			self.assertTrue(result["ok"], result)
			self.assertEqual(result["data"], {"status": status, "readings": [status]})
		data["readings"][0]["values"][0] = "not a number"
		self.assertFalse(stock.preview_inspection(*args, data)["ok"])
		self.assertFalse(frappe.db.exists("Quality Inspection", {"reference_name": draft.name}))
		self.assertEqual(str(frappe.db.get_value("Stock Entry", draft.name, "modified")), before)
		self.assertEqual(self._qty(self.target), 0)

	def test_inspection_live_preview_does_not_create_parameter_masters_and_matches_save(self):
		entry, draft = self._inspection_receipt()
		args = (self.profile.name, entry.name, draft.name, draft.items[0].name)
		name = f"_Test Preview Parameter {self.token}"
		data = {
			"sample_size": 1,
			"readings": [
				{
					"specification": name,
					"create_parameter": True,
					"numeric": 1,
					"min_value": 2,
					"max_value": 8,
					"values": ["5"] + [""] * 9,
				}
			],
		}
		preview = stock.preview_inspection(*args, data)
		self.assertTrue(preview["ok"], preview)
		self.assertEqual(preview["data"]["status"], "Accepted")
		self.assertFalse(frappe.db.exists("Quality Inspection Parameter", name))
		saved = self._pos_inspection(entry, draft, data)
		self.assertTrue(saved["ok"], saved)
		self.assertEqual(saved["data"]["status"], preview["data"]["status"])
		data = saved["data"]
		modified = data["modified"]
		data["readings"][0]["values"][0] = "12"
		preview = stock.preview_inspection(*args, data)
		self.assertTrue(preview["ok"], preview)
		self.assertEqual(preview["data"]["status"], "Rejected")
		stored = frappe.get_doc("Quality Inspection", data["name"])
		self.assertEqual(str(stored.modified), modified)
		self.assertEqual(stored.readings[0].reading_1, "5")
		self.assertEqual(stored.status, "Accepted")

	def test_inspection_live_preview_uses_native_value_formula_and_manual_rules(self):
		entry, draft = self._inspection_receipt()
		template = self._inspection_template()
		template.item_quality_inspection_parameter[0].update(
			{
				"numeric": 0,
				"formula_based_criteria": 1,
				"acceptance_formula": 'reading_value in ("Intact", "OK")',
			}
		)
		template.save()
		args = (self.profile.name, entry.name, draft.name, draft.items[0].name)
		data = stock.inspection_template_details(*args, template.name)["data"]
		for value, status in (("Intact", "Accepted"), ("Broken", "Rejected"), ("", "Rejected")):
			data["readings"][0]["reading_value"] = value
			result = stock.preview_inspection(*args, data)
			self.assertTrue(result["ok"], result)
			self.assertEqual(result["data"]["readings"], [status])
		data.update(manual_inspection=True, status="Accepted")
		result = stock.preview_inspection(*args, data)
		self.assertTrue(result["ok"], result)
		self.assertEqual(result["data"], {"status": "Accepted", "readings": ["Rejected"]})
		self.profile.db_set("vunapos_allow_end_transit", 0)
		self.assertFalse(stock.preview_inspection(*args, data)["ok"])

	def test_pos_inspection_denies_missing_create_write_and_submit_permissions(self):
		entry, draft = self._inspection_receipt()
		original = frappe.permissions.has_permission
		denied = "create"

		def permission(doctype, ptype="read", *args, **kwargs):
			if doctype == "Quality Inspection" and ptype == denied:
				return False
			return original(doctype, ptype, *args, **kwargs)

		payload = {"sample_size": 1, "status": "Accepted", "readings": []}
		with (
			patch("frappe.has_permission", side_effect=permission),
			patch("frappe.permissions.has_permission", side_effect=permission),
		):
			self.assertFalse(self._pos_inspection(entry, draft, payload)["ok"])
			denied = "submit"
			self.assertFalse(self._pos_inspection(entry, draft, {**payload, "submit": True})["ok"])
			saved = self._pos_inspection(entry, draft, payload)
			self.assertTrue(saved["ok"], saved)
			denied = "write"
			self.assertFalse(self._pos_inspection(entry, draft, saved["data"])["ok"])

	def test_pos_inspection_can_add_existing_and_new_parameters_and_preserves_saved_checks(self):
		entry, draft = self._inspection_receipt()
		parameter = frappe.get_doc(
			{"doctype": "Quality Inspection Parameter", "parameter": f"_Test Temperature {self.token}"}
		).insert()
		options = stock.inspection_parameters(
			self.profile.name, entry.name, draft.name, draft.items[0].name, self.token
		)
		self.assertTrue(options["ok"], options)
		self.assertIn(parameter.name, [r.name for r in options["data"]])
		payload = {
			"sample_size": 1,
			"readings": [
				{
					"specification": parameter.name,
					"numeric": 1,
					"min_value": 2,
					"max_value": 8,
					"values": ["5"] + [""] * 9,
				}
			],
		}
		saved = self._pos_inspection(entry, draft, payload)
		self.assertTrue(saved["ok"], saved)
		self.assertEqual(saved["data"]["status"], "Accepted")
		data = saved["data"]
		self.assertFalse(self._pos_inspection(entry, draft, {**data, "readings": []})["ok"])
		data["readings"][0].update(max_value=100, values=["12"] + [""] * 9)
		new_name = f"_Test Packaging {self.token}"
		data["readings"].append(
			{
				"specification": new_name,
				"create_parameter": True,
				"numeric": 0,
				"manual_inspection": 1,
				"status": "Accepted",
			}
		)
		saved = self._pos_inspection(entry, draft, data)
		self.assertTrue(saved["ok"], saved)
		self.assertTrue(frappe.db.exists("Quality Inspection Parameter", new_name))
		self.assertEqual(saved["data"]["status"], "Rejected")
		self.assertEqual(saved["data"]["readings"][0]["max_value"], 8)
		self.assertEqual(saved["data"]["readings"][1]["specification"], new_name)

	def test_pos_added_parameters_require_valid_criteria_and_roll_back_new_masters_on_failure(self):
		entry, draft = self._inspection_receipt()
		name = f"_Test Seal {self.token}"
		row = {
			"specification": name,
			"create_parameter": True,
			"numeric": 0,
			"value": "Intact",
			"reading_value": "Intact",
		}
		payload = {"sample_size": 1, "readings": [row]}
		self.assertFalse(self._pos_inspection(entry, draft, {**payload, "readings": [row, row]})["ok"])
		self.assertFalse(frappe.db.exists("Quality Inspection Parameter", name))
		invalid = {**row, "numeric": 1, "min_value": 5, "max_value": 2}
		self.assertFalse(self._pos_inspection(entry, draft, {**payload, "readings": [invalid]})["ok"])
		self.assertFalse(frappe.db.exists("Quality Inspection Parameter", name))
		saved = self._pos_inspection(entry, draft, {**payload, "submit": True})
		self.assertTrue(saved["ok"], saved)
		self.assertEqual(saved["data"]["status"], "Accepted")
		self.assertFalse(
			stock.inspection_parameters(self.profile.name, entry.name, draft.name, draft.items[0].name)["ok"]
		)

	def test_pos_parameter_creation_respects_master_permissions(self):
		entry, draft = self._inspection_receipt()
		original = frappe.permissions.has_permission
		name = f"_Test Denied Parameter {self.token}"

		def permission(doctype, ptype="read", *args, **kwargs):
			if doctype == "Quality Inspection Parameter" and ptype == "create":
				return False
			return original(doctype, ptype, *args, **kwargs)

		with (
			patch("frappe.has_permission", side_effect=permission),
			patch("frappe.permissions.has_permission", side_effect=permission),
		):
			self.assertFalse(self._pos_inspection(entry, draft)["data"]["can_create_parameter"])
			result = self._pos_inspection(
				entry,
				draft,
				{
					"sample_size": 1,
					"readings": [
						{
							"specification": name,
							"create_parameter": True,
							"manual_inspection": 1,
							"status": "Accepted",
						}
					],
				},
			)
			self.assertFalse(result["ok"], result)
		self.assertFalse(frappe.db.exists("Quality Inspection Parameter", name))

	def test_pos_inspection_workflow_is_explicit_and_cannot_be_bypassed(self):
		entry, draft = self._inspection_receipt()
		workflow = frappe._dict(
			name="Inspection approval",
			workflow_state_field="status",
			transitions=[
				frappe.get_doc(
					{
						"doctype": "Workflow Transition",
						"state": "Accepted",
						"action": "Approve check",
						"next_state": "Accepted",
						"allowed": "System Manager",
						"condition": "",
						"allow_self_approval": 1,
					}
				)
			],
		)
		payload = {"sample_size": 1, "status": "Accepted", "readings": []}
		with (
			patch("vunapos.services.inspection_service.get_workflow_name", return_value=workflow.name),
			patch("vunapos.services.inspection_service.get_workflow", return_value=workflow),
			patch("vunapos.services.inspection_service.apply_workflow") as advance,
		):
			self.assertFalse(self._pos_inspection(entry, draft, {**payload, "submit": True})["ok"])
			saved = self._pos_inspection(entry, draft, payload)
			self.assertTrue(saved["ok"], saved)
			self.assertFalse(saved["data"]["can_submit"])
			self.assertEqual(saved["data"]["docstatus"], 0)
			advance.assert_not_called()
			self.assertFalse(self._pos_inspection(entry, draft, {**saved["data"], "action": "Unknown"})["ok"])
			result = self._pos_inspection(entry, draft, {**saved["data"], "action": "Approve check"})
			self.assertTrue(result["ok"], result)
			advance.assert_called_once()
			self.assertEqual(advance.call_args.args[1], "Approve check")

	def test_existing_draft_receipt_can_be_reviewed_submitted_and_retried(self):
		entry = self._dispatch()
		draft = self._draft_receipt(entry)
		details = stock.receipt_details(self.profile.name, entry.name, draft.name)
		self.assertTrue(details["ok"], details)
		self.assertTrue(details["data"]["can_submit"])
		self.assertEqual(details["data"]["items"][0]["stock_qty"], 3)
		response = stock.complete_receipt(
			self.profile.name, entry.name, draft.name, details["data"]["review"]
		)
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["name"], draft.name)
		self.assertEqual(response["data"]["docstatus"], 1)
		self.assertEqual(self._qty(self.target), 3)
		retry = stock.complete_receipt(self.profile.name, entry.name, draft.name, details["data"]["review"])
		self.assertTrue(retry["ok"], retry)
		self.assertEqual(self._qty(self.target), 3)

	def test_multiple_drafts_require_explicit_selection_and_do_not_duplicate_stock(self):
		entry = self._dispatch()
		first = self._draft_receipt(entry)
		second = self._draft_receipt(entry)
		self.assertFalse(
			stock.end_transit(self.profile.name, entry.name, self._review(entry)["fingerprint"])["ok"]
		)
		details = stock.receipt_details(self.profile.name, entry.name, first.name)["data"]
		response = stock.complete_receipt(self.profile.name, entry.name, first.name, details["review"])
		self.assertTrue(response["ok"], response)
		remaining = stock.receipt_details(self.profile.name, entry.name, second.name)
		self.assertTrue(remaining["ok"], remaining)
		self.assertTrue(remaining["data"]["blocking_reason"])
		self.assertFalse(
			stock.complete_receipt(self.profile.name, entry.name, second.name, remaining["data"]["review"])[
				"ok"
			]
		)
		self.assertEqual(frappe.get_doc("Stock Entry", second.name).docstatus, 0)
		self.assertEqual(self._qty(self.target), 3)

	def test_receipt_review_rejects_changed_drafts_and_cross_warehouse_access(self):
		entry = self._dispatch()
		draft = self._draft_receipt(entry)
		details = stock.receipt_details(self.profile.name, entry.name, draft.name)["data"]
		draft.remarks = "Changed after review"
		draft.save()
		self.assertFalse(
			stock.complete_receipt(self.profile.name, entry.name, draft.name, details["review"])["ok"]
		)
		self.profile.db_set("warehouse", self.source)
		self.assertFalse(stock.receipt_details(self.profile.name, entry.name, draft.name)["ok"])
		self.assertFalse(
			stock.complete_receipt(self.profile.name, entry.name, draft.name, details["review"])["ok"]
		)
		self.assertEqual(self._qty(self.target), 0)

	def test_receipt_over_allocation_is_blocked_after_another_partial_receipt(self):
		entry = self._dispatch()
		draft = self._draft_receipt(entry)
		partial = self._draft_receipt(entry)
		partial.items[0].qty = 1
		partial.save()
		partial.submit()
		details = stock.receipt_details(self.profile.name, entry.name, draft.name)
		self.assertTrue(details["ok"], details)
		self.assertFalse(details["data"]["can_submit"])
		self.assertTrue(details["data"]["blocking_reason"])
		self.assertFalse(
			stock.complete_receipt(self.profile.name, entry.name, draft.name, details["data"]["review"])["ok"]
		)
		self.assertEqual(self._qty(self.target), 1)

	def test_receipt_cannot_bypass_submit_permission(self):
		from frappe.model.document import Document

		entry = self._dispatch()
		draft = self._draft_receipt(entry)
		details = stock.receipt_details(self.profile.name, entry.name, draft.name)["data"]
		original = Document.has_permission

		def permission(doc, permtype="read", **kwargs):
			if doc.doctype == "Stock Entry" and permtype == "submit":
				return False
			return original(doc, permtype, **kwargs)

		with patch.object(Document, "has_permission", permission):
			response = stock.complete_receipt(self.profile.name, entry.name, draft.name, details["review"])
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "PermissionError")
		self.assertEqual(self._qty(self.target), 0)

	def test_receipt_workflow_requires_an_explicit_action(self):
		entry = self._dispatch()
		draft = self._draft_receipt(entry)
		workflow = frappe._dict(name="Receipt approval", workflow_state_field="stock_entry_type")
		with (
			patch("vunapos.services.stock_service.get_workflow_name", return_value="Receipt approval"),
			patch("vunapos.services.stock_service.get_workflow", return_value=workflow),
			patch("vunapos.services.stock_service.get_transitions", return_value=[]),
			patch("vunapos.services.stock_service.apply_workflow") as advance,
		):
			details = stock.receipt_details(self.profile.name, entry.name, draft.name)["data"]
			self.assertFalse(details["can_submit"])
			self.assertFalse(
				stock.complete_receipt(self.profile.name, entry.name, draft.name, details["review"])["ok"]
			)
			advance.assert_not_called()
			response = stock.complete_receipt(
				self.profile.name, entry.name, draft.name, details["review"], action="Send for approval"
			)
			self.assertTrue(response["ok"], response)
			self.assertEqual(advance.call_args.args[1], "Send for approval")
		self.assertEqual(self._qty(self.target), 0)

	def _qty(self, warehouse):
		return frappe.db.get_value("Bin", {"warehouse": warehouse, "item_code": self.item}, "actual_qty") or 0

	def test_request_uses_profile_destination_and_blank_source_even_with_no_stock(self):
		response = self._request(5000, warehouse=self.source)
		self.assertTrue(response["ok"], response)
		doc = frappe.get_doc("Material Request", response["data"]["name"])
		self.assertEqual(doc.docstatus, 1)
		self.assertEqual(doc.material_request_type, "Material Transfer")
		self.assertEqual(doc.items[0].warehouse, self.target)
		self.assertFalse(doc.items[0].from_warehouse)
		self.assertEqual(doc.vunapos_pos_profile, self.profile.name)
		self.assertEqual(self._qty(self.target), 0)

	def test_request_retry_reuses_document_but_rejects_changed_payload(self):
		key = str(uuid4())
		first, second = self._request(key=key), self._request(key=key)
		self.assertTrue(first["ok"], first)
		self.assertTrue(second["ok"], second)
		self.assertEqual(first["data"]["name"], second["data"]["name"])
		self.assertFalse(self._request(qty=4, key=key)["ok"])

	def test_request_notes_are_preserved_in_native_terms(self):
		response = stock.create_request(
			self.profile.name,
			[{"item_code": self.item, "qty": 1}],
			nowdate(),
			str(uuid4()),
			notes="Handle <fragile>\nDeliver to back door",
		)
		self.assertTrue(response["ok"], response)
		doc = frappe.get_doc("Material Request", response["data"]["name"])
		self.assertIn("fragile", doc.terms)
		self.assertIn("Deliver to back door", doc.terms)

	def test_request_workflow_does_not_auto_submit(self):
		workflow = frappe._dict(
			name="Request approval",
			workflow_state_field="status",
			transitions=[
				frappe._dict(
					state="Draft",
					action="Send for approval",
					next_state="Pending",
					allowed="System Manager",
					condition="",
					allow_self_approval=1,
				),
				frappe._dict(
					state="Draft",
					action="Large request",
					next_state="Pending",
					allowed="System Manager",
					condition="doc.get('items')[0].qty > 100",
					allow_self_approval=1,
				),
				frappe._dict(
					state="Draft",
					action="Other role",
					next_state="Pending",
					allowed="_Unassigned Stock Role",
					condition="",
					allow_self_approval=1,
				),
			],
		)
		workflow.transitions = [
			frappe.get_doc({"doctype": "Workflow Transition", **row}) for row in workflow.transitions
		]
		with (
			patch("vunapos.services.stock_service.get_workflow_name", return_value=workflow.name),
			patch("vunapos.services.stock_service.get_workflow", return_value=workflow),
			patch("vunapos.services.stock_service.apply_workflow") as advance,
		):
			response = self._request()
			advance.assert_not_called()
		self.assertTrue(response["ok"], response)
		self.assertEqual(response["data"]["docstatus"], 0)
		self.assertEqual(response["data"]["workflow"]["state"], "Draft")
		self.assertEqual(
			response["data"]["workflow"]["actions"],
			[{"action": "Send for approval", "next_state": "Pending"}],
		)

	def test_request_workflow_action_revalidates_scope_and_version(self):
		name = stock.create_request(
			self.profile.name,
			[{"item_code": self.item, "qty": 1, "uom": self.uom}],
			nowdate(),
			"workflow-held",
			hold=True,
		)["data"]["name"]
		frappe.db.set_value("Material Request", name, "vunapos_stock_request_held", 0)
		doc = frappe.get_doc("Material Request", name)
		with (
			patch("vunapos.services.stock_service.get_workflow_name", return_value="Request approval"),
			patch("vunapos.services.stock_service._stock_result", return_value={"name": name}),
			patch("vunapos.services.stock_service.apply_workflow") as advance,
		):
			self.assertFalse(stock.request_workflow_action(self.profile.name, name, "Approve", "stale")["ok"])
			advance.assert_not_called()
			response = stock.request_workflow_action(self.profile.name, name, "Approve", str(doc.modified))
			self.assertTrue(response["ok"], response)
			self.assertEqual(advance.call_args.args[1], "Approve")
			frappe.db.set_value("Material Request", name, "vunapos_pos_profile", "")
			advance.reset_mock()
			self.assertFalse(
				stock.request_workflow_action(self.profile.name, name, "Approve", str(doc.modified))["ok"]
			)
			advance.assert_not_called()

	def test_profile_item_groups_are_enforced_on_search_and_creation(self):
		root = frappe.db.get_value("Item Group", {"is_group": 1}, "name")
		group = frappe.get_doc(
			{
				"doctype": "Item Group",
				"item_group_name": f"_Test Request Only {self.token}",
				"parent_item_group": root,
			}
		).insert()
		self.profile.append("item_groups", {"item_group": group.name})
		self.profile.save()
		frappe.clear_document_cache("POS Profile", self.profile.name)
		self.assertEqual(stock.catalogue(self.profile.name, self.item)["data"], [])
		self.assertFalse(stock.scan_request_item(self.profile.name, self.item)["ok"])
		self.assertFalse(self._request()["ok"])

	def test_invalid_quantity_and_uom_are_rejected(self):
		for qty in (0, -1, float("nan"), True):
			self.assertFalse(self._request(qty)["ok"])
		self.assertFalse(self._request(uom="UNCONFIGURED-UOM")["ok"])

	def test_list_and_receive_use_material_request_target_not_transit_warehouse(self):
		entry = self._dispatch()
		listing = stock.list_transit(self.profile.name)
		self.assertTrue(listing["ok"], listing)
		self.assertIn(entry.name, [row["name"] for row in listing["data"]])
		details = stock.stock_entry_details(self.profile.name, entry.name)
		self.assertTrue(details["ok"], details)
		self.assertEqual(details["data"]["status"], "Awaiting receipt")
		self.assertEqual(details["data"]["items"][0]["remaining_qty"], 3)
		request_name = entry.items[0].material_request
		request_details = stock.request_details(self.profile.name, request_name)
		self.assertTrue(request_details["ok"], request_details)
		self.assertIn(entry.name, [row["name"] for row in request_details["data"]["transfers"]])
		quote = self._review(entry)
		self.assertEqual(quote["warehouse"], self.target)
		result = stock.end_transit(self.profile.name, entry.name, quote["fingerprint"])
		self.assertTrue(result["ok"], result)
		receipt = frappe.get_doc("Stock Entry", result["data"]["name"])
		self.assertEqual(receipt.docstatus, 1)
		self.assertEqual(receipt.outgoing_stock_entry, entry.name)
		self.assertEqual(receipt.items[0].ste_detail, entry.items[0].name)
		self.assertEqual(receipt.items[0].t_warehouse, self.target)
		self.assertEqual(self._qty(self.target), 3)
		self.assertEqual(self._qty(self.transit), 0)
		completed = stock.stock_entry_details(self.profile.name, entry.name)
		self.assertTrue(completed["ok"], completed)
		self.assertEqual(completed["data"]["status"], "Received")
		self.assertIsNone(completed["data"]["fingerprint"])
		self.assertEqual(completed["data"]["items"][0]["remaining_qty"], 0)
		self.assertIn(receipt.name, [row["name"] for row in completed["data"]["receipts"]])
		listing = stock.list_transit(self.profile.name)["data"]
		self.assertEqual([row["name"] for row in listing], [entry.name])
		self.assertEqual(listing[0]["receipt_status"], "Received")
		self.assertEqual(stock.list_transit(self.profile.name, progress="unreceived")["data"], [])
		self.assertEqual(stock.list_transit(self.profile.name, progress="partial")["data"], [])
		retry = stock.end_transit(self.profile.name, entry.name, quote["fingerprint"])
		self.assertTrue(retry["ok"], retry)
		self.assertEqual(retry["data"]["name"], receipt.name)
		self.assertEqual(self._qty(self.target), 3)

	def test_received_history_excludes_desk_only_receipts_but_keeps_pos_completed_desk_drafts(self):
		entry = self._dispatch()
		draft = self._draft_receipt(entry)
		draft.submit()
		self.assertEqual(stock.list_transit(self.profile.name)["data"], [])
		self.assertEqual(stock.list_transit(self.profile.name, progress="received")["data"], [])
		# Merely opening/retrying a Desk-completed receipt must not claim it was received in POS.
		result = stock.complete_receipt(self.profile.name, entry.name, draft.name, "already-submitted")
		self.assertTrue(result["ok"], result)
		self.assertFalse(frappe.db.get_value("Stock Entry", draft.name, "vunapos_stock_receipt_key"))
		other = self._dispatch()
		pending = self._draft_receipt(other)
		state = stock.receipt_details(self.profile.name, other.name, pending.name)["data"]
		result = stock.complete_receipt(self.profile.name, other.name, pending.name, state["review"])
		self.assertTrue(result["ok"], result)
		self.assertTrue(frappe.db.get_value("Stock Entry", pending.name, "vunapos_received_in_pos"))
		self.assertFalse(frappe.db.get_value("Stock Entry", pending.name, "vunapos_created_in_pos"))
		self.assertFalse(frappe.db.get_value("Stock Entry", pending.name, "vunapos_stock_receipt_key"))
		history = stock.list_transit(self.profile.name, progress="received")["data"]
		self.assertEqual([row.name for row in history], [other.name])
		self.assertEqual(history[0].receipt_status, "Received")
		# Cancelled receipts no longer qualify as received stock.
		frappe.get_doc("Stock Entry", pending.name).cancel()
		self.assertEqual(stock.list_transit(self.profile.name, progress="received")["data"], [])
		self.assertEqual(stock.list_transit(self.profile.name)["data"][0].receipt_status, "Awaiting receipt")

	def test_received_history_remains_scoped_to_profile_warehouse_and_filters(self):
		entry = self._dispatch()
		quote = self._review(entry)
		result = stock.end_transit(self.profile.name, entry.name, quote["fingerprint"])
		self.assertTrue(result["ok"], result)
		listed = stock.list_transit(
			self.profile.name, progress="received", query=entry.name, from_date=nowdate(), to_date=nowdate()
		)
		self.assertTrue(listed["ok"], listed)
		self.assertEqual([row.name for row in listed["data"]], [entry.name])
		self.assertEqual(
			stock.list_transit(self.profile.name, progress="received", query="no-match")["data"], []
		)
		self.profile.db_set("warehouse", self.source)
		self.assertEqual(stock.list_transit(self.profile.name, progress="received")["data"], [])

	def test_stock_origin_checks_are_read_only_and_material_requests_track_pos_creation(self):
		for doctype, fields in (
			("Material Request", ("vunapos_created_in_pos",)),
			("Stock Entry", ("vunapos_created_in_pos", "vunapos_received_in_pos")),
		):
			for name in fields:
				field = frappe.get_meta(doctype).get_field(name)
				self.assertEqual(field.fieldtype, "Check")
				self.assertTrue(field.read_only)
				self.assertTrue(field.no_copy)
				self.assertTrue(field.allow_on_submit)
				self.assertTrue(field.in_standard_filter)
		request_fields = [f.fieldname for f in frappe.get_meta("Material Request").fields]
		stock_fields = [f.fieldname for f in frappe.get_meta("Stock Entry").fields]
		self.assertLess(request_fields.index("more_info_tab"), request_fields.index("vunapos_created_in_pos"))
		self.assertLess(stock_fields.index("other_info_tab"), stock_fields.index("vunapos_created_in_pos"))
		self.assertEqual(
			stock_fields.index("vunapos_created_in_pos") + 1, stock_fields.index("vunapos_received_in_pos")
		)
		request = self._request()
		self.assertTrue(request["ok"], request)
		self.assertTrue(request["data"]["created_in_pos"])
		self.assertTrue(
			frappe.db.get_value("Material Request", request["data"]["name"], "vunapos_created_in_pos")
		)
		self.assertEqual(frappe.new_doc("Material Request").vunapos_created_in_pos, 0)

	def test_stock_origin_checks_distinguish_creation_from_receiving_and_ignore_retry_keys(self):
		entry = self._dispatch()
		quote = self._review(entry)
		with patch("vunapos.services.stock_service.get_workflow_name", return_value="Stock approval"):
			result = stock.end_transit(self.profile.name, entry.name, quote["fingerprint"])
		self.assertTrue(result["ok"], result)
		receipt = frappe.get_doc("Stock Entry", result["data"]["name"])
		self.assertEqual(receipt.docstatus, 0)
		self.assertTrue(receipt.vunapos_created_in_pos)
		self.assertFalse(receipt.vunapos_received_in_pos)
		# Desk approval does not claim the receipt was submitted in POS.
		receipt.submit()
		self.assertFalse(frappe.get_doc("Stock Entry", receipt.name).vunapos_received_in_pos)
		# Listing relies on explicit checks, not the presence of a retry key.
		receipt.db_set(
			{"vunapos_stock_receipt_key": None, "vunapos_stock_receipt_fingerprint": None},
			update_modified=False,
		)
		self.assertEqual(
			stock.list_transit(self.profile.name, progress="received")["data"][0].name, entry.name
		)

	def test_stock_origin_backfill_is_conservative_and_idempotent(self):
		from vunapos.patches.v1_0.backfill_stock_pos_origins import backfill
		from vunapos.services.stock_service import fingerprint

		entry = self._dispatch()
		quote = self._review(entry)
		response = stock.end_transit(self.profile.name, entry.name, quote["fingerprint"])
		self.assertTrue(response["ok"], response)
		receipt = frappe.get_doc("Stock Entry", response["data"]["name"])
		self.assertTrue(receipt.vunapos_created_in_pos)
		self.assertTrue(receipt.vunapos_received_in_pos)
		request = entry.items[0].material_request
		frappe.db.set_value("Material Request", request, "vunapos_created_in_pos", 0, update_modified=False)
		receipt.db_set({"vunapos_created_in_pos": 0, "vunapos_received_in_pos": 0}, update_modified=False)
		modified = str(receipt.modified)
		other = self._dispatch()
		legacy = self._draft_receipt(other)
		legacy.submit()
		legacy.db_set(
			"vunapos_stock_receipt_key", fingerprint(["completed-in-pos", legacy.name]), update_modified=False
		)
		backfill()
		backfill()
		receipt.reload()
		legacy.reload()
		self.assertTrue(frappe.db.get_value("Material Request", request, "vunapos_created_in_pos"))
		self.assertTrue(receipt.vunapos_created_in_pos)
		self.assertFalse(receipt.vunapos_received_in_pos)
		self.assertEqual(str(receipt.modified), modified)
		self.assertFalse(legacy.vunapos_created_in_pos)
		self.assertTrue(legacy.vunapos_received_in_pos)

	def test_stock_history_filters_apply_before_pagination(self):
		entry = self._dispatch()
		self.assertTrue(
			stock.list_transit(
				self.profile.name,
				query=entry.name,
				from_date=nowdate(),
				to_date=nowdate(),
				progress="unreceived",
			)["data"]
		)
		self.assertEqual(stock.list_transit(self.profile.name, query="no-match")["data"], [])
		self.assertEqual(stock.list_transit(self.profile.name, transit_warehouse="no-match")["data"], [])
		self.assertEqual(stock.list_transit(self.profile.name, progress="partial")["data"], [])
		self.assertFalse(
			stock.list_transit(self.profile.name, from_date="2030-01-01", to_date="2020-01-01")["ok"]
		)
		self.assertTrue(
			stock.list_requests(self.profile.name, docstatus="1", from_date=nowdate(), to_date=nowdate())[
				"data"
			]
		)
		self.assertEqual(stock.list_requests(self.profile.name, docstatus="0")["data"], [])
		self.assertFalse(stock.list_requests(self.profile.name, docstatus="999")["ok"])
		self.profile.db_set("warehouse", self.source)
		self.assertFalse(stock.stock_entry_details(self.profile.name, entry.name)["ok"])

	def test_partial_receipt_keeps_remainder_and_reuses_retry_key(self):
		entry = self._dispatch(qty=5)
		quote = self._review(entry)
		quantities = [{"source_row": entry.items[0].name, "qty": 2, "uom": self.uom}]
		response = stock.end_transit(
			self.profile.name, entry.name, quote["fingerprint"], quantities, "partial-first"
		)
		self.assertTrue(response["ok"], response)
		self.assertEqual(self._qty(self.target), 2)
		self.assertEqual(self._qty(self.transit), 3)
		retry = stock.end_transit(
			self.profile.name, entry.name, quote["fingerprint"], quantities, "partial-first"
		)
		self.assertTrue(retry["ok"], retry)
		self.assertEqual(retry["data"]["name"], response["data"]["name"])
		self.assertEqual(self._qty(self.target), 2)
		self.assertFalse(
			stock.end_transit(
				self.profile.name,
				entry.name,
				quote["fingerprint"],
				[{**quantities[0], "qty": 1}],
				"partial-first",
			)["ok"]
		)
		fresh = self._review(entry)
		self.assertEqual(fresh["items"][0]["stock_qty"], 3)
		second = stock.end_transit(
			self.profile.name,
			entry.name,
			fresh["fingerprint"],
			[{**quantities[0], "qty": 3}],
			"partial-second",
		)
		self.assertTrue(second["ok"], second)
		self.assertEqual(self._qty(self.target), 5)

	def test_invalid_partial_receipt_quantities_do_not_move_stock(self):
		entry = self._dispatch()
		quote = self._review(entry)
		for qty in (0, -1, 4, float("nan"), True):
			response = stock.end_transit(
				self.profile.name,
				entry.name,
				quote["fingerprint"],
				[{"source_row": entry.items[0].name, "qty": qty}],
				str(uuid4()),
			)
			self.assertFalse(response["ok"], response)
		self.assertFalse(
			stock.end_transit(
				self.profile.name,
				entry.name,
				quote["fingerprint"],
				[{"source_row": "unknown", "qty": 1}],
				str(uuid4()),
			)["ok"]
		)
		self.assertEqual(self._qty(self.target), 0)

	def test_zero_accepted_row_is_left_in_transit(self):
		other = frappe.get_doc("Material Request", self._request(qty=2)["data"]["name"])
		entry = self._dispatch(
			extra={
				"item_code": self.item,
				"qty": 2,
				"s_warehouse": self.source,
				"t_warehouse": self.transit,
				"material_request": other.name,
				"material_request_item": other.items[0].name,
			}
		)
		quote = self._review(entry)
		response = stock.end_transit(
			self.profile.name,
			entry.name,
			quote["fingerprint"],
			[{"source_row": entry.items[0].name, "qty": 1}, {"source_row": entry.items[1].name, "qty": 0}],
			"zero-row",
		)
		self.assertTrue(response["ok"], response)
		receipt = frappe.get_doc("Stock Entry", response["data"]["name"])
		self.assertEqual(len(receipt.items), 1)
		self.assertEqual(self._qty(self.target), 1)
		self.assertEqual(self._qty(self.transit), 4)

	def test_partial_receipt_can_use_stock_uom_instead_of_whole_cartons(self):
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

		case = f"_Test Receive Case {self.token}"
		frappe.get_doc({"doctype": "UOM", "uom_name": case, "must_be_whole_number": 1}).insert()
		item = frappe.get_doc("Item", self.item)
		item.append("uoms", {"uom": case, "conversion_factor": 24})
		item.save()
		request = frappe.get_doc("Material Request", self._request(qty=48)["data"]["name"])
		make_stock_entry(item_code=self.item, to_warehouse=self.source, qty=48, rate=100)
		entry = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"stock_entry_type": "Material Transfer",
				"company": self.company,
				"add_to_transit": 1,
				"from_warehouse": self.source,
				"to_warehouse": self.transit,
				"items": [
					{
						"item_code": self.item,
						"qty": 2,
						"uom": case,
						"conversion_factor": 24,
						"s_warehouse": self.source,
						"t_warehouse": self.transit,
						"material_request": request.name,
						"material_request_item": request.items[0].name,
					}
				],
			}
		).insert()
		entry.submit()
		quote = self._review(entry)
		response = stock.end_transit(
			self.profile.name,
			entry.name,
			quote["fingerprint"],
			[{"source_row": entry.items[0].name, "qty": 25, "uom": self.uom}],
			"stock-uom",
		)
		self.assertTrue(response["ok"], response)
		self.assertEqual(self._qty(self.target), 25)
		self.assertEqual(self._qty(self.transit), 23)
		fresh = self._review(entry)
		response = stock.end_transit(
			self.profile.name,
			entry.name,
			fresh["fingerprint"],
			[{"source_row": entry.items[0].name, "qty": 23, "uom": self.uom}],
			"stock-uom-rest",
		)
		self.assertTrue(response["ok"], response)
		self.assertEqual(self._qty(self.target), 48)

	def test_receipt_workflow_stays_draft_and_retry_does_not_duplicate_it(self):
		entry = self._dispatch()
		quote = self._review(entry)
		with patch("vunapos.services.stock_service.get_workflow_name", return_value="Approval required"):
			first = stock.end_transit(self.profile.name, entry.name, quote["fingerprint"])
			second = stock.end_transit(self.profile.name, entry.name, quote["fingerprint"])
		self.assertTrue(first["ok"], first)
		self.assertTrue(second["ok"], second)
		self.assertEqual(first["data"]["docstatus"], 0)
		self.assertEqual(first["data"]["name"], second["data"]["name"])
		self.assertEqual(self._qty(self.target), 0)

	def test_mixed_destination_transfer_receives_only_this_profiles_rows(self):
		other = self._warehouse("Other Target")
		request = frappe.get_doc(
			{
				"doctype": "Material Request",
				"material_request_type": "Material Transfer",
				"company": self.company,
				"schedule_date": nowdate(),
				"items": [{"item_code": self.item, "qty": 2, "warehouse": other, "schedule_date": nowdate()}],
			}
		).insert()
		request.submit()
		entry = self._dispatch(
			extra={
				"item_code": self.item,
				"qty": 2,
				"s_warehouse": self.source,
				"t_warehouse": self.transit,
				"material_request": request.name,
				"material_request_item": request.items[0].name,
			}
		)
		quote = self._review(entry)
		self.assertEqual(len(quote["items"]), 1)
		details = stock.stock_entry_details(self.profile.name, entry.name)
		self.assertTrue(details["ok"], details)
		self.assertEqual(len(details["data"]["items"]), 1)
		self.assertTrue(details["data"]["has_other_warehouses"])
		result = stock.end_transit(self.profile.name, entry.name, quote["fingerprint"])
		self.assertTrue(result["ok"], result)
		self.assertEqual(self._qty(self.target), 3)
		self.assertEqual(self._qty(other), 0)
		self.assertEqual(self._qty(self.transit), 2)
		self.profile.db_set("warehouse", other)
		listing = stock.list_transit(self.profile.name, progress="unreceived")
		self.assertTrue(listing["ok"], listing)
		self.assertEqual(listing["data"][0]["receipt_status"], "Awaiting receipt")
		other_details = stock.stock_entry_details(self.profile.name, entry.name)
		self.assertTrue(other_details["ok"], other_details)
		self.assertEqual(other_details["data"]["status"], listing["data"][0]["receipt_status"])
		# Receiving the other warehouse in Desk must not borrow this warehouse's POS origin.
		desk_receipt = self._draft_receipt(entry)
		desk_receipt.submit()
		self.assertEqual(stock.list_transit(self.profile.name, progress="received")["data"], [])
		self.profile.db_set("warehouse", self.target)
		history = stock.list_transit(self.profile.name, progress="received")["data"]
		self.assertEqual([row.name for row in history], [entry.name])
		self.assertEqual(history[0].receipt_status, "Received")

	def test_stale_review_is_rejected_after_native_partial_receipt(self):
		from erpnext.stock.doctype.stock_entry.stock_entry import make_stock_in_entry

		entry = self._dispatch()
		quote = self._review(entry)
		partial = make_stock_in_entry(entry.name)
		partial.items[0].qty = 1
		partial.insert()
		partial.submit()
		listing = stock.list_transit(self.profile.name, progress="partial")
		self.assertTrue(listing["ok"], listing)
		self.assertEqual(listing["data"][0]["receipt_status"], "Partially received")
		details = stock.stock_entry_details(self.profile.name, entry.name)
		self.assertTrue(details["ok"], details)
		self.assertEqual(details["data"]["status"], "Partially received")
		self.assertFalse(stock.end_transit(self.profile.name, entry.name, quote["fingerprint"])["ok"])
		fresh = self._review(entry)
		self.assertEqual(fresh["items"][0]["stock_qty"], 2)
		response = stock.end_transit(self.profile.name, entry.name, fresh["fingerprint"])
		self.assertTrue(response["ok"], response)
		self.assertEqual(self._qty(self.target), 3)

	def test_cashier_without_stock_permissions_cannot_create_or_receive(self):
		entry = self._dispatch()
		quote = self._review(entry)
		user = f"stock-cashier-{self.token}@example.test"
		frappe.get_doc(
			{
				"doctype": "User",
				"email": user,
				"first_name": "Stock permission test",
				"send_welcome_email": 0,
				"roles": [{"role": "Sales User"}],
			}
		).insert()
		self.profile.append("applicable_for_users", {"user": user})
		self.profile.save()
		opening = frappe.get_doc(
			{
				"doctype": "POS Opening Entry",
				"company": self.company,
				"pos_profile": self.profile.name,
				"user": user,
				"period_start_date": frappe.utils.now_datetime(),
				"balance_details": [
					{"mode_of_payment": row.mode_of_payment} for row in self.profile.payments
				],
			}
		)
		opening.submit()
		frappe.set_user(user)
		response = self._request()
		self.assertFalse(response["ok"], response)
		self.assertEqual(response["errors"][0]["code"], "PermissionError")
		self.assertFalse(stock.end_transit(self.profile.name, entry.name, quote["fingerprint"])["ok"])

	def test_request_sales_uom_is_converted_to_stock_quantity(self):
		uom = f"_Test Request Case {self.token}"
		frappe.get_doc({"doctype": "UOM", "uom_name": uom, "must_be_whole_number": 1}).insert()
		item = frappe.get_doc("Item", self.item)
		item.append("uoms", {"uom": uom, "conversion_factor": 24})
		item.save()
		response = self._request(qty=2, uom=uom)
		self.assertTrue(response["ok"], response)
		request = frappe.get_doc("Material Request", response["data"]["name"])
		self.assertEqual(request.items[0].stock_qty, 48)

	def _tracked_receipt(self, serial=False, resume=False, partial=False):
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry

		from vunapos.tests.helpers import ensure_test_batch_item

		frappe.db.set_single_value("Stock Settings", "use_serial_batch_fields", 0)
		self.item = ensure_test_batch_item(f"_Test Transit Tracked {self.token}", has_serial_no=int(serial))
		self.uom = frappe.get_cached_value("Item", self.item, "stock_uom")
		batch = frappe.get_doc(
			{"doctype": "Batch", "batch_id": f"TRANSIT-{self.token}", "item": self.item}
		).insert()
		serials = [f"TR-{self.token}-{i}" for i in range(3)] if serial else []
		for number in serials:
			frappe.get_doc(
				{"doctype": "Serial No", "serial_no": number, "item_code": self.item, "batch_no": batch.name}
			).insert()
		make_stock_entry(
			item_code=self.item,
			to_warehouse=self.source,
			qty=3,
			rate=100,
			batch_no=batch.name,
			serial_no=serials,
		)
		requested = self._request()
		self.assertTrue(requested["ok"], requested)
		request = frappe.get_doc("Material Request", requested["data"]["name"])
		entry = make_stock_entry(
			item_code=self.item,
			from_warehouse=self.source,
			to_warehouse=self.transit,
			qty=3,
			rate=100,
			batch_no=batch.name,
			serial_no=serials,
			add_to_transit=1,
			do_not_save=True,
		)
		entry.items[0].material_request = request.name
		entry.items[0].material_request_item = request.items[0].name
		entry.insert()
		entry.submit()
		quote = self._review(entry)
		if partial:
			response = stock.end_transit(
				self.profile.name,
				entry.name,
				quote["fingerprint"],
				[{"source_row": entry.items[0].name, "qty": 1}],
				"tracked-first",
			)
			if serial:
				self.assertFalse(response["ok"], response)
				self.assertIn("exact batches or serial", response["errors"][0]["message"])
				self.assertEqual(self._qty(self.target), 0)
				response = stock.end_transit(self.profile.name, entry.name, quote["fingerprint"])
			else:
				self.assertTrue(response["ok"], response)
				self.assertEqual(self._qty(self.target), 1)
				fresh = self._review(entry)
				self.assertEqual(fresh["items"][0]["stock_qty"], 2)
				response = stock.end_transit(
					self.profile.name,
					entry.name,
					fresh["fingerprint"],
					[{"source_row": entry.items[0].name, "qty": 2}],
					"tracked-rest",
				)
		elif resume:
			draft = self._draft_receipt(entry)
			details = stock.receipt_details(self.profile.name, entry.name, draft.name)
			self.assertTrue(details["ok"], details)
			response = stock.complete_receipt(
				self.profile.name, entry.name, draft.name, details["data"]["review"]
			)
		else:
			response = stock.end_transit(self.profile.name, entry.name, quote["fingerprint"])
		self.assertTrue(response["ok"], response)
		receipt = frappe.get_doc("Stock Entry", response["data"]["name"])
		self.assertEqual(self._qty(self.target), 3)
		bundle = frappe.get_doc("Serial and Batch Bundle", receipt.items[0].serial_and_batch_bundle)
		self.assertEqual({row.batch_no for row in bundle.entries}, {batch.name})
		if serial:
			self.assertEqual({row.serial_no for row in bundle.entries}, set(serials))

	def test_end_transit_preserves_native_batch_bundle(self):
		self._tracked_receipt()

	def test_end_transit_preserves_native_serial_and_batch_bundle(self):
		self._tracked_receipt(serial=True)

	def test_existing_draft_receipt_preserves_native_batch_bundle(self):
		self._tracked_receipt(resume=True)

	def test_existing_draft_receipt_preserves_native_serial_and_batch_bundle(self):
		self._tracked_receipt(serial=True, resume=True)

	def test_partial_batch_receipts_preserve_tracking_across_receipts(self):
		self._tracked_receipt(partial=True)

	def test_partial_serial_receipt_requires_exact_identifier_selection(self):
		self._tracked_receipt(serial=True, partial=True)
