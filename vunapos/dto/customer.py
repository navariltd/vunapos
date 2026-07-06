def customer_to_dict(customer):
	return {
		"customer": customer.name,
		"customer_name": customer.customer_name,
		"mobile_no": customer.get("mobile_no"),
		"email_id": customer.get("email_id"),
	}
