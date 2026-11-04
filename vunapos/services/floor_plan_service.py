import hashlib
import json

import frappe
from frappe import _
from frappe.utils import cint, cstr, flt

from vunapos.dto.restaurant import floor_to_dict
from vunapos.services.profile_service import require_pos_profile_assignment
from vunapos.setup.utils import DEFAULT_POS_MODE, RESTAURANT_MANAGER_ROLE

CANVAS_WIDTH = 1000
CANVAS_HEIGHT = 700
FLOOR_DOCTYPE = "VunaPOS Restaurant Floor"
TABLE_DOCTYPE = "VunaPOS Restaurant Table"
ELEMENT_DOCTYPE = "VunaPOS Floor Element"
MANAGER_ROLES = (RESTAURANT_MANAGER_ROLE, "System Manager")
ELEMENT_TYPES = ("Wall", "Door", "Window", "Bar Counter", "Plant", "Label")
TABLE_SHAPES = ("Square", "Round", "Rectangle", "Oval")
DEFAULT_TABLE_SHAPE = "Square"
FLOOR_FIELDS = (
	"name",
	"floor_name",
	"pos_profile",
	"display_order",
	"is_active",
	"background_color",
	"background_image",
	"modified",
)
TABLE_FIELDS = (
	"name",
	"floor",
	"pos_profile",
	"table_label",
	"seats",
	"shape",
	"x",
	"y",
	"width",
	"height",
	"rotation",
	"color",
	"is_active",
	"modified",
)
ELEMENT_FIELDS = ("name", "parent", "element_type", "label", "x", "y", "width", "height", "rotation", "color")
# Set while save_floor_plan writes a layout it has already validated as a whole.
# Uniqueness is then checked against the final layout, so swapping two table
# labels in one save does not trip the per-document database checks.
VALIDATED_FLAG = "vunapos_floor_plan_validated"


def _throw(code, message, meta=None, exc_type=frappe.ValidationError):
	exc = exc_type(message)
	exc.vuna_error_code = code
	exc.vuna_error_meta = meta or {}
	raise exc


def _label_key(value):
	return cstr(value).strip().casefold()


def is_floor_plan_manager(user=None):
	roles = frappe.get_roles(user or frappe.session.user)
	return any(role in roles for role in MANAGER_ROLES)


def require_floor_plan_manager():
	if not is_floor_plan_manager():
		_throw(
			"FLOOR_PLAN_PERMISSION_DENIED",
			_("Only a VunaPOS Restaurant Manager can change the floor plan"),
			exc_type=frappe.PermissionError,
		)


def require_restaurant_profile(pos_profile):
	if not pos_profile or not frappe.db.exists("POS Profile", pos_profile):
		_throw("POS_PROFILE_NOT_FOUND", _("POS Profile {0} was not found").format(pos_profile))
	pos_mode = frappe.db.get_value("POS Profile", pos_profile, "vunapos_pos_mode") or DEFAULT_POS_MODE
	if pos_mode != "Restaurant":
		_throw(
			"POS_MODE_NOT_RESTAURANT",
			_("POS Profile {0} is not in Restaurant mode").format(pos_profile),
			{"pos_profile": pos_profile, "pos_mode": pos_mode},
		)
	return pos_profile


def _require_floor_plan_reader(pos_profile):
	# Waiters only need to be assigned to the profile. Managers may set up a
	# profile's floors without being one of its cashiers.
	if not is_floor_plan_manager():
		require_pos_profile_assignment(pos_profile)


def normalize_rotation(value):
	return flt(value) % 360


