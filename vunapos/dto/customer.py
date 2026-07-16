def customer_to_dict(customer):
	return {
		"customer": customer.name,
		"customer_name": customer.customer_name,
		"mobile_no": customer.get("mobile_no"),
		"email_id": customer.get("email_id"),
		"customer_group": customer.get("customer_group"),
		"default_price_list": customer.get("default_price_list"),
		"modified": customer.get("modified"),
	}
