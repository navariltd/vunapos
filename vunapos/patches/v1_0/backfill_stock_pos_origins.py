"""Separate stock origin metadata from retry keys without guessing old submission channels."""

import frappe


def execute():
	from vunapos.setup.utils import ensure_vunapos_custom_fields

	ensure_vunapos_custom_fields()
	backfill()


def backfill():
	from vunapos.services.stock_service import fingerprint

	for request in frappe.get_all(
		"Material Request",
		filters={
			"vunapos_stock_request_key": ["is", "set"],
			"vunapos_pos_profile": ["is", "set"],
			"vunapos_created_in_pos": 0,
		},
		pluck="name",
	):
		frappe.db.set_value("Material Request", request, "vunapos_created_in_pos", 1, update_modified=False)
	for receipt in frappe.get_all(
		"Stock Entry",
		filters={
			"vunapos_stock_receipt_key": ["is", "set"],
			"outgoing_stock_entry": ["is", "set"],
			"purpose": "Material Transfer",
			"add_to_transit": 0,
		},
		fields=[
			"name",
			"vunapos_stock_receipt_key",
			"vunapos_stock_receipt_fingerprint",
			"vunapos_created_in_pos",
			"vunapos_received_in_pos",
		],
	):
		updates = {}
		if receipt.vunapos_stock_receipt_fingerprint and not receipt.vunapos_created_in_pos:
			updates["vunapos_created_in_pos"] = 1
		# This specific legacy marker was assigned only after submission succeeded in POS.
		if (
			receipt.vunapos_stock_receipt_key == fingerprint(["completed-in-pos", receipt.name])
			and not receipt.vunapos_received_in_pos
		):
			updates["vunapos_received_in_pos"] = 1
		if updates:
			frappe.db.set_value("Stock Entry", receipt.name, updates, update_modified=False)
