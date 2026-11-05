# Phase 5: kitchen display and preparation lifecycle

## Scope

The shared restaurant app now has a **Kitchen** page (`/vunapos/kitchen`). It
shows station-filtered preparation tickets, elapsed time, table/service context,
waiter identity, modifiers, add-ons and preparation/allergy notes. No prices or
payment controls are returned in the board payload.

Preparation follows this sequence:

`Sent → Accepted → Preparing → Ready → Served`

| Action | Who | Inventory effect |
| --- | --- | --- |
| Accept | Kitchen User or Restaurant/System Manager | None |
| Start preparing | Kitchen User or manager | Native material transfer to WIP, if configured |
| Mark ready | Kitchen User or manager | Native manufacture of remaining quantity and verification of order-specific output reservations |
| Mark served | Waiter, Cashier or manager | None; stock is not deducted twice |

Ticket item contents remain immutable. `Kitchen Ticket Action` is an append-only
success/failure audit. Only the ticket's status projection changes through the
controlled commands; saving or cancelling a ticket directly is still blocked.

## Setup

1. Migrate the site and rebuild VunaPOS.
2. Complete the Phase 4 station, BOM, warehouse and reservation setup.
3. Give preparation staff **VunaPOS Kitchen User** and assign their Restaurant POS
   Profile. They do not need global Work Order or Stock Entry rights. Kitchen-only
   users land on Kitchen and have Kitchen/Profile navigation; combined waiter or
   cashier roles retain the shared selling navigation.
4. Optional Branch and Kitchen Station User Permissions limit accessible stations,
   tickets, commands and action audits. Without station restrictions, staff see the
   permitted Restaurant's stations. Disabled stations remain visible for completing
   previously placed tickets; they do not receive new QSR routing.
5. Kitchens with native BOM operations/Job Cards, inspection requirements or manual
   serial/batch production setup must complete those native ERPNext prerequisites.
   KDS does not invent operation completion, bypass inspection, or disable tracking
   validation. A manager can complete the native documents in Desk, then retry Ready.

No new mandatory outlet entity or separate profile-specific menu is introduced.
Existing site-customized Role Permissions are not overwritten by migration.

All selling users, including waiters, cashiers, managers and users with ordinary
POS/Sales roles, must open their own POS shift before entering the selling interface.
Another user's opening does not cover them. Waiters can close their own shift,
but opening one does not grant payment or invoice-creation rights. Kitchen-only
staff do not need an opening shift.

Active stations cannot claim the same exact Item Group in the same Restaurant
and Branch. Parent groups are supported: the closest mapped ancestor wins, so
a Coffee subgroup mapped to Coffee Station takes precedence over Tea mapped to
another station. A hidden child station does not fall back to a visible parent.
Disabled stations retain historical mappings; re-enabling validates conflicts.
Old duplicate mappings are not silently rewritten and require correction or an
explicit temporary routing choice.

The profile selects the Restaurant context, not a separate ticket inbox. Orders
from multiple profiles in that Restaurant appear together at their permitted
stations; another Restaurant's tickets are not included.

## Production and retry behavior

Place Order already reserves raw materials through native Work Orders. Start
preparing transfers remaining materials only when the Work Order uses WIP. Direct
manufacture without WIP does not consume ingredients at Start.

Ready uses native Stock Entry primitives. It manufactures only the remaining
quantity, respects production already completed in Desk and confirms the finished
goods are reserved to the originating Sales Order. All dish production in one
ticket is atomic: if one dish fails, that command's stock entries and state changes
roll back. Earlier successful commands, such as a prior WIP transfer, remain intact.

Failed commands keep the previous preparation state and record the failure under
Ticket details → Preparation activity. Fix the native setup/stock issue and retry.
Production permission errors include the Work Order and operation, preserve
available ERPNext permission details, and log the full traceback server-side.
The browser retains the request key for retry. Server session/order/ticket locks,
expected-state checks and unique successful request claims protect against repeated
clicks or competing terminals. A replay returns current state without manufacturing
again. There is no blind automatic background retry of inventory writes.

Station-scoped realtime events refresh the display. Visible-page polling provides
recovery every 12 seconds, with one request in flight and bounded 100-ticket pages.
Realtime subscriptions are capped at 20 stations in the all-stations view; other
stations still refresh through polling. Authentication failures stop protected
polling until the page/session is reloaded. Notification failure does not roll back
an already committed preparation action.

## Cancellation

Ticket details offers **Cancel placed order**, requiring a reason. This cancels the
entire source Sales Order across all its station tickets, not one dish or the whole
Restaurant Session. The caller must have access to every affected station.

The POS Profile's **Require Manager PIN to Cancel Orders** applies to service staff;
Restaurant/System Managers can approve directly. Cancellation PIN tokens are scoped
to cancellation and cannot reuse an item-removal approval.

For unproduced orders without submitted stock movements, native Work Orders and
Sales Order are cancelled, reservations are released, and immutable tickets remain
submitted with a Cancelled preparation state. Audit links deliberately retain the
cancelled document names; operational link/stock validations are not bypassed.

If production or WIP has moved, KDS refuses to silently reverse it. A manager must
explicitly reverse the relevant native entries/account for waste in ERPNext before
cancellation. Served orders require a separate correction/return workflow. Partial
dish voids and automated wastage/reversal documents are not implemented here.

Cancelling a batch does not release the table. If every batch is cancelled and no
items are waiting in the cart, the session can be closed with **Close session and
release tables**. This preserves the distinction between cancelling an order and
ending the customer's visit.

## Waiter visibility

Open Orders and the selling screen show an aggregate preparation status. Ticket
details exposes role-appropriate commands, including Mark served. Summaries are
explicitly scoped to stations the user may access; they must not imply hidden
stations have finished. New orders still come through the catalogue as new immutable
batches; KDS does not rewrite placed quantities or reprice submitted orders.

## Manual checks

1. Place a QSR order as a waiter; confirm it appears at the correct station.
2. Sign in as a Kitchen User without Manufacturing User/Stock User. Accept and
   Start preparing. With WIP, verify a native transfer; without WIP, verify no stock
   consumption yet.
3. Mark ready. Confirm native manufacture, raw-material consumption and finished
   goods reserved against the original Sales Order. Retry/double click: no duplicate
   manufacture or success event should be created.
4. As the waiter, see Ready in Open Orders, then Mark served. Verify stock balances
   do not change again.
5. Cause a native manufacturing validation failure. Confirm status stays Preparing,
   stock changes roll back, a failure audit appears, and the corrected retry works.
6. Complete part/all of a Work Order in Desk, then Ready in KDS. Only the remaining
   quantity is manufactured.
7. Cancel an unproduced order spanning two stations. Verify both tickets show
   Cancelled, reservations are released, source snapshots remain intact, and the
   table stays assigned until explicitly closing the session.
8. Enable cancellation PIN approval. Confirm an item-removal token cannot authorize
   cancellation. Test missing reason, stale state and wrong-station access.
9. Restrict a user to one station. Try other station/ticket/audit URLs and API
   commands directly; they must not expose or change restricted records.
10. Disconnect realtime temporarily: polling should recover. Expire authentication:
    protected polling should stop rather than repeatedly issuing failed calls.

## Next phase

Session billing/settlement remains separate: combine all placed batches into one
bill, reuse checkout/payment handling, preserve source order and reservation links,
and release tables after successful billing. Mark served already permits a ready
ticket after future settlement, since serving does not manufacture or issue stock.
This phase does not introduce split bills, delivery/aggregators, kitchen printing,
seat/guest tracking or course firing.
