# Restaurant POS Design

Status: agreed design decisions for the VunaPOS Restaurant POS feature. Decisions 1-4
apply to the current phase (floor plan backend and editor). Decisions 5-8 are recorded
now so early work does not block them, and are implemented in later phases.

## Decisions

### 1. POS mode per POS Profile

- POS Profile carries a Select field `vunapos_pos_mode` with options `Retail` (default)
  and `Restaurant`. The option list is open-ended so further modes can be added later.
- A site can run Retail and Restaurant profiles side by side.
- When a user opens VunaPOS, the app routes automatically to the interface for the mode
  of their resolved POS Profile. There is no mode picker in the UI.
- Retail profiles behave exactly as they do today.
- Existing profiles are set to `Retail` on migrate, and the bootstrap payload treats any
  missing or unknown value as `Retail`.

### 2. Floor plan editor and virtual canvas

- Floors, tables and decor elements (walls, doors, windows, bar counters, plants,
  labels) are laid out in an Odoo-style drag and drop editor inside the SPA.
- Positions and sizes are stored on a fixed virtual canvas of **1000 x 700 units**, not
  screen pixels, so a layout scales to any device.
- Validation checks the unrotated bounding box: `0 <= x`, `x + width <= 1000`,
  `0 <= y`, `y + height <= 700`, and `width`, `height` > 0. A rotated shape's corners may
  extend slightly past the canvas edge.
- Rotation is stored in degrees and normalised to `[0, 360)`.

### 3. Table status is derived

- Table status (free, occupied, bill requested) is derived from open orders and is
  never stored on the table.

### 4. UI rules

- Every restaurant screen is fully responsive (phone, tablet, laptop, desktop) and
  works with mouse and touch through pointer events.
- Restaurant screens reuse the retail POS theme, components, Tailwind tokens,
  light/dark mode and layout shell (`Header`, `Sidebar`, `AppShell`) so they look like
  part of the same app.

### 5. Restaurant Order doctype (later phase)

- Open table orders live in a new Restaurant Order doctype with stable line IDs.
- An order is owned by its table and POS Profile, not by a cashier session.
- The POS session is stamped only at payment, when the order is converted into a normal
  cart and goes through the existing `create_and_submit_invoice` checkout.
- Existing checkout code stays untouched.

### 6. Opening Entry only for payment (later phase)

- Waiters and kitchen staff do not need a POS Opening Entry to use Restaurant mode.
- `PosOpeningGate` is **not removed** in Restaurant mode; it **moves**. Instead of
  guarding the whole app, it guards payment: any user taking payment must have an open
  POS Opening Entry before checkout.
- Retail mode keeps the current behaviour, where the gate guards the whole app.

### 7. Closing a shift with open tables (later phase)

- Closing a shift while tables have open orders is allowed, with a warning.
- Open orders carry over to the next session.

### 8. Service type naming (later phase)

- Dine in / takeaway / delivery is called `service_type`. This avoids a clash with the
  existing `OrderType` (`Sales Invoice` / `Sales Order`) used by the retail POS.

## Data model (current phase)

All doctypes are in module VunaPOS.

| Doctype | Kind | Notes |
| --- | --- | --- |
| VunaPOS Restaurant Floor | Standalone, hash naming, title `floor_name` | `floor_name`, `pos_profile`, `display_order`, `is_active`, `background_color`, `background_image` (public file), `elements` |
| VunaPOS Floor Element | Child table of Floor | `element_type` (Wall, Door, Window, Bar Counter, Plant, Label), `label`, `x`, `y`, `width`, `height`, `rotation`, `color` |
| VunaPOS Restaurant Table | Standalone, hash naming, title `table_label` | `floor`, `pos_profile`, `table_label`, `seats`, `shape`, `x`, `y`, `width`, `height`, `rotation`, `color`, `is_active` |

- Tables are standalone so future Restaurant Orders can link to them. Elements are a
  child table because nothing links to them.
- `pos_profile` and `floor` are search indexed.
- `table.pos_profile` is set explicitly from its floor on every save, so it never relies
  on `fetch_from` alone.
