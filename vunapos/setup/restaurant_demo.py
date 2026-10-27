"""Restaurant demo data for a development or demo site.

Builds a complete restaurant on one POS Profile: menu item groups and items with
prices, bottled-drink stock, customers, payment modes, staff users and PINs,
floors and tables, the POS Profile restaurant settings and menu, a cashier
shift, and sample orders in every state.

Safe to run more than once: existing records are reused, and sample orders are
only created when the profile has none.

    bench --site <site> execute vunapos.setup.restaurant_demo.create_restaurant_demo \
        --kwargs "{'pos_profile': 'Nairobi'}"

Never run this on a production site.
"""

import frappe
from frappe.permissions import add_permission, update_permission_property
from frappe.utils import flt, nowdate
from frappe.utils.nestedset import get_root_of

from vunapos.services.floor_plan_service import FLOOR_DOCTYPE, get_floor_plan_version, save_floor_plan
from vunapos.setup.utils import RESTAURANT_MANAGER_ROLE

DEMO_PASSWORD = "Demo@2026"
WAITER_ROLE = "VunaPOS Waiter"
MANAGER_PIN = "1234"
TAKEAWAY_PRICES = "Takeaway Prices"
SERVICE_CHARGE_TEMPLATE = "Dine In Service Charge"
FAMILY_PACK_DEAL = "Takeaway Family Pack Deal"
# Takeaway and delivery add packaging to cooked food; drinks cost the same.
PACKAGING = {"Family Packs": 100, "Starters": 50, "Mains": 50, "Grills": 50, "Desserts": 50}
NOT_FOR_TAKEAWAY = ("Beers", "Wines", "Cocktails")
MPESA = "M-Pesa"

# Item group tree: (group, parent, is_group). Parents are listed before children.
ITEM_GROUPS = (
	("Restaurant Menu", None, 1),
	("Food", "Restaurant Menu", 1),
	("Starters", "Food", 0),
	("Mains", "Food", 0),
	("Grills", "Food", 0),
	("Desserts", "Food", 0),
	("Family Packs", "Food", 0),
	("Drinks", "Restaurant Menu", 1),
	("Hot Drinks", "Drinks", 0),
	("Soft Drinks", "Drinks", 0),
	("Fresh Juices", "Drinks", 0),
	("Bar", "Restaurant Menu", 1),
	("Beers", "Bar", 0),
	("Wines", "Bar", 0),
	("Cocktails", "Bar", 0),
)

