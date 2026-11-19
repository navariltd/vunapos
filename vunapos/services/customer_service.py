import frappe
from erpnext.accounts.doctype.loyalty_program.loyalty_program import (
	get_loyalty_program_details_with_points,
)
from erpnext.accounts.utils import get_balance_on
from frappe import _
from frappe.contacts.doctype.contact.contact import get_default_contact
from frappe.utils import cint, flt, getdate, now_datetime, today

from vunapos.dto.customer import customer_to_dict
from vunapos.services.catalogue_cache import (
	customer_search_key,
	invalidate_customer_search_cache,
)
from vunapos.services.catalogue_cache import (
	get as get_catalogue_cache,
)
from vunapos.services.catalogue_cache import (
	set as set_catalogue_cache,
)
from vunapos.services.customer_group_service import profile_customer_groups
from vunapos.services.phone_search import national_digits, profile_isd
from vunapos.services.profile_service import get_invoice_mode, resolve_pos_profile
from vunapos.utils.permissions import require_create, require_read


def search_customers(query=None, limit=20, since=None, pos_profile=None):
	limit = cint(limit) or 20
	query = (query or "").strip()
	profile = resolve_pos_profile(pos_profile) if pos_profile else None
	groups = profile_customer_groups(profile) if profile else None
	if not since and not frappe.flags.in_test:
		key = customer_search_key(frappe.session.user, query, limit, groups)
		cached = get_catalogue_cache(key)
		if cached is not None:
			return cached
	filters = {"disabled": 0}
	if since:
		filters["modified"] = [">", since]
	if groups:
		filters["customer_group"] = ["in", groups]
	or_filters = []
	if query:
		or_filters = [
			["Customer", "name", "like", f"%{query}%"],
			["Customer", "customer_name", "like", f"%{query}%"],
			["Customer", "mobile_no", "like", f"%{query}%"],
			["Customer", "email_id", "like", f"%{query}%"],
			*_phone_filters(query, profile),
		]

	# get_list applies Customer permission query conditions; get_all would leak rows
	# into both directory search and the active POS catalogue snapshot.
	customers = frappe.get_list(
		"Customer",
		filters=filters,
		or_filters=or_filters,
		# Fetch the fields used by customer_to_dict in the directory query. The
		# previous get_list(name) + get_doc() loop issued one request per customer
		# during the initial POS bootstrap.
		fields=[
			"name",
			"customer_name",
			"mobile_no",
			"email_id",
			"customer_group",
			"default_price_list",
			"is_walkin",
			"tax_id",
			"modified",
		],
		limit_page_length=limit,
		order_by="customer_name asc",
	)
	result = [customer_to_dict(row) for row in customers]
	if not since and not frappe.flags.in_test:
		set_catalogue_cache(key, result)
	return result


def _phone_filters(query, profile):
	"""Match a number typed in another format than the saved one, e.g. 0790 001 011."""
	digits = national_digits(query, profile_isd(profile))
	return [["Customer", "mobile_no", "like", f"%{digits}%"]] if digits and digits != query else []


def customers_outside_groups(since, groups):
	"""Customers changed since a sync that a till filtered to these groups must drop."""
	if not since or not groups:
		return []
	return frappe.get_list(
		"Customer",
		filters={"modified": [">", since], "customer_group": ["not in", groups]},
		pluck="name",
		limit_page_length=0,
	)


def _fail(code, message, field=None, meta=None, exc_type=frappe.ValidationError):
	exc = exc_type(message)
	exc.vuna_error_code = code
	exc.vuna_error_field = field
	exc.vuna_error_meta = meta
	raise exc


def _require_customer_creation(pos_profile):
	profile = resolve_pos_profile(pos_profile)
	allow_creation = profile.get("vunapos_allow_customer_creation")
	if allow_creation is not None and not cint(allow_creation):
		frappe.throw(_("Customer creation is disabled for this POS Profile"), frappe.PermissionError)
	require_create("Customer")
	return profile