def validate_canvas_box(x, y, width, height, label):
	x, y, width, height = flt(x), flt(y), flt(width), flt(height)
	if width <= 0 or height <= 0:
		_throw(
			"ELEMENT_OUT_OF_CANVAS",
			_("{0} must have a width and height greater than zero").format(label),
			{"label": label},
		)
	if x < 0 or y < 0 or x + width > CANVAS_WIDTH or y + height > CANVAS_HEIGHT:
		_throw(
			"ELEMENT_OUT_OF_CANVAS",
			_("{0} must fit inside the {1} x {2} floor canvas").format(label, CANVAS_WIDTH, CANVAS_HEIGHT),
			{"label": label, "x": x, "y": y, "width": width, "height": height},
		)


def validate_seats(seats, label):
	if flt(seats) != cint(seats) or cint(seats) < 1:
		_throw(
			"INVALID_SEATS",
			_("Table {0} must have at least one seat").format(label),
			{"label": label, "seats": seats},
		)


def _validate_element_type(element_type, floor_name):
	if element_type not in ELEMENT_TYPES:
		_throw(
			"INVALID_FLOOR_PLAN",
			_("Floor {0} has an unsupported element type: {1}").format(floor_name, element_type),
			{"element_type": element_type},
		)


def _validate_table_shape(shape, label):
	if shape not in TABLE_SHAPES:
		_throw(
			"INVALID_FLOOR_PLAN",
			_("Table {0} has an unsupported shape: {1}").format(label, shape),
			{"shape": shape},
		)


def _throw_duplicate_floor_name(floor_name):
	_throw(
		"DUPLICATE_FLOOR_NAME",
		_("Floor name {0} is already used in this POS Profile").format(floor_name),
		{"floor_name": floor_name},
	)


def _throw_duplicate_table_label(table_label):
	_throw(
		"DUPLICATE_TABLE_LABEL",
		_("Table label {0} is already used in this POS Profile").format(table_label),
		{"table_label": table_label},
	)


# ---- document validators (called from the doctype controllers) ----


def validate_floor_doc(doc):
	doc.floor_name = cstr(doc.floor_name).strip()
	if not doc.floor_name:
		_throw("INVALID_FLOOR_PLAN", _("Floor name is required"))
	require_restaurant_profile(doc.pos_profile)
	if (
		not doc.is_new()
		and doc.has_value_changed("pos_profile")
		and frappe.db.exists(TABLE_DOCTYPE, {"floor": doc.name})
	):
		_throw(
			"FLOOR_PROFILE_MISMATCH",
			_("Floor {0} has tables and cannot be moved to another POS Profile").format(doc.floor_name),
			{"floor": doc.name},
		)
	for row in doc.get("elements") or []:
		label = row.label or row.element_type or _("Element")
		_validate_element_type(row.element_type, doc.floor_name)
		validate_canvas_box(row.x, row.y, row.width, row.height, label)
		row.rotation = normalize_rotation(row.rotation)
	if doc.flags.get(VALIDATED_FLAG):
		return
	key = _label_key(doc.floor_name)
	for row in frappe.get_all(
		FLOOR_DOCTYPE,
		filters={"pos_profile": doc.pos_profile, "name": ["!=", doc.name or ""]},
		fields=["floor_name"],
	):
		if _label_key(row.floor_name) == key:
			_throw_duplicate_floor_name(doc.floor_name)


def validate_table_doc(doc):
	doc.table_label = cstr(doc.table_label).strip()
	if not doc.table_label:
		_throw("INVALID_FLOOR_PLAN", _("Table label is required"))
	floor_profile = frappe.db.get_value(FLOOR_DOCTYPE, doc.floor, "pos_profile") if doc.floor else None
	if not floor_profile:
		_throw(
			"FLOOR_PROFILE_MISMATCH",
			_("Table {0} must belong to an existing floor").format(doc.table_label),
			{"floor": doc.floor},
		)
	# Set explicitly rather than relying on fetch_from, which only refreshes
	# when the table itself is re-saved.
	doc.pos_profile = floor_profile
	require_restaurant_profile(doc.pos_profile)
	doc.shape = doc.shape or DEFAULT_TABLE_SHAPE
	_validate_table_shape(doc.shape, doc.table_label)
	validate_seats(doc.seats, doc.table_label)
	validate_canvas_box(doc.x, doc.y, doc.width, doc.height, doc.table_label)
	doc.rotation = normalize_rotation(doc.rotation)
	if doc.flags.get(VALIDATED_FLAG):
		return
	key = _label_key(doc.table_label)
	for row in frappe.get_all(
		TABLE_DOCTYPE,
		filters={"pos_profile": doc.pos_profile, "name": ["!=", doc.name or ""]},
		fields=["table_label"],
	):
		if _label_key(row.table_label) == key:
			_throw_duplicate_table_label(doc.table_label)


