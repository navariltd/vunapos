import frappe


def customer_to_dict(customer):
	default_price_list = customer.get("default_price_list")
	if not default_price_list and customer.get("customer_group"):
		default_price_list = frappe.get_cached_value(
			"Customer Group", customer.get("customer_group"), "default_price_list"
		)
	return {
		"customer": customer.name,
		"customer_name": customer.customer_name,
		"mobile_no": customer.get("mobile_no"),
		"email_id": customer.get("email_id"),
		"customer_group": customer.get("customer_group"),
		"default_price_list": default_price_list,
		"is_walkin": bool(customer.get("is_walkin")),
		"tax_id": customer.get("tax_id"),
		"modified": customer.get("modified"),
	}