def customer_types():
	options = frappe.get_meta("Customer").get_field("customer_type").options or ""
	return [option for option in options.split("\n") if option]


def _customer_type(value):
	types = customer_types()
	if not value:
		return "Individual" if "Individual" in types else types[0]
	if value not in types:
		_fail("INVALID_CUSTOMER_TYPE", _("Choose a valid customer type."), field="customer_type")
	return value


def _company_country(profile):
	return frappe.get_cached_value("Company", profile.company, "country")


def normalise_mobile(mobile_no, country=None):
	"""Return the number in Frappe's Phone field format, e.g. +254-712345678."""
	import phonenumbers

	raw = (mobile_no or "").strip()
	if not raw:
		return None
	region = (frappe.get_cached_value("Country", country, "code") or "").upper() if country else None
	try:
		number = phonenumbers.parse(raw, region or None)
	except phonenumbers.NumberParseException:
		number = None
	if not number or not phonenumbers.is_valid_number(number):
		_fail(
			"INVALID_MOBILE_NUMBER",
			_("Enter a valid mobile number for the selected country."),
			field="mobile_no",
		)
	return f"+{number.country_code}-{phonenumbers.national_significant_number(number)}"


def _same_mobile(value, normalised, country):
	try:
		return normalise_mobile(value, country) == normalised
	except frappe.ValidationError:
		return False


def _match_rows(names):
	if not names:
		return []
	rows = frappe.get_list(
		"Customer",
		filters={"name": ["in", list(names)], "disabled": 0},
		fields=["name", "customer_name", "mobile_no", "email_id", "customer_group", "tax_id", "modified"],
		order_by="customer_name asc",
		limit_page_length=10,
	)
	return [customer_to_dict(row) for row in rows]


def find_customers_by_mobile(normalised, country=None):
	"""Return readable, enabled customers whose own or linked Contact number is the same."""
	if not normalised:
		return []
	# Stored numbers come in several formats (+254-7…, 2547…, 07…); every one of
	# them ends with the national number, which narrows the rows to normalise.
	like = "%" + normalised.split("-", 1)[1]
	names = {
		row.name
		for row in frappe.get_all(
			"Customer", filters={"mobile_no": ["like", like]}, fields=["name", "mobile_no"]
		)
		if _same_mobile(row.mobile_no, normalised, country)
	}
	contacts = {
		row.parent
		for row in frappe.get_all(
			"Contact Phone",
			filters={"parenttype": "Contact", "phone": ["like", like]},
			fields=["parent", "phone"],
		)
		if _same_mobile(row.phone, normalised, country)
	}
	if contacts:
		names.update(
			frappe.get_all(
				"Dynamic Link",
				filters={
					"parenttype": "Contact",
					"parent": ["in", list(contacts)],
					"link_doctype": "Customer",
				},
				pluck="link_name",
			)
		)
	return _match_rows(names)


def find_similar_customers(customer_name, limit=5, customer_groups=None):
	words = [word for word in (customer_name or "").split() if len(word) >= 2][:4]
	if not words:
		return []
	filters = [["Customer", "disabled", "=", 0]]
	if customer_groups:
		filters.append(["Customer", "customer_group", "in", customer_groups])
	rows = frappe.get_list(
		"Customer",
		filters=filters + [["Customer", "customer_name", "like", f"%{word}%"] for word in words],
		fields=["name", "customer_name", "mobile_no", "email_id", "customer_group", "tax_id", "modified"],
		order_by="customer_name asc",
		limit_page_length=limit,
	)
	return [customer_to_dict(row) for row in rows]


def _usable_group(group):
	return group if group and not cint(frappe.get_cached_value("Customer Group", group, "is_group")) else None