# (item_code, item_name, item_group, selling rate, stock item, opening qty, valuation rate)
# Cooked food and poured drinks are non-stock (prepared to order). Bottled drinks
# are stock items so the demo shows stock moving when they are billed.
ITEMS = (
	("GE-SAMOSA", "Beef Samosa (3 pcs)", "Starters", 250, 0, 0, 0),
	("GE-WINGS", "Chicken Wings (6 pcs)", "Starters", 650, 0, 0, 0),
	("GE-SPRING-ROLLS", "Vegetable Spring Rolls", "Starters", 400, 0, 0, 0),
	("GE-SOUP", "Soup of the Day", "Starters", 350, 0, 0, 0),
	("GE-BIRYANI", "Chicken Biryani", "Mains", 950, 0, 0, 0),
	("GE-PILAU", "Beef Pilau", "Mains", 850, 0, 0, 0),
	("GE-TILAPIA", "Whole Tilapia with Ugali", "Mains", 1200, 0, 0, 0),
	("GE-VEG-CURRY", "Vegetable Curry with Rice", "Mains", 750, 0, 0, 0),
	("GE-CHAPATI-BEANS", "Chapati and Beans", "Mains", 450, 0, 0, 0),
	("GE-NYAMA-CHOMA", "Nyama Choma (1/2 kg Goat)", "Grills", 1300, 0, 0, 0),
	("GE-MISHKAKI", "Beef Mishkaki Skewers", "Grills", 700, 0, 0, 0),
	("GE-GRILLED-CHICKEN", "Grilled Chicken Quarter", "Grills", 800, 0, 0, 0),
	("GE-CHOC-CAKE", "Chocolate Cake Slice", "Desserts", 450, 0, 0, 0),
	("GE-FRUIT-SALAD", "Fruit Salad", "Desserts", 350, 0, 0, 0),
	("GE-ICE-CREAM", "Ice Cream (2 scoops)", "Desserts", 300, 0, 0, 0),
	("GE-FAMILY-PILAU", "Family Pilau Pack (serves 4)", "Family Packs", 3200, 0, 0, 0),
	("GE-WINGS-BUCKET", "Wings Bucket (20 pcs)", "Family Packs", 2400, 0, 0, 0),
	("GE-TEA", "Kenyan Tea", "Hot Drinks", 150, 0, 0, 0),
	("GE-DAWA", "Dawa (Lemon, Honey, Ginger)", "Hot Drinks", 300, 0, 0, 0),
	("GE-CAPPUCCINO", "Cappuccino", "Hot Drinks", 350, 0, 0, 0),
	("GE-BLACK-COFFEE", "Black Coffee", "Hot Drinks", 250, 0, 0, 0),
	("GE-COKE", "Coca-Cola 300ml", "Soft Drinks", 120, 1, 96, 55),
	("GE-FANTA", "Fanta Orange 300ml", "Soft Drinks", 120, 1, 96, 55),
	("GE-SPRITE", "Sprite 300ml", "Soft Drinks", 120, 1, 96, 55),
	("GE-WATER", "Mineral Water 500ml", "Soft Drinks", 100, 1, 120, 35),
	("GE-PASSION", "Fresh Passion Juice", "Fresh Juices", 300, 0, 0, 0),
	("GE-MANGO", "Fresh Mango Juice", "Fresh Juices", 300, 0, 0, 0),
	("GE-TUSKER", "Tusker Lager 500ml", "Beers", 300, 1, 72, 190),
	("GE-WHITECAP", "White Cap 500ml", "Beers", 300, 1, 72, 190),
	("GE-GUINNESS", "Guinness 500ml", "Beers", 350, 1, 48, 220),
	("GE-HOUSE-RED", "House Red Wine (glass)", "Wines", 600, 0, 0, 0),
	("GE-HOUSE-WHITE", "House White Wine (glass)", "Wines", 600, 0, 0, 0),
	("GE-MOJITO", "Mojito", "Cocktails", 800, 0, 0, 0),
	("GE-DAWA-COCKTAIL", "Dawa Cocktail", "Cocktails", 750, 0, 0, 0),
)

CUSTOMERS = ("Walk-in Customer", "John Kamau", "Aisha Mohamed", "Golden Echo Staff")

# (email, first name, roles, sales person, PIN role, PIN)
STAFF = (
	(
		"waiter.jane@goldenecho.test",
		"Jane Wanjiku",
		("Sales User", WAITER_ROLE),
		"Jane Wanjiku",
		"Salesperson",
		"1111",
	),
	(
		"waiter.brian@goldenecho.test",
		"Brian Otieno",
		("Sales User", WAITER_ROLE),
		"Brian Otieno",
		"Salesperson",
		"2222",
	),
	(
		"cashier.grace@goldenecho.test",
		"Grace Achieng",
		("Sales User", "Accounts User"),
		"Grace Achieng",
		"Salesperson",
		"3333",
	),
	(
		"manager.mary@goldenecho.test",
		"Mary Njeri",
		("Sales User", "Sales Manager", "Accounts User", RESTAURANT_MANAGER_ROLE),
		"Mary Njeri",
		"Manager",
		MANAGER_PIN,
	),
)
WAITER_JANE, WAITER_BRIAN, CASHIER, MANAGER = (row[0] for row in STAFF)

