# Restaurant sessions and ordering rounds

## Setup

Run `bench --site <site> migrate`, then `bench build --app vunapos`.
Use a Restaurant-mode POS Profile linked to a Restaurant and company-matched Branch.
Waiters need profile assignment but do not need an opening shift. Cashiers still
need their normal opening shift.

## Manual checks

1. Open Home: it uses the same search, grid/list and cart as retail. Service
   types appear above the customer. Choose Dine In, select a table, and return
   to items; Takeaway skips table selection.
   Table selection uses the full visual plan in a large desktop/tablet overlay
   and full-screen on mobile. Test floor tabs, occupancy, zoom/scrolling, and
   quick number search. Repeated numbers across floors require explicit selection;
   Enter never guesses from a partial table number.
2. Set customer/guest count, add items and Send round. The same selling screen
   remains; use View rounds to inspect submitted Round 1.
3. Add another item and send: Round 2 must have a different Sales Order number.
4. Expand submitted rounds: quantities, rates and notes are read-only. New
   quantities/notes belong to the new round only.
5. Return to Floor or Open Orders and reopen the session. Refresh its URL: saved
   rounds, customer, tables and guest count must remain. Unsent items are local
   only; navigating away asks before discarding them.
6. Above the customer, change guest count or open the selected-table button to
   join/move tables. Previous
   assignments retain release timestamps and users in the Session document.
7. Try assigning a table occupied by another session: the backend must reject it.
8. In View rounds, a manager can reassign the waiter to another staff member assigned to the
   same restaurant. Customer changes are blocked after the first submitted round.
9. A session created before a failed first-round request remains visible in Open
   Orders. It can be reopened and retried, or cancelled while empty to release
   its tables. A session with rounds cannot use this empty-session action.
10. Takeaway creates a session without tables. It remains accessible in Open Orders.
11. Restaurant navigation retains Sales History, Payments and Customers. Profile
    feature switches still hide Payments/Customers and block their direct URLs.
    Open invoice and customer details and use Back to return to their lists.
    A waiter without a shift can browse history without a current-shift filter;
    receiving/reconciling payments remains cashier-only. Backend permissions still
    apply to every shared page and action.
12. On desktop, Floor is below Collapse and above the user card. Close Shift
    follows Customers in the main navigation, matching retail, for cashiers only.
    On mobile, secondary pages are in More
    rather than squeezing all destinations into the bottom bar.

The session price list/currency are captured when opened. New rounds use current
prices under that price list; previously submitted rounds retain their rates.
The unsent cart explicitly shows an estimate; authoritative pricing/taxes are
calculated by ERPNext when the round is sent. Unsent items support the existing
retail quantity, UOM and note controls, scanner and variant picker. Retail invoice
state is not used to store restaurant rounds.

Menu category chips currently use the existing menu configuration. Separate
Menu Section/Course masters and modifier configuration remain Phase 3.

## Boundaries

"Send" commits a Sales Order round. KOT generation and preparation are later
phases; no kitchen ticket is generated yet. The new session screen deliberately
does not settle a single round as though it were the whole visit. Aggregate
session billing/checkout is Phase 8. Existing non-session restaurant orders
remain accessible through the legacy order screen and checkout endpoints.
Shared Sales History exposes draft invoice details, but does not offer retail
cart restore/checkout actions in restaurant mode. Restaurant sessions and rounds
are edited from Orders; retail draft editing remains unchanged in retail mode.

There is no individual guest tracking, course firing, delivery orchestration,
split billing or manufacturing in this phase. POS Profiles retain commercial
defaults; Sessions do not duplicate Sales Order item storage.
