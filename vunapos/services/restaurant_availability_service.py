"""Branch-scoped operational pauses, independent of physical stock or routing.

A pause only blocks new orders. It never disables an Item or changes an
existing KOT, Work Order, reservation or bill. Expiry is evaluated on reads.
"""

import hashlib

import frappe
from frappe import _
from frappe.utils import cint, get_datetime, now_datetime

DOCTYPE = "Restaurant Availability"
MANAGERS = {"System Manager", "VunaPOS Restaurant Manager"}


def lock_branch(branch):
	frappe.db.get_value("Branch", branch, "name", for_update=True)


def validate(doc):
	from vunapos.services.restaurant_service import require_restaurant_context

	if not set(frappe.get_roles()) & MANAGERS:
		frappe.throw(_("A restaurant manager must change ordering availability."), frappe.PermissionError)
	context = require_restaurant_context(doc.restaurant, branch=doc.branch)
	doc.company = context.company
	lock_branch(doc.branch)
	if doc.target_type not in ("Item", "Kitchen Station"):
		frappe.throw(_("Choose Item or Kitchen Station."))
	if doc.target_type == "Item":
		if not doc.item or doc.kitchen_station:
			frappe.throw(_("Select one Item and leave Kitchen Station empty."))
		target = frappe.get_doc("Item", doc.item)
		target.check_permission("read")
		if target.disabled or not target.is_sales_item:
			frappe.throw(_("Choose an enabled sales item or variant template."))
	else:
		if not doc.kitchen_station or doc.item:
			frappe.throw(_("Select one Kitchen Station and leave Item empty."))
		target = frappe.get_doc("Kitchen Station", doc.kitchen_station)
		target.check_permission("read")
		if (target.restaurant, target.branch) != (doc.restaurant, doc.branch):
			frappe.throw(_("Choose a kitchen station belonging to this Restaurant and Branch."))
	doc.reason = (doc.reason or "").strip()
	if not doc.reason or len(doc.reason) > 500:
		frappe.throw(_("Enter a reason of 1 to 500 characters for the availability decision."))
	if cint(doc.paused) and doc.unavailable_until and get_datetime(doc.unavailable_until) <= now_datetime():
		frappe.throw(_("Unavailable Until must be in the future, or clear Temporarily Unavailable."))
	identity = (doc.restaurant, doc.branch, doc.target_type, doc.item, doc.kitchen_station)
	previous = doc.get_doc_before_save()
	if previous and identity != tuple(
		previous.get(field) for field in ("restaurant", "branch", "target_type", "item", "kitchen_station")
	):
		frappe.throw(_("Availability history cannot be moved. Resume this record and create a separate one."))
	doc.availability_key = hashlib.sha256(frappe.as_json(identity).encode()).hexdigest()
	existing = frappe.db.get_value(
		DOCTYPE, {"availability_key": doc.availability_key, "name": ["!=", doc.name or ""]}, "name"
	)
	if existing:
		frappe.throw(
			_(
				"An availability record already exists for this target in this branch: {0}. Edit or resume that record instead."
			).format(existing)
		)
	doc.target_label = target.get("item_name") or target.get("station_name") or target.name


def active(restaurant, branch, *, lock=False):
	# Safe during upgrades before the new DocType has been synced.
	if not branch or not frappe.db.table_exists(DOCTYPE):
		return []
	return [
		row
		for row in frappe.qb.get_query(
			DOCTYPE,
			filters={"restaurant": restaurant, "branch": branch, "paused": 1},
			fields=[
				"name",
				"target_type",
				"item",
				"kitchen_station",
				"target_label",
				"reason",
				"unavailable_until",
			],
			order_by="modified desc",
			for_update=lock,
		).run(as_dict=True)
		if not row.unavailable_until or get_datetime(row.unavailable_until) > now_datetime()
	]


def _reason(row):
	return _("Temporarily unavailable: {0}. {1}").format(row.target_label, row.reason)


def check_items(restaurant, branch, codes):
	from vunapos.services.kitchen_service import fail

	codes = set(codes)
	parents = frappe.get_all("Item", filters={"name": ["in", list(codes) or [""]]}, pluck="variant_of")
	codes.update(parent for parent in parents if parent)
	for row in active(restaurant, branch, lock=True):
		if row.target_type == "Item" and row.item in codes:
			fail("RESTAURANT_ITEM_PAUSED", _reason(row))


def check_stations(restaurant, branch, stations):
	from vunapos.services.kitchen_service import fail

	for row in active(restaurant, branch, lock=True):
		if row.target_type == "Kitchen Station" and row.kitchen_station in stations:
			fail("RESTAURANT_STATION_PAUSED", _reason(row))


def annotate(restaurant, branch, items, floor=None, *, all_floors=False):
	from vunapos.services.kitchen_service import station_matches

	pauses = active(restaurant, branch)
	by_item = {row.item: row for row in pauses if row.target_type == "Item"}
	by_station = {row.kitchen_station: row for row in pauses if row.target_type == "Kitchen Station"}
	parents = dict(
		frappe.get_all(
			"Item",
			filters={"name": ["in", [item["item_code"] for item in items] or [""]]},
			fields=["name", "variant_of"],
			as_list=True,
		)
	)
	matches = (
		station_matches(
			restaurant, [item["item_code"] for item in items], branch, floor, all_floors=all_floors
		)
		if by_station
		else {}
	)
	for item in items:
		code = item["item_code"]
		pause = by_item.get(code) or by_item.get(parents.get(code))
		stations = matches.get(code, set())
		if not pause and stations and stations <= by_station.keys():
			pause = by_station[sorted(stations)[0]]
		item["ordering_paused"] = bool(pause)
		visible = (
			not pause
			or pause.target_type != "Kitchen Station"
			or frappe.has_permission("Kitchen Station", "read", doc=pause.kitchen_station)
		)
		item["availability_reason"] = (
			(
				_reason(pause)
				if visible
				else _("Preparation is temporarily unavailable. Ask a manager to review kitchen access.")
			)
			if pause
			else None
		)
	# Duration, not a timezone-dependent browser timestamp. A single refresh at
	# the nearest expiry restores availability even without a save/socket event.
	expiries = [
		(get_datetime(row.unavailable_until) - now_datetime()).total_seconds()
		for row in pauses
		if row.unavailable_until
	]
	return max(1, min(expiries) + 1) if expiries else None