# Menu rows on the POS Profile: (item group, label, floor name, service type).
# Food, hot and soft drinks are on every menu. The bar is only served on the
# Terrace and in the VIP Lounge. Family packs are only sold for takeaway and
# delivery. Takeaway and delivery have no floor, so they never get the bar.
MENU = (
	("Starters", "Starters", None, None),
	("Mains", "Mains", None, None),
	("Grills", "Grills", None, None),
	("Desserts", "Desserts", None, None),
	("Hot Drinks", "Hot Drinks", None, None),
	("Soft Drinks", "Soft Drinks", None, None),
	("Fresh Juices", "Fresh Juices", None, None),
	("Bar", "Bar", "Terrace", None),
	("Bar", "Bar", "VIP Lounge", None),
	("Family Packs", "Family Packs", None, "Takeaway"),
	("Family Packs", "Family Packs", None, "Delivery"),
)


def _wall(x, y, width, height):
	return {"element_type": "Wall", "x": x, "y": y, "width": width, "height": height}


def _table(label, seats, shape, x, y, width=90, height=90):
	return {
		"client_id": label,
		"table_label": label,
		"seats": seats,
		"shape": shape,
		"x": x,
		"y": y,
		"width": width,
		"height": height,
	}


OUTER_WALLS = [_wall(0, 0, 1000, 12), _wall(0, 688, 1000, 12), _wall(0, 0, 12, 700), _wall(988, 0, 12, 700)]

FLOORS = (
	{
		"client_id": "main-hall",
		"floor_name": "Main Hall",
		"display_order": 1,
		"elements": [
			*OUTER_WALLS,
			{"element_type": "Door", "label": "Entrance", "x": 440, "y": 676, "width": 120, "height": 24},
			{
				"element_type": "Bar Counter",
				"label": "Service Counter",
				"x": 680,
				"y": 40,
				"width": 280,
				"height": 70,
			},
			{"element_type": "Window", "x": 0, "y": 250, "width": 12, "height": 160},
			{"element_type": "Plant", "x": 40, "y": 620, "width": 50, "height": 50},
		],
		"tables": [
			_table("T1", 4, "Square", 60, 160),
			_table("T2", 4, "Square", 230, 160),
			_table("T3", 2, "Round", 400, 170, 80, 80),
			_table("T4", 2, "Round", 540, 170, 80, 80),
			_table("T5", 6, "Rectangle", 60, 380, 160, 90),
			_table("T6", 6, "Rectangle", 280, 380, 160, 90),
			_table("T7", 4, "Square", 500, 380),
			_table("T8", 8, "Oval", 680, 360, 220, 120),
		],
	},
	{
		"client_id": "terrace",
		"floor_name": "Terrace",
		"display_order": 2,
		"elements": [
			_wall(0, 0, 1000, 12),
			{
				"element_type": "Bar Counter",
				"label": "Terrace Bar",
				"x": 60,
				"y": 40,
				"width": 240,
				"height": 70,
			},
			{"element_type": "Plant", "x": 930, "y": 30, "width": 50, "height": 50},
			{"element_type": "Plant", "x": 930, "y": 620, "width": 50, "height": 50},
			{"element_type": "Label", "label": "Garden View", "x": 400, "y": 640, "width": 200, "height": 40},
		],
		"tables": [
			_table("R1", 4, "Round", 120, 220),
			_table("R2", 4, "Round", 320, 220),
			_table("R3", 4, "Round", 520, 220),
			_table("R4", 2, "Round", 720, 230, 80, 80),
			_table("R5", 6, "Rectangle", 300, 440, 180, 90),
		],
	},
	{
		"client_id": "vip-lounge",
		"floor_name": "VIP Lounge",
		"display_order": 3,
		"elements": [
			*OUTER_WALLS,
			{
				"element_type": "Door",
				"label": "Private Entrance",
				"x": 860,
				"y": 676,
				"width": 100,
				"height": 24,
			},
			{
				"element_type": "Bar Counter",
				"label": "Private Bar",
				"x": 700,
				"y": 60,
				"width": 240,
				"height": 70,
			},
		],
		"tables": [
			_table("V1", 10, "Rectangle", 120, 260, 320, 130),
			_table("V2", 6, "Oval", 520, 280, 200, 110),
		],
	},
)