# ---- reading ----


def _get_profile_rows(pos_profile):
	floors = frappe.get_all(
		FLOOR_DOCTYPE,
		filters={"pos_profile": pos_profile},
		fields=list(FLOOR_FIELDS),
		order_by="display_order asc, floor_name asc",
	)
	tables = frappe.get_all(
		TABLE_DOCTYPE,
		filters={"pos_profile": pos_profile},
		fields=list(TABLE_FIELDS),
		order_by="table_label asc",
	)
	return floors, tables


def _plan_version(floors, tables):
	# A digest of every row's identity and modified timestamp. Unlike the
	# newest timestamp alone, it also changes when a row is deleted.
	rows = sorted(
		[("floor", row.name, cstr(row.modified)) for row in floors]
		+ [("table", row.name, cstr(row.modified)) for row in tables]
	)
	return hashlib.sha1(json.dumps(rows).encode()).hexdigest()


def get_floor_plan_version(pos_profile):
	return _plan_version(*_get_profile_rows(pos_profile))


def get_floor_plan(pos_profile):
	require_restaurant_profile(pos_profile)
	_require_floor_plan_reader(pos_profile)
	can_edit = is_floor_plan_manager()
	floors, tables = _get_profile_rows(pos_profile)
	version = _plan_version(floors, tables)
	# Managers receive inactive rows too. save_floor_plan deletes anything left
	# out of its payload, so the editor must always see the complete layout.
	if not can_edit:
		floors = [row for row in floors if cint(row.is_active)]
		tables = [row for row in tables if cint(row.is_active)]

	elements_by_floor = {}
	if floors:
		for row in frappe.get_all(
			ELEMENT_DOCTYPE,
			filters={
				"parenttype": FLOOR_DOCTYPE,
				"parentfield": "elements",
				"parent": ["in", [floor.name for floor in floors]],
			},
			fields=list(ELEMENT_FIELDS),
			order_by="idx asc",
		):
			elements_by_floor.setdefault(row.parent, []).append(row)
	tables_by_floor = {}
	for row in tables:
		tables_by_floor.setdefault(row.floor, []).append(row)

	return {
		"pos_profile": pos_profile,
		"pos_mode": "Restaurant",
		"canvas": {"width": CANVAS_WIDTH, "height": CANVAS_HEIGHT},
		"version": version,
		"can_edit": can_edit,
		"floors": [
			floor_to_dict(floor, elements_by_floor.get(floor.name, []), tables_by_floor.get(floor.name, []))
			for floor in floors
		],
	}


# ---- saving ----


def _parse_payload(payload):
	if isinstance(payload, str):
		try:
			payload = json.loads(payload)
		except ValueError:
			_throw("INVALID_FLOOR_PLAN", _("The floor plan payload is not valid JSON"))
	if not isinstance(payload, dict) or not isinstance(payload.get("floors", []), list):
		_throw("INVALID_FLOOR_PLAN", _("The floor plan payload must contain a list of floors"))
	return payload


