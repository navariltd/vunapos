# Restaurant POS Design

Status: agreed design decisions for the VunaPOS Restaurant POS feature. Decisions 1-4
apply to the current phase (floor plan backend and editor). Decisions 5-8 are recorded
now so early work does not block them, and are implemented in later phases. Decisions 6
and 12 (shift on entry for cashiers, and the restaurant roles) are built. Decision 13 is
built as far as removing the table colour; the status colours come with the order flow.

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

### 6. Shift on entry for users who take payment

- In Restaurant mode, whether a user needs a shift depends on one role: **VunaPOS
  Cashier**. Bootstrap returns it as `can_take_payment`. No other role counts, including
  VunaPOS Restaurant Manager and System Manager.
- Users with `can_take_payment` must open a POS Opening Entry on entry. `RestaurantApp`
  wraps the restaurant shell in the same `PosOpeningGate` and `PosOpeningEntryDialog`
  that Retail uses.
- Everyone else (waiters, managers without the Cashier role, and later kitchen staff)
  goes straight to the floor with no shift. They cannot bill: they have no permission to
  create invoices, so `checkout_order` refuses them even if they have a shift.
- `checkout_order` adds no role check of its own. The open shift is the accountability:
  checkout still requires the billing user's open POS Opening Entry.
- Close Shift is shown only to `can_take_payment` users: in the restaurant sidebar, and
  on phones from the Profile page (the bottom nav stays Floor and Profile). Closing the
  shift reloads the app, so the opening dialog is shown again.
- Retail mode is unchanged: the gate guards the whole app for every user.

### 7. Closing a shift with open tables (later phase)

- Closing a shift while tables have open orders is allowed, with a warning.
- Open orders carry over to the next session.

### 8. Service type naming (later phase)

- Dine in / takeaway / delivery is called `service_type`. This avoids a clash with the
  existing `OrderType` (`Sales Invoice` / `Sales Order`) used by the retail POS.

### 9. Item visibility per outlet (later phase)

- Which items an outlet sells is controlled by the standard POS Profile **Item Groups**
  table (`item_groups`). Listing a group includes all of its descendant groups.
- An empty table means all items are visible, which matches today's behaviour.
- This applies to every POS mode, not only Restaurant.
- The restaurant menu's category tabs are derived from these groups.
- **Risk:** VunaPOS ignores this table today. Existing retail profiles that already have
  it filled in will see fewer items once it is enforced. Release notes should call this
  out, and it should be checked on live profiles before rollout.

### 10. Deferred floor plan and Restaurant mode items (later phase)

Left out of the first floor plan UI and planned for later phases:

- **Pinch zoom and pan** on the floor canvas. For now a whole floor is always shown,
  scaled to fit the screen. Labels and seat counts have a minimum on-screen text size
  so they stay readable on phones.
- **Background image upload** in the floor editor. An existing `background_image` is
  drawn and kept on save, but can only be set in Desk for now.
- **Undo and redo** in the floor editor.
- **Sales History** in Restaurant mode. Close Shift is available to cashiers
  (decision 6).

### 11. Choosing among several POS Profiles (known gap, later phase)

Users assigned to several POS Profiles cannot reliably choose which one they work in.
This matters more once Retail and Restaurant profiles run side by side (decision 1).

Current behaviour:

- `resolve_pos_profile` picks the profile with the user's open POS Opening Entry,
  otherwise the first enabled assigned profile in alphabetical order. It ignores the
  **Default** flag on POS Profile User.
- The only profile picker is in the retail POS Opening Entry dialog. It appears when the
  user has more than one enabled assigned profile and no open shift on the resolved
  one. The choice is kept only in the browser and is lost on reload, unless a shift is
  opened on that profile.
- The picker also lists Restaurant profiles. Choosing one switches the app to
  Restaurant mode, but only until the next reload.
- Restaurant mode has no picker at all.

Agreed proposal (documentation only, nothing built yet):

| Situation | Behaviour |
| --- | --- |
| One assigned profile | Open it directly. |
| Several profiles, an open shift on one of them | Open the profile with the open shift directly, with no picker. Switching is blocked until that shift is closed. |
| Several profiles, no open shift | Ask once at login, in both Retail and Restaurant modes. Remember the choice only until logout. |

- A **Switch Profile** section is available in both Retail and Restaurant modes. It is
  shown only to users with several assigned profiles, and only works when the user has
  no open shift. This applies to managers too.
- The rules apply to any number of assigned profiles and to any POS mode, including
  modes added later.
- The **Default** tick on POS Profile User and the alphabetical fallback are not used.

**Needs lead approval:** this changes how retail resolves profiles today.

### 12. Restaurant roles