- Element draw order follows the row order of the `elements` table.

### Validation rules

Shared validators live in `vunapos/services/floor_plan_service.py`. They are called by
`save_floor_plan` and by the doctype controllers' `validate()`, so Desk edits follow the
same rules.

- The POS Profile is in Restaurant mode.
- Floor names are unique per POS Profile (case-insensitive, trimmed).
- Table labels are unique per POS Profile (case-insensitive, trimmed).
- Coordinates and sizes are within the canvas.
- `seats >= 1`.
- A table's floor belongs to the same POS Profile.

## API (current phase)

Both methods use the standard VunaPOS response envelope.

### `vunapos.api.restaurant.get_floor_plan(pos_profile, include_inactive=0)`

Returns the profile's floors with their tables and elements, sorted by `display_order`
then `floor_name`:

```json
{
  "pos_profile": "Main Restaurant",
  "pos_mode": "Restaurant",
  "canvas": { "width": 1000, "height": 700 },
  "version": "2026-10-22 10:15:00.000000",
  "floors": [
    {
      "name": "a1b2c3", "floor_name": "Main Hall", "display_order": 0, "is_active": 1,
      "background_color": null, "background_image": null,
      "elements": [{ "element_type": "Wall", "x": 0, "y": 0, "width": 1000, "height": 20 }],
      "tables": [{ "name": "d4e5f6", "table_label": "T1", "seats": 4, "shape": "Square" }]
    }
  ]
}
```

Inactive floors and tables are included only when a manager passes
`include_inactive=1`.

### `vunapos.api.restaurant.save_floor_plan(pos_profile, payload)` (POST)

Saves the whole layout in one atomic call.

- Floors and tables with a `name` are updated. New rows carry a `client_id` instead,
  and the response maps each `client_id` to the name it was given.
- Floors or tables missing from the payload are deleted. Deleting a floor deletes its
  tables. Elements are replaced as a whole child table.
- The payload carries the `version` from the last load. A stale version is rejected
  with `FLOOR_PLAN_CONFLICT`, so two managers cannot silently overwrite each other.
- Everything is validated before anything is written. Writes run inside a database
  savepoint, and any failure rolls back to it, so a failed save changes nothing.

Error codes: `POS_MODE_NOT_RESTAURANT`, `DUPLICATE_FLOOR_NAME`, `DUPLICATE_TABLE_LABEL`,
`ELEMENT_OUT_OF_CANVAS`, `INVALID_SEATS`, `FLOOR_PROFILE_MISMATCH`,
`FLOOR_PLAN_PERMISSION_DENIED`, `FLOOR_PLAN_CONFLICT`.

### Deleting tables

Tables are hard deleted for now, through a single `_retire_table()` function. Once
Restaurant Orders link to tables, that function changes to deactivate (`is_active = 0`)
tables that have linked orders. Its callers do not change.

## Permissions

- New role: **VunaPOS Restaurant Manager**, created by `ensure_vunapos_roles()` during
  install, migrate and test setup.
- Saving a floor plan requires VunaPOS Restaurant Manager or System Manager.
- Reading a floor plan requires only that the user is assigned to the POS Profile. Reads
  do not need DocType permissions or a POS Opening Entry, so waiters can load the floor.
- DocType permissions: VunaPOS Restaurant Manager and System Manager have full access to
  Floor and Table; Sales User can read.

## SPA integration (later step)

- The mode switch sits directly below `BootstrapGate`, the first point where the
  resolved profile is known. Retail keeps the current chain
  (`PosOpeningGate -> AuthenticatedApp -> POSHomePage`) unchanged. Restaurant renders its
  own app inside the shared `AppShell`, with `PosOpeningGate` moved to guard payment
  (decision 6).
- `navigationStore` gains restaurant pages (`/vunapos/floor`, `/vunapos/floor/edit`).
  In Restaurant mode, `/vunapos` resolves to the floor view.
- `POSHomePage` stays retail-only.