def _log(message):
	print(f"[restaurant demo] {message}")


def _ensure(doctype, name, values):
	if frappe.db.exists(doctype, name):
		return frappe.get_doc(doctype, name)
	return frappe.get_doc({"doctype": doctype, **values}).insert(ignore_permissions=True)


# ---- masters ----


def _ensure_item_groups():
	root = get_root_of("Item Group")
	for name, parent, is_group in ITEM_GROUPS:
		_ensure(
			"Item Group",
			name,
			{"item_group_name": name, "parent_item_group": parent or root, "is_group": is_group},
		)


def _stock_uom():
	return "Nos" if frappe.db.exists("UOM", "Nos") else frappe.db.get_value("UOM", {}, "name")


def _ensure_items(price_list):
	uom = _stock_uom()
	for item_code, item_name, item_group, rate, is_stock, _qty, valuation in ITEMS:
		values = {
			"item_code": item_code,
			"item_name": item_name,
			"item_group": item_group,
			"stock_uom": uom,
			"is_sales_item": 1,
			"is_purchase_item": is_stock,
			"is_stock_item": is_stock,
			"include_item_in_manufacturing": 0,
			"valuation_rate": valuation,
		}
		if frappe.get_meta("Item").has_field("etims_prevent_etims_registration"):
			values["etims_prevent_etims_registration"] = 1
		_ensure("Item", item_code, values)
		if not frappe.db.exists("Item Price", {"item_code": item_code, "price_list": price_list}):
			frappe.get_doc(
				{
					"doctype": "Item Price",
					"item_code": item_code,
					"price_list": price_list,
					"price_list_rate": rate,
				}
			).insert(ignore_permissions=True)


def _ensure_opening_stock(company, warehouse):
	rows = []
	for item_code, _name, _group, _rate, is_stock, qty, valuation in ITEMS:
		if not is_stock or flt(
			frappe.db.get_value("Bin", {"item_code": item_code, "warehouse": warehouse}, "actual_qty")
		):
			continue
		rows.append({"item_code": item_code, "qty": qty, "basic_rate": valuation, "t_warehouse": warehouse})
	if not rows:
		return
	entry = frappe.get_doc(
		{
			"doctype": "Stock Entry",
			"stock_entry_type": "Material Receipt",
			"purpose": "Material Receipt",
			"company": company,
			"items": rows,
			"remarks": "Restaurant demo opening stock for bottled drinks",
		}
	)
	entry.insert(ignore_permissions=True)
	entry.submit()
	_log(f"Opening stock received for {len(rows)} bottled drinks ({entry.name})")


def _ensure_customers():
	group = frappe.db.get_value("Customer Group", {"is_group": 0}, "name") or get_root_of("Customer Group")
	territory = (
		"Kenya"
		if frappe.db.exists("Territory", "Kenya")
		else frappe.db.get_value("Territory", {"is_group": 0}, "name")
	) or get_root_of("Territory")
	for name in CUSTOMERS:
		_ensure(
			"Customer",
			name,
			{
				"customer_name": name,
				"customer_type": "Individual",
				"customer_group": group,
				"territory": territory,
			},
		)