- **VunaPOS Waiter**, **VunaPOS Cashier** and **VunaPOS Restaurant Manager** are created
  in code with the permissions they need, so no manual setup is needed per site. See
  [Roles](#roles). **VunaPOS Kitchen** comes later and must follow the same pattern.
- Every role gets read permission on POS Profile.
- Reason: VunaPOS reads the resolved POS Profile during bootstrap. Standard ERPNext
  gives POS Profile read only to Accounts Manager, Accounts User and Sales Manager. A
  user with only Sales User is stopped with "POS Profile access required" until an
  administrator grants Sales User read on POS Profile in Role Permissions Manager.
  This was found while testing the floor view with a Sales User.

### 13. Table colour is reserved for status

- Tables have no colour of their own. The `color` field was removed from VunaPOS
  Restaurant Table, so a table's colour always means its status (decision 3).
- Floor `background_color` and VunaPOS Floor Element `color` are unchanged: they are decor.
- Until the order flow supplies a status, every table is drawn in one neutral style:
  surface fill with an `on-surface-variant` outline, and the primary colour when selected.
- Agreed status palette (light / dark theme):

  | Status | Light | Dark | When |
  | --- | --- | --- | --- |
  | Free | `#16A34A` green | `#4ADE80` | With the order flow |
  | Occupied | `#2563EB` blue | `#60A5FA` | With the order flow |
  | Bill requested | `#7C3AED` purple | `#A78BFA` | With the order flow |
  | In kitchen | `#D97706` amber | `#FBBF24` | Later |
  | Served | `#0D9488` teal | `#2DD4BF` | Later |
  | Reserved | `#64748B` slate | `#94A3B8` | Later |

- **Never colour alone.** Every status also has an icon or text label on the table, the
  floor view shows a legend, and the table's accessible name includes the status.
- Existing sites: saved table colours stay in the database column, which Frappe does
  not drop when a field is removed, but nothing reads or writes them. No patch is
  needed. A client that still sends `color` for a table is accepted and the value is
  ignored.

## Data model (current phase)

All doctypes are in module VunaPOS.

| Doctype | Kind | Notes |
| --- | --- | --- |
| VunaPOS Restaurant Floor | Standalone, hash naming, title `floor_name` | `floor_name`, `pos_profile`, `display_order`, `is_active`, `background_color`, `background_image` (public file), `elements` |
| VunaPOS Floor Element | Child table of Floor | `element_type` (Wall, Door, Window, Bar Counter, Plant, Label), `label`, `x`, `y`, `width`, `height`, `rotation`, `color` |
| VunaPOS Restaurant Table | Standalone, hash naming, title `table_label` | `floor`, `pos_profile`, `table_label`, `seats`, `shape`, `x`, `y`, `width`, `height`, `rotation`, `is_active`. No colour (decision 13). |

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

### `vunapos.api.restaurant.get_floor_plan(pos_profile)`

Returns the profile's floors with their tables and elements, sorted by `display_order`
then `floor_name`. Tables are sorted by `table_label`:

```json
{
  "pos_profile": "Main Restaurant",
  "pos_mode": "Restaurant",
  "canvas": { "width": 1000, "height": 700 },
  "version": "3f8a1c...",
  "can_edit": true,
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

- Who sees what is decided by role, not by a request parameter. Managers (VunaPOS
  Restaurant Manager or System Manager) always receive inactive floors and tables, with
  `is_active: false`, and `can_edit: true`. Everyone else receives active rows only and
  `can_edit: false`.
- There is deliberately no `include_inactive` option. `save_floor_plan` deletes any row
  missing from its payload, so an editor that loaded only active rows and then saved
  would delete every inactive floor and table.
- `version` is an opaque token: a SHA-1 digest of every floor and table's name and
  modified timestamp for the profile, including inactive rows. Unlike the newest
  timestamp alone, it also changes when a row is deleted. Clients send it back unchanged.
- The profile must be in Restaurant mode, so `pos_mode` is always `Restaurant`.

### `vunapos.api.restaurant.save_floor_plan(pos_profile, payload)` (POST)

Saves the whole layout in one atomic call.

- Floors and tables with a `name` are updated. New rows carry a `client_id` instead,
  and the response maps each `client_id` to the name it was given.
- Floors or tables missing from the payload are deleted. Deleting a floor deletes its
  tables. Elements are replaced as a whole child table.
- Tables are nested under their floor. Listing an existing table under a different
  floor moves it there.
- The payload carries the `version` from the last load. A stale or missing version is
  rejected with `FLOOR_PLAN_CONFLICT`, so two managers cannot silently overwrite each
  other. The POS Profile row is locked for the duration of the save, so two saves for
  the same profile run one after the other.
- Everything is validated before anything is written. Uniqueness is checked against
  the final layout, so swapping two table labels in one save works. Writes run inside a
  database savepoint, and any failure rolls back to it, so a failed save changes
  nothing.
- The response is `{plan, id_map}`: the reloaded plan, plus `id_map.floors` and
  `id_map.tables`, which map each `client_id` to the name it was given.

Error codes:

| Code | Meaning |
| --- | --- |
| `POS_PROFILE_NOT_FOUND` | The POS Profile does not exist. |
| `POS_MODE_NOT_RESTAURANT` | The POS Profile is not in Restaurant mode. Applies to reads and saves. |
| `POS_PROFILE_NOT_ASSIGNED` | A non-manager read the plan of a profile they are not assigned to. Raised by the existing profile service. |
| `FLOOR_PLAN_PERMISSION_DENIED` | A user without a manager role tried to save. |
| `FLOOR_PLAN_CONFLICT` | The `version` is stale or missing. Reload and retry. |
| `INVALID_FLOOR_PLAN` | Malformed payload: not JSON, wrong types, a missing name or label, a missing or repeated `client_id`, a row listed twice, or an unsupported element type or table shape. |
| `DUPLICATE_FLOOR_NAME` | Two floors in the profile share a name (case-insensitive, trimmed). |
| `DUPLICATE_TABLE_LABEL` | Two tables in the profile share a label (case-insensitive, trimmed). |
| `ELEMENT_OUT_OF_CANVAS` | A table or element has a zero or negative size, or falls outside the canvas. |
| `INVALID_SEATS` | Seats is not a whole number of at least 1. |
| `FLOOR_PROFILE_MISMATCH` | A floor or table name does not belong to this profile, a table has no valid floor, or a floor with tables is moved to another profile. |

### Deleting tables

Tables are hard deleted for now, through a single `_retire_table()` function. Once
Restaurant Orders link to tables, that function changes to deactivate (`is_active = 0`)
tables that have linked orders. Its callers do not change.

## Permissions

- Roles: **VunaPOS Restaurant Manager**, **VunaPOS Cashier** and **VunaPOS Waiter**,
  created by `ensure_vunapos_roles()` during install, migrate and test setup. See
  [Roles](#roles).
- Saving a floor plan requires VunaPOS Restaurant Manager or System Manager.
- Saving does not require the manager to be assigned to the POS Profile, so a manager
  can set up floors for any profile.
- Reading a floor plan requires that the user is assigned to the POS Profile, or is a
  manager. Reads do not need DocType permissions or a POS Opening Entry, so waiters can
  load the floor. Opening VunaPOS at all still needs read permission on POS Profile,
  which bootstrap checks (see decision 12).
- DocType permissions: VunaPOS Restaurant Manager and System Manager have full access to
  Floor and Table; Sales User, VunaPOS Waiter and VunaPOS Cashier have read only.

## Roles

Each role works on its own: a user does not also need Sales User or Accounts User. The
existing Sales User rules on the VunaPOS doctypes are kept, so current setups keep
working.

| Doctype | VunaPOS Waiter | VunaPOS Cashier | VunaPOS Restaurant Manager |
| --- | --- | --- | --- |
| POS Profile | Read | Read | Read |
| VunaPOS Restaurant Order | Read, write, create, print | Read, write, create, print | Full |
| VunaPOS Service Type, Floor, Table | Read | Read | Full |
| Item, Customer | Read | Read | Read |
| Account | Select | Select | Select |
| Sales Invoice, POS Invoice | Read, only if creator | Read, write, create, submit, print | Read, only if creator |
| POS Opening Entry, POS Closing Entry | None | Read, write, create, submit | None |
| Payment Entry | None | Read, only if creator | None |

Why each grant is needed:

- **POS Profile read:** bootstrap reads the resolved profile (decision 12).
- **Item read and invoice read:** loading the menu prices items through ERPNext.
  `get_item_details` checks Item read, and `apply_pricing_rule` checks read on the
  invoice doctype. "Only if creator" passes that check without showing anyone else's
  invoices to waiters and managers, who never create invoices.
- **Account select:** pricing an order (`preview_order` and checkout) looks up the
  customer's receivable account. ERPNext only needs select for that, not read.
- **Cashier invoice rights:** checkout creates, saves and submits the invoice. The
  invoice doctype follows POS Settings, so both are granted. Cancel, amend and delete
  are not.
- **Cashier shift rights:** opening and closing a shift create and submit the POS
  Opening and Closing Entry. Standard ERPNext gives these only to Sales Manager.
- **Cashier Payment Entry read:** closing a shift lists the cashier's own customer
  receipts.

How the rules are applied:

- Rules on VunaPOS doctypes are in their DocType JSON.
- Rules on Frappe and ERPNext doctypes are Custom DocPerm rows added by
  `ensure_vunapos_roles()`. A rule is added only when the role has no level 0 rule on
  that doctype yet, so changes made in Role Permissions Manager survive migrate. To
  change a shipped rule on existing sites, add a patch.
- Adding the first Custom DocPerm to a doctype copies its standard rules into Custom
  DocPerm first, so every other role keeps exactly the access it had. From then on, that
  site no longer picks up later changes to the doctype's standard rules from ERPNext.

## SPA integration (later step)

- The mode switch sits directly below `BootstrapGate`, the first point where the
  resolved profile is known. Retail keeps the current chain
  (`PosOpeningGate -> AuthenticatedApp -> POSHomePage`) unchanged. Restaurant renders its
  own app inside the shared `AppShell`. `PosOpeningGate` wraps it only for users with
  `can_take_payment` (decision 6).
- `navigationStore` gains restaurant pages (`/vunapos/floor`, `/vunapos/floor/edit`).
  In Restaurant mode, `/vunapos` resolves to the floor view.
- `POSHomePage` stays retail-only.