def _row_identity(row, kind, existing, seen_names, seen_client_ids, pos_profile):
	name = cstr(row.get("name")).strip() or None
	if name:
		if name not in existing:
			_throw(
				"FLOOR_PROFILE_MISMATCH",
				_("{0} {1} does not belong to POS Profile {2}").format(kind, name, pos_profile),
				{"name": name},
			)
		if name in seen_names:
			_throw("INVALID_FLOOR_PLAN", _("{0} {1} appears more than once").format(kind, name))
		seen_names.add(name)
		return name, None
	client_id = cstr(row.get("client_id")).strip()
	if not client_id or client_id in seen_client_ids:
		_throw(
			"INVALID_FLOOR_PLAN",
			_("Each new {0} needs a unique client_id").format(kind.lower()),
			{"client_id": client_id},
		)
	seen_client_ids.add(client_id)
	return None, client_id


def _normalize_element(row, floor_name):
	element = {
		"element_type": cstr(row.get("element_type")).strip(),
		"label": cstr(row.get("label")).strip() or None,
		"x": flt(row.get("x")),
		"y": flt(row.get("y")),
		"width": flt(row.get("width")),
		"height": flt(row.get("height")),
		"rotation": normalize_rotation(row.get("rotation")),
		"color": row.get("color") or None,
	}
	_validate_element_type(element["element_type"], floor_name)
	validate_canvas_box(
		element["x"],
		element["y"],
		element["width"],
		element["height"],
		element["label"] or element["element_type"],
	)
	return element


def _normalize_table(row):
	table = {
		"table_label": cstr(row.get("table_label")).strip(),
		"seats": row.get("seats", 2),
		"shape": cstr(row.get("shape")).strip() or DEFAULT_TABLE_SHAPE,
		"x": flt(row.get("x")),
		"y": flt(row.get("y")),
		"width": flt(row.get("width", 80)),
		"height": flt(row.get("height", 80)),
		"rotation": normalize_rotation(row.get("rotation")),
		"color": row.get("color") or None,
		"is_active": cint(row.get("is_active", 1)),
	}
	if not table["table_label"]:
		_throw("INVALID_FLOOR_PLAN", _("Table label is required"))
	_validate_table_shape(table["shape"], table["table_label"])
	validate_seats(table["seats"], table["table_label"])
	table["seats"] = cint(table["seats"])
	validate_canvas_box(table["x"], table["y"], table["width"], table["height"], table["table_label"])
	return table


def _validate_payload(payload, pos_profile, existing_floors, existing_tables):
	"""Validate the complete layout before any write happens."""
	floors = []
	floor_names = set()
	table_labels = set()
	seen = {"floor_names": set(), "floor_ids": set(), "table_names": set(), "table_ids": set()}
	for floor_row in payload.get("floors") or []:
		if not isinstance(floor_row, dict):
			_throw("INVALID_FLOOR_PLAN", _("Each floor must be an object"))
		name, client_id = _row_identity(
			floor_row, "Floor", existing_floors, seen["floor_names"], seen["floor_ids"], pos_profile
		)
		floor_name = cstr(floor_row.get("floor_name")).strip()
		if not floor_name:
			_throw("INVALID_FLOOR_PLAN", _("Floor name is required"))
		if _label_key(floor_name) in floor_names:
			_throw_duplicate_floor_name(floor_name)
		floor_names.add(_label_key(floor_name))

		elements = floor_row.get("elements") or []
		tables = floor_row.get("tables") or []
		if not isinstance(elements, list) or not isinstance(tables, list):
			_throw("INVALID_FLOOR_PLAN", _("Floor {0} elements and tables must be lists").format(floor_name))
		normalized_elements = []
		for element_row in elements:
			if not isinstance(element_row, dict):
				_throw("INVALID_FLOOR_PLAN", _("Each element must be an object"))
			normalized_elements.append(_normalize_element(element_row, floor_name))
		normalized_tables = []
		for table_row in tables:
			if not isinstance(table_row, dict):
				_throw("INVALID_FLOOR_PLAN", _("Each table must be an object"))
			table_name, table_client_id = _row_identity(
				table_row, "Table", existing_tables, seen["table_names"], seen["table_ids"], pos_profile
			)
			table = _normalize_table(table_row)
			if _label_key(table["table_label"]) in table_labels:
				_throw_duplicate_table_label(table["table_label"])
			table_labels.add(_label_key(table["table_label"]))
			normalized_tables.append({"name": table_name, "client_id": table_client_id, "values": table})

		floors.append(
			{
				"name": name,
				"client_id": client_id,
				"values": {
					"floor_name": floor_name,
					"display_order": cint(floor_row.get("display_order")),
					"is_active": cint(floor_row.get("is_active", 1)),
					"background_color": floor_row.get("background_color") or None,
					"background_image": floor_row.get("background_image") or None,
				},
				"elements": normalized_elements,
				"tables": normalized_tables,
			}
		)
	return floors


