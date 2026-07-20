import frappe
from frappe import _


class VunaPOSClosingEntryMixin:
	"""Allow VunaPOS Sales Invoices in ERPNext's native closing-entry table."""

	def validate_sales_invoices(self):
		invalid_rows = []
		for row in self.sales_invoices:
			invalid_row = {"idx": row.idx, "msg": []}
			invoice = frappe.db.get_value(
				"Sales Invoice",
				row.sales_invoice,
				[
					"pos_profile",
					"docstatus",
					"is_pos",
					"owner",
					"is_created_using_pos",
					"pos_closing_entry",
					"vunapos_invoice",
					"vunapos_opening_entry",
					"vunapos_closing_entry",
				],
				as_dict=True,
			)

			if not invoice:
				invalid_row["msg"].append(_("Sales Invoice does not exist"))
			else:
				is_vunapos = bool(invoice.vunapos_invoice)
				if invoice.pos_closing_entry or invoice.vunapos_closing_entry:
					invalid_row["msg"].append(_("Sales Invoice is already included in a POS closing entry"))
				if not invoice.is_pos:
					invalid_row["msg"].append(_("Sales Invoice does not have Payments"))
				if not invoice.is_created_using_pos and not is_vunapos:
					invalid_row["msg"].append(_("Sales Invoice is not created using ERPNext POS or VunaPOS"))
				if invoice.pos_profile != self.pos_profile:
					invalid_row["msg"].append(
						_("POS Profile doesn't match {0}").format(frappe.bold(self.pos_profile))
					)
				if invoice.docstatus != 1:
					invalid_row["msg"].append(_("Sales Invoice is not submitted"))
				if invoice.owner != self.user:
					invalid_row["msg"].append(
						_("Sales Invoice isn't created by user {0}").format(frappe.bold(self.user))
					)
				if is_vunapos and invoice.vunapos_opening_entry != self.pos_opening_entry:
					invalid_row["msg"].append(_("Sales Invoice belongs to a different VunaPOS session"))

			if invalid_row["msg"]:
				invalid_rows.append(invalid_row)

		if invalid_rows:
			errors = [
				_("Row #{0}: {1}").format(row["idx"], message)
				for row in invalid_rows
				for message in row["msg"]
			]
			frappe.throw(errors, title=_("Invalid Sales Invoices"), as_list=True)