def _ensure_service_type_pricing(company, currency):
	"""Show why service types are master data: own prices, offers and charges.

	- Takeaway and Delivery use "Takeaway Prices" (packaging added to food). Bar
	  items have no takeaway price, so they are never on those menus.
	- A Pricing Rule limited to Takeaway Prices gives 15% off Family Packs.
	- Dine In adds a 10% service charge through its own taxes template.
	"""
	_ensure(
		"Price List",
		TAKEAWAY_PRICES,
		{"price_list_name": TAKEAWAY_PRICES, "selling": 1, "enabled": 1, "currency": currency},
	)
	for item_code, _name, item_group, rate, _stock, _qty, _valuation in ITEMS:
		if item_group in NOT_FOR_TAKEAWAY:
			continue
		if not frappe.db.exists("Item Price", {"item_code": item_code, "price_list": TAKEAWAY_PRICES}):
			frappe.get_doc(
				{
					"doctype": "Item Price",
					"item_code": item_code,
					"price_list": TAKEAWAY_PRICES,
					"price_list_rate": rate + PACKAGING.get(item_group, 0),
				}
			).insert(ignore_permissions=True)

	if not frappe.db.exists("Pricing Rule", {"title": FAMILY_PACK_DEAL}):
		frappe.get_doc(
			{
				"doctype": "Pricing Rule",
				"title": FAMILY_PACK_DEAL,
				"apply_on": "Item Group",
				"item_groups": [{"item_group": "Family Packs"}],
				"selling": 1,
				"company": company,
				"for_price_list": TAKEAWAY_PRICES,
				"rate_or_discount": "Discount Percentage",
				"discount_percentage": 15,
				"valid_from": nowdate(),
			}
		).insert(ignore_permissions=True)

	abbr = frappe.db.get_value("Company", company, "abbr")
	account = frappe.db.get_value(
		"Account", {"account_name": "Service Charge Income", "company": company}, "name"
	)
	if not account:
		parent = frappe.db.get_value(
			"Account",
			{"company": company, "root_type": "Income", "is_group": 1, "parent_account": ["is", "set"]},
			"name",
		) or frappe.db.get_value(
			"Account", {"company": company, "root_type": "Income", "is_group": 1}, "name"
		)
		account = (
			frappe.get_doc(
				{
					"doctype": "Account",
					"account_name": "Service Charge Income",
					"parent_account": parent,
					"company": company,
					"account_type": "Income Account",
					"is_group": 0,
				}
			)
			.insert(ignore_permissions=True)
			.name
		)
	template = f"{SERVICE_CHARGE_TEMPLATE} - {abbr}"
	if not frappe.db.exists("Sales Taxes and Charges Template", template):
		frappe.get_doc(
			{
				"doctype": "Sales Taxes and Charges Template",
				"title": SERVICE_CHARGE_TEMPLATE,
				"company": company,
				"taxes": [
					{
						"charge_type": "On Net Total",
						"account_head": account,
						"description": "Service Charge 10%",
						"rate": 10,
					}
				],
			}
		).insert(ignore_permissions=True)

	for service_type, values in (
		("Dine In", {"price_list": None, "taxes_and_charges": template}),
		("Takeaway", {"price_list": TAKEAWAY_PRICES, "taxes_and_charges": None}),
		("Delivery", {"price_list": TAKEAWAY_PRICES, "taxes_and_charges": None}),
	):
		if frappe.db.exists("VunaPOS Service Type", service_type):
			doc = frappe.get_doc("VunaPOS Service Type", service_type)
			doc.update(values)
			doc.save(ignore_permissions=True)


def _ensure_mpesa(company):
	account_name = frappe.db.get_value("Account", {"account_name": "M-Pesa Till", "company": company}, "name")
	if not account_name:
		parent = frappe.db.get_value(
			"Account", {"company": company, "account_type": "Bank", "is_group": 1}, "name"
		)
		account_name = (
			frappe.get_doc(
				{
					"doctype": "Account",
					"account_name": "M-Pesa Till",
					"parent_account": parent,
					"company": company,
					"account_type": "Bank",
					"is_group": 0,
				}
			)
			.insert(ignore_permissions=True)
			.name
		)
	mode = _ensure("Mode of Payment", MPESA, {"mode_of_payment": MPESA, "type": "Bank"})
	if not any(row.company == company for row in mode.get("accounts", [])):
		mode.append("accounts", {"company": company, "default_account": account_name})
		mode.save(ignore_permissions=True)


