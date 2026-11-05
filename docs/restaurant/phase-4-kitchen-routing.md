# Phase 4: kitchen routing and immutable KOTs

## Phase sequence

The original architecture draft numbered KOTs as Phase 3 and KDS as Phase 4.
Implementation Phase 3 covered menu configuration and Item-owned modifiers/add-ons.
This Phase 4 establishes Kitchen Stations and KOT events, prerequisites for the
interactive KDS lifecycle. It does not claim to implement that lifecycle yet.

## What this phase includes

- Kitchen Station master linked to Restaurant, with Branch/Company derived from it.
  A station name is unique within its Restaurant and Branch, not globally across branches.
- Explicit Item Group routing, including descendant groups. Menu Sections/Courses
  organize the catalogue; they do not control kitchen routing.
- One submitted Kitchen Order Ticket per station per submitted session round.
  A new round creates new tickets, never rewrites previous tickets.
- Station-mapped Item Groups identify made-to-order **QSR** items, contextually
  within the selected Restaurant. They require an active, submitted default BOM
  for that exact Item/variant and Company. There is no permanent Item QSR checkbox.
- Routing now prefers the most-specific mapped Item Group (updated in Phase 5).
  Active stations in the same Restaurant/Branch cannot share an exact group.
  Legacy exact duplicates require correction or an explicit temporary choice.
- Unmapped items are direct sale, use finished stock and create no KOT. Do not map
  bought-in drinks or retail products to a station unless they really are manufactured.
- Add-ons follow their parent dish's station. Modifier labels, quantities, selling
  and stock UOMs, notes, table labels and staff identity are snapshotted on send.
- Submitted rounds expose their tickets under View orders. Tickets can be inspected
  there or from Kitchen Order Ticket in Desk; ticket payloads cannot be edited.
- Database-enforced event uniqueness, serialized generation and same-transaction
  submission. Missing routing or generation failure cannot leave a successful round
  with missing tickets. Scoped creation events are published after commit.
- Cart additions, quantity/UOM changes and modifier edits validate the entire
  candidate round before accepting it. Shared recipe ingredients are aggregated in
  stock UOM per source warehouse, including stock add-ons. Checks are advisory:
  stock is not reserved merely by putting an item into an unsent cart.
- Send repeats the check under sorted stock locks, creates submitted native Work
  Orders with full ingredient reservations and snapshots their names on KOT lines.
  Direct-sale stock/add-on rows are reserved against the Sales Order. Partial
  reservation or any later ticket failure rolls back the complete send transaction.
  Retry keys reuse the existing round, tickets and production orders.
- Manufacture is performed through ERPNext, not by sending the ticket. Native
  Work Order/Stock Entry logic reserves manufactured output to its source Sales
  Order, preventing another order from consuming that reserved output.

## Setup

1. Create Kitchen Stations in Desk, e.g. Main Kitchen and Bar, selecting their
   Restaurant. Branch and Company are derived; no POS Profile-specific menu is added.
2. Add the appropriate ERPNext Item Groups on each station. Use disjoint groups for
   automatic splitting, e.g. Prepared Food → Kitchen and Beverages → Bar. If one
   station includes a parent group and another includes its child, the child mapping
   wins for that subtree. Parent and leaf groups are both supported.
3. Set each preparing station's Raw Material Warehouse. WIP is optional: with WIP,
   ERPNext uses material transfer then manufacture; without WIP, the Work Order
   skips transfer and manufacture consumes from the raw warehouse. All warehouses
   must be enabled ledger warehouses in the Restaurant's Company. Finished goods
   use the POS Profile warehouse. Stock add-ons use their parent's raw warehouse
   but stay separate Sales Order lines, not duplicated into the base BOM.
4. Enable Stock Reservation in ERPNext Stock Settings. VunaPOS does not turn this
   global setting on automatically. Configure active, submitted default BOMs for
   mapped items and stock their ingredients. Semi-finished-goods tracking and
   supplier-sourced/excluded recipe inputs are not supported by this initial QSR
   path; configuration errors are explicit. Direct-sale Product Bundles require a
   separate packed-item reservation path and are rejected rather than underchecked.