def default_customer_group(profile):
	"""Group for customers created at this till.

	The profile's Default Customer Group; else its only Customer Groups row; else the
	Selling Settings default when it is within Customer Groups (or the table is empty).
	Blank only when the table is empty: profile validation refuses the other cases.
	"""
	if group := _usable_group(profile.get("vunapos_default_customer_group")):
		return group
	rows = [row.customer_group for row in profile.get("customer_groups") or [] if row.customer_group]
	if len(rows) == 1 and _usable_group(rows[0]):
		return rows[0]
	group = _usable_group(frappe.db.get_single_value("Selling Settings", "customer_group"))
	allowed = profile_customer_groups(profile)
	return group if group and (not allowed or group in allowed) else None


def default_customer_territory(profile):
	territory = profile.get("vunapos_default_customer_territory") or frappe.db.get_single_value(
		"Selling Settings", "territory"
	)
	if not territory or cint(frappe.get_cached_value("Territory", territory, "is_group")):
		return None
	return territory


def validate_profile_customer_defaults(doc, method=None):
	"""Customers created at a till must land in a group it shows; a group node can't hold customers."""
	group = doc.get("vunapos_default_customer_group")
	if group and cint(frappe.db.get_value("Customer Group", group, "is_group")):
		frappe.throw(_("Default Customer Group must not be a group node."))
	territory = doc.get("vunapos_default_customer_territory")
	if territory and cint(frappe.db.get_value("Territory", territory, "is_group")):
		frappe.throw(_("Default Customer Territory must not be a group node."))

	allow_creation = doc.get("vunapos_allow_customer_creation")
	allowed = profile_customer_groups(doc)
	if (allow_creation is not None and not cint(allow_creation)) or not allowed:
		return
	if group and group not in allowed:
		frappe.throw(
			_(
				"Default Customer Group {0} is not one of this profile's Customer Groups. Choose one of "
				"them, or a group under one of them."
			).format(frappe.bold(group)),
			title=_("Invalid Default Customer Group"),
		)
	if not default_customer_group(doc):
		frappe.throw(
			_(
				"Set a Default Customer Group. Customers created at this till must belong to one of its "
				"Customer Groups, and the Selling Settings default customer group is not set or is not one "
				"of them."
			),
			title=_("Default Customer Group Required"),
		)


def get_customer_create_options(pos_profile=None):
	from frappe.geo.country_info import get_all

	profile = _require_customer_creation(pos_profile)
	types = customer_types()
	countries = [
		{"country": name, "code": (info.get("code") or "").upper(), "isd": info.get("isd")}
		for name, info in sorted(get_all().items())
		if info.get("isd") and info.get("code")
	]
	return {
		"customer_types": types,
		"default_customer_type": _customer_type(None),
		"countries": countries,
		"default_country": _company_country(profile),
		"customer_group": default_customer_group(profile),
		"territory": default_customer_territory(profile),
	}


def find_customer_matches(pos_profile=None, customer_name=None, mobile_no=None, mobile_country=None):
	"""Customers the create form warns about before creating a possible duplicate.

	Customers outside this till's Customer Groups are not listed; mobile_elsewhere
	only says that the number is already on one of them.
	"""
	profile = _require_customer_creation(pos_profile)
	groups = profile_customer_groups(profile)
	country = mobile_country or _company_country(profile)
	result = {
		"mobile_no": None,
		"mobile_error": None,
		"mobile_matches": [],
		"mobile_elsewhere": False,
		"similar": [],
	}
	try:
		result["mobile_no"] = normalise_mobile(mobile_no, country)
	except frappe.ValidationError as exc:
		result["mobile_error"] = str(exc)
	matches = find_customers_by_mobile(result["mobile_no"], country)
	result["mobile_matches"] = [row for row in matches if not groups or row["customer_group"] in groups]
	result["mobile_elsewhere"] = len(result["mobile_matches"]) < len(matches)
	result["similar"] = find_similar_customers(customer_name, customer_groups=groups)
	return result


