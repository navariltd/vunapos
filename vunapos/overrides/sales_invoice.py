from vunapos.services.stock_reservation_service import release_invoice_stock_reservations


class VunaPOSSalesInvoiceReservationMixin:
	def before_submit(self):
		super().before_submit()
		release_invoice_stock_reservations(self)

	def update_stock_reservation_entries(self):
		if not self.get("is_consolidated") or self.get("is_return"):
			return super().update_stock_reservation_entries()
		from vunapos.services.restaurant_billing_service import consolidated_reservation_sources

		# POS source links are deliberately no_copy during native consolidation:
		# persisting them would count the sale twice against the Sales Order.
		# Restore verified links ONLY for the native stock-reservation update,
		# after billing status updates and before the actual stock ledger issue.
		originals = []
		try:
			for row, order, detail in consolidated_reservation_sources(self):
				originals.append((row, row.sales_order, row.so_detail))
				row.sales_order, row.so_detail = order, detail
			return super().update_stock_reservation_entries()
		finally:
			for row, order, detail in originals:
				row.sales_order, row.so_detail = order, detail
