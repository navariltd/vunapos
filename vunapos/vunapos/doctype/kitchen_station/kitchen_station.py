import frappe
from frappe.model.document import Document


def on_doctype_update():
	frappe.db.add_unique("Kitchen Station", ["restaurant", "station_name"], "unique_restaurant_station_name")


class KitchenStation(Document):
	def validate(self):
		from vunapos.services.kitchen_service import validate_station

		validate_station(self)