def _retire_table(table_name):
	# Hard delete until Restaurant Orders link to tables. At that point this
	# becomes "deactivate when linked orders exist, otherwise delete", and its
	# callers stay unchanged.
	frappe.delete_doc(TABLE_DOCTYPE, table_name, ignore_permissions=True)


def _upsert_floor(floor, pos_profile):
	if floor["name"]:
		doc = frappe.get_doc(FLOOR_DOCTYPE, floor["name"])
	else:
		doc = frappe.new_doc(FLOOR_DOCTYPE)
		doc.pos_profile = pos_profile
	doc.update(floor["values"])
	doc.set("elements", floor["elements"])
	doc.flags[VALIDATED_FLAG] = True
	doc.save(ignore_permissions=True)
	return doc.name


def _upsert_table(table, floor_name):
	if table["name"]:
		doc = frappe.get_doc(TABLE_DOCTYPE, table["name"])
	else:
		doc = frappe.new_doc(TABLE_DOCTYPE)
	doc.update(table["values"])
	doc.floor = floor_name
	doc.flags[VALIDATED_FLAG] = True
	doc.save(ignore_permissions=True)
	return doc.name


def save_floor_plan(pos_profile, payload):
	require_floor_plan_manager()
	require_restaurant_profile(pos_profile)
	payload = _parse_payload(payload)

	savepoint = "vunapos_floor_plan"
	frappe.db.savepoint(savepoint)
	try:
		# Lock the profile row so concurrent saves for one profile run one at a
		# time and the version check below cannot race.
		frappe.db.get_value("POS Profile", pos_profile, "name", for_update=True)
		existing_floors, existing_tables = _get_profile_rows(pos_profile)
		version = _plan_version(existing_floors, existing_tables)
		if cstr(payload.get("version")) != version:
			_throw(
				"FLOOR_PLAN_CONFLICT",
				_("The floor plan was changed by someone else. Reload it and try again."),
				{"version": version},
			)
		floors = _validate_payload(
			payload,
			pos_profile,
			{row.name for row in existing_floors},
			{row.name for row in existing_tables},
		)

		kept_floors = {floor["name"] for floor in floors if floor["name"]}
		kept_tables = {table["name"] for floor in floors for table in floor["tables"] if table["name"]}
		for row in existing_tables:
			if row.name not in kept_tables:
				_retire_table(row.name)

		id_map = {"floors": {}, "tables": {}}
		for floor in floors:
			floor_name = _upsert_floor(floor, pos_profile)
			if floor["client_id"]:
				id_map["floors"][floor["client_id"]] = floor_name
			for table in floor["tables"]:
				table_name = _upsert_table(table, floor_name)
				if table["client_id"]:
					id_map["tables"][table["client_id"]] = table_name

		# Floors go last: their tables have been moved or deleted by now, so
		# the link check on delete passes.
		for row in existing_floors:
			if row.name not in kept_floors:
				frappe.delete_doc(FLOOR_DOCTYPE, row.name, ignore_permissions=True)
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		raise

	return {"plan": get_floor_plan(pos_profile), "id_map": id_map}