def create_customer(
	customer_name, mobile_no=None, email_id=None, pos_profile=None, customer_type=None, mobile_country=None
):
	if not (customer_name or "").strip():
		frappe.throw(_("Customer name is required"))

	profile = _require_customer_creation(pos_profile)
	# A number already on another customer is only a warning in the form: ERPNext keeps
	# phone numbers on Contacts, which can link to several customers.
	customer = frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": customer_name.strip(),
			"customer_type": _customer_type(customer_type),
			"mobile_no": normalise_mobile(mobile_no, mobile_country or _company_country(profile)),
			"email_id": (email_id or "").strip() or None,
			"customer_group": default_customer_group(profile),
			"territory": default_customer_territory(profile),
		}
	)
	customer.insert()
	require_read("Customer", customer.name)
	invalidate_customer_search_cache()
	return customer_to_dict(customer)


def get_customer_contact_phone(pos_profile=None, customer=None):
	"""Resolve the preferred permitted phone number for a POS customer."""
	resolve_pos_profile(pos_profile)
	if not customer:
		frappe.throw(_("Customer is required"))
	require_read("Customer", customer)
	customer_doc = frappe.get_doc("Customer", customer)
	direct_mobile = (customer_doc.get("mobile_no") or "").strip()
	if direct_mobile:
		return {"customer": customer_doc.name, "mobile_no": direct_mobile, "source": "Customer"}

	contact_name = customer_doc.get("customer_primary_contact") or get_default_contact(
		"Customer", customer_doc.name
	)
	contact = _permitted_linked_doc("Contact", contact_name, ["mobile_no", "phone"])
	contact_mobile = ((contact or {}).get("mobile_no") or (contact or {}).get("phone") or "").strip()
	if contact and not contact_mobile:
		phone_rows = frappe.get_all(
			"Contact Phone",
			filters={"parent": contact_name, "parenttype": "Contact"},
			fields=["phone", "is_primary_mobile_no", "is_primary_phone", "idx"],
			order_by="is_primary_mobile_no desc, is_primary_phone desc, idx asc",
		)
		contact_mobile = next(
			((row.get("phone") or "").strip() for row in phone_rows if (row.get("phone") or "").strip()),
			"",
		)
	return {
		"customer": customer_doc.name,
		"mobile_no": contact_mobile or None,
		"source": "Contact" if contact_mobile else None,
	}


def get_customer_addresses(pos_profile=None, customer=None, limit=100):
	"""Return permission-filtered ERPNext Address records linked to a customer."""
	resolve_pos_profile(pos_profile)
	if not customer:
		frappe.throw(_("Customer is required"))
	require_read("Customer", customer)
	customer_doc = frappe.get_doc("Customer", customer)
	require_read("Address")
	limit = min(max(cint(limit) or 100, 1), 100)

	links = frappe.get_all(
		"Dynamic Link",
		filters={"parenttype": "Address", "link_doctype": "Customer", "link_name": customer_doc.name},
		pluck="parent",
	)
	if not links:
		return []

	address_meta = frappe.get_meta("Address")
	available_fields = {field.fieldname for field in address_meta.fields if field.fieldname}
	requested_fields = [
		"name",
		"address_title",
		"address_type",
		"address_line1",
		"address_line2",
		"city",
		"state",
		"country",
		"pincode",
		"phone",
		"email_id",
		"is_primary_address",
		"is_shipping_address",
		"disabled",
	]
	fields = [field for field in requested_fields if field == "name" or field in available_fields]
	rows = frappe.get_list(
		"Address",
		filters={"name": ["in", links], "disabled": 0}
		if "disabled" in available_fields
		else {"name": ["in", links]},
		fields=fields,
		order_by="address_title asc, name asc",
		limit_page_length=limit,
	)
	primary_name = customer_doc.get("customer_primary_address")
	result = []
	for row in rows:
		values = dict(row)
		lines = [
			values.get("address_line1"),
			values.get("address_line2"),
			values.get("city"),
			values.get("state"),
			values.get("pincode"),
			values.get("country"),
		]
		values["customer"] = customer_doc.name
		values["is_default"] = values.get("name") == primary_name or bool(values.get("is_primary_address"))
		values["formatted_address"] = ", ".join(
			str(line).strip() for line in lines if line and str(line).strip()
		)
		result.append(values)
	result.sort(
		key=lambda row: (not row.get("is_default"), row.get("address_title") or row.get("name") or "")
	)
	return result


