from erpnext.accounts.utils import get_currency_precision


def profile_to_dict(profile, invoice_mode):
	return {
		"name": profile.name,
		"company": profile.company,
		"warehouse": profile.warehouse,
		"price_list": profile.selling_price_list,
		"currency": profile.currency,
		"currency_precision": get_currency_precision(),
		"default_customer": profile.customer,
		"taxes_and_charges": profile.get("taxes_and_charges"),
		"modes_of_payment": [
			{
				"mode_of_payment": row.mode_of_payment,
				"default": row.get("default"),
			}
			for row in profile.get("payments", [])
		],
		"print_format": profile.get("print_format"),
		"invoice_mode": invoice_mode,
	}