def _ensure_sales_person(name):
	parent = frappe.db.get_value("Sales Person", {"is_group": 1}, "name") or get_root_of("Sales Person")
	return _ensure("Sales Person", name, {"sales_person_name": name, "parent_sales_person": parent}).name


def _ensure_staff():
	_ensure_waiter_role()
	for email, first_name, roles, _sales_person, _pin_role, _pin in STAFF:
		if not frappe.db.exists("User", email):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": first_name.split()[0],
					"last_name": " ".join(first_name.split()[1:]),
					"send_welcome_email": 0,
					"new_password": DEMO_PASSWORD,
				}
			).insert(ignore_permissions=True)
		user = frappe.get_doc("User", email)
		missing = [role for role in roles if role not in {row.role for row in user.roles}]
		if missing:
			user.add_roles(*missing)


def _ensure_waiter_role():
	"""Demo stand-in for the planned VunaPOS Waiter role (design decision 12).

	Waiters need read-only access to:
	- POS Profile: bootstrap reads the resolved profile.
	- Sales Invoice and POS Invoice: catalogue prices go through ERPNext's
	  apply_pricing_rule, which checks the user may price that transaction type.
	Standard ERPNext gives these only to Accounts roles, and waiters should not
	get accounting access. A dedicated role keeps Sales User unchanged site-wide.
	"""
	_ensure("Role", WAITER_ROLE, {"role_name": WAITER_ROLE, "desk_access": 1})
	for doctype in ("POS Profile", "Sales Invoice", "POS Invoice"):
		if not frappe.db.exists("Custom DocPerm", {"parent": doctype, "role": WAITER_ROLE, "permlevel": 0}):
			add_permission(doctype, WAITER_ROLE, 0)
		update_permission_property(doctype, WAITER_ROLE, 0, "read", 1)


# ---- POS Profile ----


def _configure_profile(profile_name, price_list):
	profile = frappe.get_doc("POS Profile", profile_name)
	profile.update(
		{
			"vunapos_pos_mode": "Restaurant",
			"customer": "Walk-in Customer",
			"selling_price_list": price_list,
			"vunapos_allow_service_items": 1,
			"vunapos_allow_multiple_orders_per_table": 0,
			"vunapos_require_manager_pin_order_cancel": 1,
			"vunapos_require_manager_pin_item_removal": 0,
			# Salesperson PINs are configured below but not enforced, so the
			# frontend team can test checkout without PINs. Turn this on to demo
			# per-person accountability on a shared terminal.
			"vunapos_enable_salesperson_pin": 0,
		}
	)
	if not any(row.mode_of_payment == MPESA for row in profile.payments):
		profile.append("payments", {"mode_of_payment": MPESA, "default": 0})
	assigned = {row.user for row in profile.applicable_for_users}
	for email in [row[0] for row in STAFF]:
		if email not in assigned:
			profile.append("applicable_for_users", {"user": email, "default": 1})
	profile.set(
		"vunapos_service_types",
		[
			{"service_type": "Dine In", "is_default": 1},
			{"service_type": "Takeaway", "is_default": 0},
			{"service_type": "Delivery", "is_default": 0},
		],
	)
	profile.set(
		"vunapos_pin_users",
		[
			{
				"sales_person": _ensure_sales_person(sales_person),
				"display_name": sales_person,
				"role": pin_role,
				"pin": pin,
				"enabled": 1,
			}
			for _email, _first, _roles, sales_person, pin_role, pin in STAFF
		],
	)
	profile.save(ignore_permissions=True)
	return profile