def validate_customer_address(pos_profile=None, customer=None, address_name=None):
	"""Validate and return one customer-linked Address for document submission."""
	resolve_pos_profile(pos_profile)
	if not customer or not address_name:
		frappe.throw(_("Customer and shipping address are required"))
	require_read("Customer", customer)
	require_read("Address", address_name)
	if not frappe.db.exists(
		"Dynamic Link",
		{"parent": address_name, "parenttype": "Address", "link_doctype": "Customer", "link_name": customer},
	):
		frappe.throw(_("Address {0} is not linked to customer {1}").format(address_name, customer))
	return next(
		(
			row
			for row in get_customer_addresses(pos_profile=pos_profile, customer=customer)
			if row.get("name") == address_name
		),
		None,
	)


def get_customer_loyalty(pos_profile=None, customer=None):
	"""Return the customer's live ERPNext loyalty ledger balance for the active company."""
	profile = resolve_pos_profile(pos_profile)
	if not customer:
		frappe.throw(_("Customer is required"))
	require_read("Customer", customer)
	loyalty_program = frappe.db.get_value("Customer", customer, "loyalty_program")
	if not loyalty_program:
		return {
			"customer": customer,
			"enrolled": False,
			"program": None,
			"tier": None,
			"points": 0.0,
			"conversion_factor": 0.0,
			"redemption_value": 0.0,
			"currency": profile.currency,
		}

	details = get_loyalty_program_details_with_points(
		customer=customer,
		loyalty_program=loyalty_program,
		company=profile.company,
	)
	points = max(flt(details.get("loyalty_points")), 0)
	conversion_factor = max(flt(details.get("conversion_factor")), 0)
	return {
		"customer": customer,
		"enrolled": True,
		"program": details.get("loyalty_program") or loyalty_program,
		"tier": details.get("tier_name"),
		"points": points,
		"conversion_factor": conversion_factor,
		"redemption_value": points * conversion_factor,
		"currency": profile.currency,
	}


