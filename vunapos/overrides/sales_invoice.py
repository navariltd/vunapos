from vunapos.services.stock_reservation_service import release_invoice_stock_reservations


class VunaPOSSalesInvoiceReservationMixin:
	def before_submit(self):
		super().before_submit()
		release_invoice_stock_reservations(self)