def _configure_floors(profile_name):
	if frappe.db.exists(FLOOR_DOCTYPE, {"pos_profile": profile_name}):
		_log("Floors already exist; leaving the floor plan as it is")
		return
	save_floor_plan(
		profile_name,
		{"version": get_floor_plan_version(profile_name), "floors": [dict(floor) for floor in FLOORS]},
	)
	_log("Floor plan created: Main Hall (T1-T8), Terrace (R1-R5), VIP Lounge (V1-V2)")


def _configure_menu(profile_name):
	floors = {
		row.floor_name: row.name
		for row in frappe.get_all(
			FLOOR_DOCTYPE, filters={"pos_profile": profile_name}, fields=["name", "floor_name"]
		)
	}
	profile = frappe.get_doc("POS Profile", profile_name)
	profile.set(
		"vunapos_restaurant_menu",
		[
			{
				"item_group": item_group,
				"label": label,
				"floor": floors.get(floor) if floor else None,
				"service_type": service_type,
				"display_order": index,
			}
			for index, (item_group, label, floor, service_type) in enumerate(MENU, start=1)
		],
	)
	profile.save(ignore_permissions=True)


# ---- shift and sample orders ----


def _ensure_shift(profile, user):
	existing = frappe.db.get_value(
		"POS Opening Entry",
		{"user": user, "status": "Open", "docstatus": 1},
		["name", "pos_profile"],
		as_dict=True,
	)
	if existing:
		return existing.name
	entry = frappe.get_doc(
		{
			"doctype": "POS Opening Entry",
			"user": user,
			"company": profile.company,
			"pos_profile": profile.name,
			"period_start_date": frappe.utils.now_datetime(),
			"posting_date": nowdate(),
			"balance_details": [
				{
					"mode_of_payment": row.mode_of_payment,
					"opening_amount": 5000 if row.mode_of_payment == "Cash" else 0,
				}
				for row in profile.payments
			],
		}
	)
	entry.insert(ignore_permissions=True)
	entry.submit()
	return entry.name


def _as(user, function, **kwargs):
	"""Run one order call as a staff member, so waiter/cashier attribution is real."""
	previous = frappe.session.user
	frappe.set_user(user)
	try:
		return function(**kwargs)
	finally:
		frappe.set_user(previous)


def _tables(profile_name):
	return {
		row.table_label: row.name
		for row in frappe.get_all(
			"VunaPOS Restaurant Table", filters={"pos_profile": profile_name}, fields=["name", "table_label"]
		)
	}