5. System Managers/Restaurant Managers configure stations using ordinary document
   permissions; till assignment is not required just to configure a station.
   Transaction APIs still require Restaurant/POS Profile assignment. Standard Branch
   and Kitchen Station User Permissions restrict operational station/ticket access.
   Without a Kitchen Station User Permission, users see all permitted stations in
   the Restaurant; that restriction is optional, not mandatory setup.

## Manual checks

1. Add two prepared items with configured BOMs to one session round and click Place Order. Open View orders: there should
   be separate Kitchen and Bar tickets, both Sent, each referencing the same Sales Order.
2. Inspect a ticket. Confirm table/station names, staff, notes, modifier labels, dish
   quantities and add-ons. A dish sold as 2 cartons of 24 pieces must preserve both
   the selling quantity 2 and stock quantity 48, not substitute one for the other.
3. Send an additional round. It must create new tickets containing only that round.
   Retrying the original request/key must not create another round or duplicate KOTs.
4. Remove an Item's routing: it becomes direct sale and checks finished stock,
   not recipe ingredients. Restore the mapping: it shows QSR and checks ingredients.
5. Configure a parent group on one station and a child group on another. Items in
   the child subtree must route to the child station. Assigning the same exact group
   to a second active station must be rejected. Disable the selected station before retrying: it must require a new,
   enabled/permitted station. If none are available, the dialog explains setup is needed.
   After a failed first send, return to the cart and change its customer/table,
   then retry. The already-opened session remains authoritative; updated context
   must be used rather than silently reopening the original customer/table.
6. Change an Item name, modifier labels, station name or table assignment after send.
   Historical ticket snapshots must remain unchanged.
7. Restrict a waiter to one Kitchen Station through User Permission. Tickets from
   another station must not appear in session ticket summaries or open through the API.
8. Confirm ordinary retail Sales Orders and legacy non-session restaurant orders
   behave as before and do not generate KOTs automatically.
9. Add two different recipes consuming the same ingredient, or two UOM rows of
   one dish. Their combined ingredient demand must not exceed available stock.
   Failed edits retain the original cart quantity and show the shortage.
10. Send most remaining ingredients in one round, then try another. The second
    must reject reserved stock even if its earlier cart preview had passed.
11. Open a KOT's Work Order in Desk and complete native manufacture. Confirm its
    finished goods are reserved against the originating Sales Order. Sending did
    not itself consume ingredients or produce finished goods.

## Selling UX

The cashier action is **Place Order**. “Round” remains an internal name for an
immutable batch of items added to a session; placed quantities are never edited
from the history sheet. Additional items come from the shared POS catalogue.

The selling cart uses the same local invoice engine as retail for immediate
subtotal, tax and grand-total feedback. Native Sales Order pricing reconciles
customer/service pricing rules and separately taxed add-ons. Stock validation
returns its pricing preview in the same request; price-only refreshes are debounced
and stale responses are discarded. No document or production order is saved by a
pricing preview. Pending edits are provisional until validation succeeds.

Action errors use the existing toast. Fractional whole-number UOM errors name the
dish, ingredient and BOM before creating the order, rather than exposing an opaque
Work Order row number. Correct the recipe batch/UOM; the app does not disable Nos
whole-number enforcement globally.

Kitchen Station Restaurant choices are filtered by Company. Its Branch is the one
linked to that Restaurant (one Restaurant has one Branch), and these relationships
are validated server-side as well as filtered on the Desk form.

## Boundaries and migration

Run `bench --site <site> migrate`, rebuild, then reload POS. Stations and recipes
must be configured before selling made-to-order QSR items. Unmapped items remain
direct sale. Existing rounds
are not automatically backfilled/sent to kitchens during migration.

Initial ticket status is Sent. Accept/Preparing/Ready/Served actions and a dedicated
Kitchen Display are the next phase. The status options reserve that lifecycle, but
this phase exposes no generic status-edit API. Historical ticket contents remain
immutable throughout that later operational lifecycle.

Orders with submitted kitchen tickets cannot be cancelled through ordinary Sales
Order cancellation: they require an explicit kitchen cancellation/void event.
That workflow, kitchen printing/reprinting, KDS-driven manufacturing actions and aggregate
session billing remain separate later work. Do not treat this phase as a complete
production restaurant deployment on its own.
