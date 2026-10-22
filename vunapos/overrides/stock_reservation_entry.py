import frappe


class VunaPOSStockReservationEntryMixin:
	"""Allow VunaPOS draft Sales Invoices to hold native stock reservations.

	ERPNext validates that every reservation voucher is submitted. VunaPOS
	intentionally reserves stock while its invoice is still draft (including
	queued/background checkout) so another cashier cannot sell the same stock.
	Keep ERPNext's validation for every other voucher and for non-VunaPOS
	Sales Invoices.
	"""

	def validate_voucher(self) -> None:
		if self._allows_vunapos_draft_sales_invoice():
			return
		super().validate_voucher()

	def _allows_vunapos_draft_sales_invoice(self) -> bool:
		if self.voucher_type != "Sales Invoice" or not self.voucher_no:
			return False

		fields = ["docstatus", "vunapos_invoice"]
		if not frappe.db.has_column("Sales Invoice", "vunapos_invoice"):
			return False
		voucher = frappe.db.get_value("Sales Invoice", self.voucher_no, fields, as_dict=True)
		return bool(voucher and not voucher.docstatus and voucher.vunapos_invoice)