def _create_sample_orders(profile_name):
	from vunapos.services import restaurant_order_service as orders

	if frappe.db.exists("VunaPOS Restaurant Order", {"pos_profile": profile_name}):
		_log("Sample orders already exist; not adding more")
		return
	tables = _tables(profile_name)

	def item(code, qty=1, note=None):
		return {"item_code": code, "qty": qty, "note": note}

	# Open dine-in orders on the Main Hall and Terrace (tables show as Occupied).
	t1 = _as(
		WAITER_JANE,
		orders.create_order,
		pos_profile=profile_name,
		service_type="Dine In",
		table=tables["T1"],
		pax=4,
		items=[
			item("GE-BIRYANI", 2, "One without chillies"),
			item("GE-NYAMA-CHOMA", 1, "Well done, extra kachumbari"),
			item("GE-PASSION", 2),
			item("GE-COKE", 2),
		],
	)
	# A second round on the same table, added later by the same waiter.
	_as(WAITER_JANE, orders.add_items, order=t1["name"], items=[item("GE-TEA", 4), item("GE-CHOC-CAKE", 2)])
	_as(
		WAITER_BRIAN,
		orders.create_order,
		pos_profile=profile_name,
		service_type="Dine In",
		table=tables["T5"],
		pax=2,
		order_note="Anniversary - bring the dessert with a candle",
		items=[item("GE-TILAPIA", 2), item("GE-MANGO", 2), item("GE-ICE-CREAM", 2)],
	)
	_as(
		WAITER_BRIAN,
		orders.create_order,
		pos_profile=profile_name,
		service_type="Dine In",
		table=tables["R2"],
		pax=3,
		items=[item("GE-TUSKER", 3), item("GE-MISHKAKI", 2), item("GE-WINGS", 1)],
	)
	# An open takeaway order for a named customer, waiting to be collected.
	_as(
		CASHIER,
		orders.create_order,
		pos_profile=profile_name,
		service_type="Takeaway",
		customer="John Kamau",
		order_note="Collecting at 1pm",
		items=[item("GE-FAMILY-PILAU", 1), item("GE-WATER", 4)],
	)

	# Billed orders: one dine-in paid in cash, one delivery paid by M-Pesa.
	t2 = _as(
		WAITER_JANE,
		orders.create_order,
		pos_profile=profile_name,
		service_type="Dine In",
		table=tables["T2"],
		pax=2,
		items=[item("GE-PILAU", 1), item("GE-VEG-CURRY", 1), item("GE-FANTA", 2)],
	)
	_as(
		CASHIER,
		orders.checkout_order,
		order=t2["name"],
		payments=[{"mode_of_payment": "Cash", "amount": 2000}],
		idempotency_key=f"demo-{t2['name']}",
	)
	delivery = _as(
		CASHIER,
		orders.create_order,
		pos_profile=profile_name,
		service_type="Delivery",
		customer="Aisha Mohamed",
		order_note="Deliver to Kilimani, Gate B",
		items=[item("GE-WINGS-BUCKET", 1), item("GE-SPRITE", 4)],
	)
	_as(
		CASHIER,
		orders.checkout_order,
		order=delivery["name"],
		payments=[
			{
				"mode_of_payment": MPESA,
				"amount": 2880,
				"reference_no": "SJK2X8Y7ZQ",
				"reference_date": nowdate(),
			}
		],
		idempotency_key=f"demo-{delivery['name']}",
	)

	# A cancelled order: the waiter asks, the supervisor's PIN approves.
	t3 = _as(
		WAITER_BRIAN,
		orders.create_order,
		pos_profile=profile_name,
		service_type="Dine In",
		table=tables["T3"],
		pax=2,
		items=[item("GE-SOUP", 2), item("GE-BLACK-COFFEE", 2)],
	)
	from vunapos.services.pin_service import verify_manager_pin

	token = _as(
		WAITER_BRIAN, verify_manager_pin, pos_profile=profile_name, pin=MANAGER_PIN, action="order_cancel"
	)
	_as(
		WAITER_BRIAN,
		orders.cancel_order,
		order=t3["name"],
		reason="Guests left before ordering was confirmed",
		manager_pin_token=token["token"],
	)
	_log("Sample orders created: 4 open, 2 billed (Cash, M-Pesa), 1 cancelled")


# ---- entry point ----


def create_restaurant_demo(pos_profile="Nairobi"):
	frappe.set_user("Administrator")
	profile = frappe.get_doc("POS Profile", pos_profile)
	company = profile.company
	price_list = profile.selling_price_list or "Standard Selling"

	_ensure_item_groups()
	_ensure_items(price_list)
	_ensure_opening_stock(company, profile.warehouse)
	_ensure_customers()
	_ensure_mpesa(company)
	_ensure_staff()
	_ensure_service_type_pricing(company, profile.currency)
	_log("Service type pricing: Takeaway Prices, Family Pack Deal (15%), Dine In service charge (10%)")
	_log(f"Masters ready: {len(ITEMS)} items, {len(CUSTOMERS)} customers, {len(STAFF)} staff users")

	profile = _configure_profile(pos_profile, price_list)
	_configure_floors(pos_profile)
	_configure_menu(pos_profile)
	_log("POS Profile configured: service types, menu, PIN staff, payment modes")

	shift = _ensure_shift(profile, CASHIER)
	_log(f"Cashier shift open: {shift}")
	_create_sample_orders(pos_profile)
	frappe.db.commit()  # nosemgrep
	_log("Done")
