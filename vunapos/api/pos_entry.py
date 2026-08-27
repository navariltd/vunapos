import frappe

from ..services.pos_entry import (
	create_pos_opening_entry,
)


@frappe.whitelist(methods=["POST"])
def create_opening_entry():
	"""
	POST
	{
	    "pos_profile": "Test",
	    "opening_balance": [
	        {
	            "mode_of_payment": "Cash",
	            "opening_amount": 1000
	        }
	    ]
	}
	"""

	data = frappe.request.get_json()

	opening_entry = create_pos_opening_entry(
		pos_profile=data.get("pos_profile"),
		opening_balance=data.get("opening_balance", []),
		user=frappe.session.user,
	)

	return {
		"success": True,
		"name": opening_entry.name,
		"pos_profile": opening_entry.pos_profile,
		"message": "POS Opening Entry created successfully",
	}