def get_customer_directory(
	pos_profile=None,
	query=None,
	customer_group=None,
	customer_type=None,
	territory=None,
	start=0,
	limit=25,
):
	"""Return a permission-filtered customer page with live accounting summaries."""
	profile = resolve_pos_profile(pos_profile)
	allow_management = profile.get("vunapos_allow_customer_management")
	if allow_management is not None and not cint(allow_management):
		frappe.throw(_("Customer management is disabled for this POS Profile"), frappe.PermissionError)
	start = max(cint(start), 0)
	limit = min(max(cint(limit) or 25, 1), 100)
	groups = profile_customer_groups(profile)
	# A list, so a chosen group and the till's Customer Groups can both apply.
	filters = [["Customer", "disabled", "=", 0]]
	if groups:
		filters.append(["Customer", "customer_group", "in", groups])
	if customer_group:
		filters.append(["Customer", "customer_group", "=", customer_group])
	if customer_type:
		filters.append(["Customer", "customer_type", "=", customer_type])
	if territory:
		filters.append(["Customer", "territory", "=", territory])

	query = (query or "").strip()
	or_filters = []
	if query:
		like = f"%{query}%"
		or_filters = [
			["Customer", "name", "like", like],
			["Customer", "customer_name", "like", like],
			["Customer", "mobile_no", "like", like],
			["Customer", "email_id", "like", like],
			*_phone_filters(query, profile),
		]

	fields = [
		"name",
		"customer_name",
		"customer_type",
		"customer_group",
		"territory",
		"mobile_no",
		"email_id",
		"is_walkin",
		"default_currency",
		"loyalty_program",
		"modified",
	]
	customers = frappe.get_list(
		"Customer",
		filters=filters,
		or_filters=or_filters,
		fields=fields,
		start=start,
		page_length=limit,
		order_by="customer_name asc",
	)
	count_rows = frappe.get_list(
		"Customer",
		filters=filters,
		or_filters=or_filters,
		fields=[{"COUNT": "*", "as": "total"}],
		limit_page_length=1,
	)
	total_count = cint(count_rows[0].total) if count_rows else 0
	names = [row.name for row in customers]
	filter_rows = frappe.get_list(
		"Customer",
		filters={"disabled": 0, **({"customer_group": ["in", groups]} if groups else {})},
		fields=["customer_group", "territory"],
		limit_page_length=10000,
	)

	invoice_summary = {}
	financials_visible = bool(names)
	invoice_history_visible = bool(names and frappe.has_permission("Sales Invoice", "read"))
	if invoice_history_visible:
		invoice_rows = frappe.get_list(
			"Sales Invoice",
			filters={
				"docstatus": 1,
				"company": profile.company,
				"customer": ["in", names],
				"is_return": 0,
			},
			fields=[
				"customer",
				{"COUNT": "*", "as": "invoice_count"},
				{"MAX": "posting_date", "as": "last_purchase_date"},
			],
			group_by="customer",
			limit_page_length=len(names),
		)
		invoice_summary = {row.customer: row for row in invoice_rows}

	# ERPNext's own helpers validate access to the Customer and calculate these
	# values from the ledger/loyalty program rather than from client-supplied data.
	loyalty_visible = bool(names)

	data = []
	for customer in customers:
		summary = invoice_summary.get(customer.name)
		customer_balance = None
		if financials_visible:
			customer_balance = get_balance_on(
				party_type="Customer",
				party=customer.name,
				company=profile.company,
			)
		loyalty_points = None
		if loyalty_visible and customer.loyalty_program:
			loyalty = get_loyalty_program_details_with_points(
				customer=customer.name,
				loyalty_program=customer.loyalty_program,
				company=profile.company,
			)
			loyalty_points = flt(loyalty.get("loyalty_points"))
		elif loyalty_visible:
			loyalty_points = 0
		data.append(
			{
				"customer": customer.name,
				"customer_name": customer.customer_name,
				"customer_type": customer.customer_type,
				"customer_group": customer.customer_group,
				"territory": customer.territory,
				"mobile_no": customer.mobile_no,
				"email_id": customer.email_id,
				"is_walkin": bool(customer.get("is_walkin")),
				"currency": customer.default_currency or profile.currency,
				"outstanding_balance": flt(customer_balance) if customer_balance is not None else None,
				"invoice_count": cint(summary.invoice_count)
				if summary
				else (0 if invoice_history_visible else None),
				"last_purchase_date": summary.last_purchase_date if summary else None,
				"loyalty_points": loyalty_points,
				"modified": customer.modified,
			}
		)

	return {
		"customers": data,
		"total_count": total_count,
		"start": start,
		"limit": limit,
		"as_of": str(now_datetime()),
		"financials_visible": financials_visible,
		"loyalty_visible": loyalty_visible,
		"customer_groups": sorted({row.customer_group for row in filter_rows if row.customer_group}),
		"territories": sorted({row.territory for row in filter_rows if row.territory}),
	}


def _permitted_linked_doc(doctype, name, fields):
	if not name or not frappe.has_permission(doctype, "read", doc=name):
		return None
	return frappe.db.get_value(doctype, name, fields, as_dict=True)


def _customer_invoice_status(row):
	if row.is_return:
		return "Credit Note"
	if flt(row.outstanding_amount) <= 0:
		return "Paid"
	if row.due_date and getdate(row.due_date) < getdate(today()):
		return "Overdue"
	if flt(row.outstanding_amount) < flt(row.grand_total):
		return "Partly Paid"
	return "Unpaid"


