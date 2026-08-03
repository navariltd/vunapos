import frappe

FIELDS = (
	"vunapos_allow_order_type_change",
	"vunapos_allow_customer_management",
	"vunapos_allow_customer_creation",
	"vunapos_allow_customer_payments",
	"vunapos_allow_payment_reconciliation",
	"vunapos_allow_payment_history",
)


def execute():
	if not frappe.db.table_exists("POS Profile"):
		return
	existing_fields = [field for field in FIELDS if frappe.db.has_column("POS Profile", field)]
	if not existing_fields:
		return
	for name in frappe.get_all("POS Profile", pluck="name"):
		frappe.db.set_value(
			"POS Profile",
			name,
			{field: 1 for field in existing_fields},
			update_modified=False,
		)
