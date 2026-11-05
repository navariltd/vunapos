# Restaurants, branches and floor menus

A Restaurant is shared across branches of its Company. Create Burger House once,
then link each branch's POS Profiles to it. Select the operating Branch on each
Restaurant-mode POS Profile. Restaurant no longer owns a Branch.

Floors and kitchen stations belong to a Restaurant **and** a Branch. Tables inherit
their floor's Branch. The same floor/table/station labels and kitchen Item Groups
can be reused at different branches. Floor plans, open sessions, orders and KDS
queues are branch-scoped. Staff at tills in the same Restaurant and Branch share
operations; another branch is not part of that scope. Branch User Permissions
remain optional restrictions, not mandatory configuration.

Sales Orders, Sales Invoices and POS Invoices store read-only **Restaurant** and
**Branch** snapshots. Session bills take them from the visit; legacy single-order
bills take them from the source Sales Order. These fields cannot be changed or
cleared after recording the location. Order lists and Branch permissions use the
order's recorded Branch, not its POS Profile's current configuration. Billing
rejects source orders from different locations rather than combining them.

## Menu setup

Prices remain in ERPNext Item Price and Pricing Rules; menus define availability,
sections and courses only.

- Shared default: leave Branch and Floor-wise Menu blank; select the menu as the
  Restaurant's Default Menu.
- Branch menu: select Restaurant and optional Branch. Only one enabled branch-wide
  menu may exist for that Restaurant/Branch.
- Floor menu: enable **Floor-wise Menu** and add one or more floors to **Floors**.
  Restaurant and Branch can restrict the selectable floors. With no Branch set,
  one menu can serve floors in several branches. Each floor can have only one
  enabled explicit menu.

Resolution: floor assignment → Restaurant/Branch menu → Restaurant default → existing
POS Profile Item Groups fallback when no menu is configured. Disabled menus are
not applied. Conflicting assignments are rejected instead of selected arbitrarily.

URY's local implementation uses a Restaurant-level Room Wise Menu checkbox and
Menu for Room rows (`ury/ury_pos/api.py`). VunaPOS uses that explicit mapping concept,
but places the checkbox and floor child rows on Restaurant Menu as requested.

## Dine-in flow

Choose Dine-in → select a table from the floor plan → see its menu → add items.
Closing the table picker does not unlock ordering. Clicking items, scanning or
opening the camera before table selection reopens the picker. Server menu, cart
preview and cart validation endpoints reject dine-in requests without a table.
Switching a draft to another table revalidates its unsent items against that menu.
Grouped tables must share the same resolved menu for one session/bill.

## Upgrade and acceptance checks

Run `bench --site <site> migrate`, then rebuild the SPA. The migration copies the
retired Restaurant Branch into **blank** profile/floor/station Branch fields and
derives blank table Branches from their floors. Existing assignments and operational
history are not overwritten. The retired database column is not dropped.

A separate document-location patch backfills blank order/invoice snapshots from
their session or source orders (or the originating profile for legacy orders).
Conflicting or incomplete historical sources are left for manual review, and
existing snapshots and modification timestamps are preserved.

Test with one Restaurant, two Branches and a profile per Branch:

1. Give both locations a Ground Floor and table 1; each till sees only its branch.
2. Give both branches a Main Kitchen and the same Item Group; each routes locally.
3. Set a default menu, a branch override and a floor override; verify precedence.
4. Attempt duplicate enabled floor/branch menus; saving must fail clearly.
5. Choose Dine-in and dismiss the picker; item entry and scanning remain blocked.
6. Choose a table, add items, then choose a table with a menu excluding those items;
   the change must fail rather than silently keeping an invalid order.
7. Existing restaurant billing and preparation flows remain available after upgrade.
