import frappe
from frappe.model.document import Document


def on_doctype_update():
	# Check the current site's index directly. Avoid an information_schema
	# constraint-name lookup accidentally matching another site in this bench.
	if not frappe.db.has_index("tabKitchen Station", "unique_restaurant_branch_station_name"):
		query = (
			'ALTER TABLE "tabKitchen Station" ADD CONSTRAINT "unique_restaurant_branch_station_name" UNIQUE ("restaurant", "branch", "station_name")'
			if frappe.db.db_type == "postgres"
			else "ALTER TABLE `tabKitchen Station` ADD CONSTRAINT `unique_restaurant_branch_station_name` UNIQUE (`restaurant`, `branch`, `station_name`)"
		)
		frappe.db.sql_ddl(query)
	# Schema migration only: replace the old Restaurant-wide constraint after
	# its location-aware replacement exists. Never run DDL during sales.
	if frappe.db.has_index("tabKitchen Station", "unique_restaurant_station_name"):
		query = (
			'ALTER TABLE "tabKitchen Station" DROP CONSTRAINT "unique_restaurant_station_name"'
			if frappe.db.db_type == "postgres"
			else "ALTER TABLE `tabKitchen Station` DROP INDEX `unique_restaurant_station_name`"
		)
		frappe.db.sql_ddl(query)


class KitchenStation(Document):
	def validate(self):
		from vunapos.services.kitchen_service import validate_station

		validate_station(self)
