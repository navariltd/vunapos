from frappe.utils.nestedset import get_descendants_of


def profile_customer_groups(profile):
	"""Customer groups a till shows: the POS Profile's Customer Groups and their descendants.

	Returns None when the table is empty, meaning the till shows every customer.
	"""
	allowed = set()
	for row in profile.get("customer_groups") or []:
		if row.customer_group:
			allowed.update([row.customer_group, *get_descendants_of("Customer Group", row.customer_group)])
	return sorted(allowed) or None