def get_customer_details(pos_profile=None, customer=None, invoice_limit=20, payment_limit=20):
	profile = resolve_pos_profile(pos_profile)
	if not customer:
		frappe.throw(_("Customer is required"))
	require_read("Customer", customer)
	customer_doc = frappe.get_doc("Customer", customer)
	invoice_limit = min(max(cint(invoice_limit) or 20, 1), 100)
	payment_limit = min(max(cint(payment_limit) or 20, 1), 100)

	balance = get_balance_on(party_type="Customer", party=customer_doc.name, company=profile.company)
	loyalty = None
	if customer_doc.get("loyalty_program"):
		loyalty_details = get_loyalty_program_details_with_points(
			customer=customer_doc.name,
			loyalty_program=customer_doc.loyalty_program,
			company=profile.company,
		)
		loyalty = {
			"program": loyalty_details.get("loyalty_program"),
			"points": flt(loyalty_details.get("loyalty_points")),
			"tier": loyalty_details.get("tier_name"),
			"conversion_factor": flt(loyalty_details.get("conversion_factor")),
		}

	invoices = []
	invoice_doctype = get_invoice_mode()
	if frappe.has_permission(invoice_doctype, "read"):
		invoice_rows = frappe.get_list(
			invoice_doctype,
			filters={"docstatus": 1, "company": profile.company, "customer": customer_doc.name},
			fields=[
				"name",
				"posting_date",
				"due_date",
				"currency",
				"grand_total",
				"outstanding_amount",
				"is_return",
				"return_against",
			],
			order_by="posting_date desc, modified desc",
			limit_page_length=invoice_limit,
		)
		for row in invoice_rows:
			invoices.append(
				{
					"name": row.name,
					"doctype": invoice_doctype,
					"posting_date": row.posting_date,
					"due_date": row.due_date,
					"currency": row.currency or profile.currency,
					"grand_total": flt(row.grand_total),
					"paid_amount": max(flt(row.grand_total) - flt(row.outstanding_amount), 0),
					"outstanding_amount": flt(row.outstanding_amount),
					"status": _customer_invoice_status(row),
					"is_return": bool(row.is_return),
					"return_against": row.return_against,
				}
			)

	payments = []
	if frappe.has_permission("Payment Entry", "read"):
		payment_rows = frappe.get_list(
			"Payment Entry",
			filters={
				"docstatus": 1,
				"company": profile.company,
				"payment_type": "Receive",
				"party_type": "Customer",
				"party": customer_doc.name,
			},
			fields=[
				"name",
				"posting_date",
				"mode_of_payment",
				"paid_amount",
				"received_amount",
				"unallocated_amount",
				"reference_no",
				"remarks",
			],
			order_by="posting_date desc, modified desc",
			limit_page_length=payment_limit,
		)
		payments = [dict(row) for row in payment_rows]

	contact = _permitted_linked_doc(
		"Contact",
		customer_doc.get("customer_primary_contact"),
		["name", "first_name", "last_name", "email_id", "mobile_no", "phone"],
	)
	address = _permitted_linked_doc(
		"Address",
		customer_doc.get("customer_primary_address"),
		["name", "address_title", "address_line1", "address_line2", "city", "state", "country", "pincode"],
	)
	return {
		"customer": {
			"customer": customer_doc.name,
			"customer_name": customer_doc.customer_name,
			"customer_type": customer_doc.customer_type,
			"customer_group": customer_doc.customer_group,
			"territory": customer_doc.territory,
			"mobile_no": customer_doc.mobile_no,
			"email_id": customer_doc.email_id,
			"tax_id": customer_doc.get("tax_id"),
			"is_walkin": bool(customer_doc.get("is_walkin")),
			"currency": customer_doc.get("default_currency") or profile.currency,
		},
		"balance": flt(balance),
		"loyalty": loyalty,
		"invoices": invoices,
		"payments": payments,
		"contact": contact,
		"address": address,
		"as_of": str(now_datetime()),
	}
