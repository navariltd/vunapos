# Deferred work

Central tracker for VunaPOS work explicitly postponed for a later iteration.
Deferring an item does not mean it has been implemented or scheduled.

## Tracking rules

- Record future deferrals here when agreed with the user, including bugs,
  features, UX improvements and technical follow-ups.
- Give each item a stable ID, date, current behavior, intended outcome and checks
  needed before completion. Note unresolved decisions rather than assuming them.
- Link related specifications instead of duplicating entire feature plans.
- Keep completed entries and mark them completed with the relevant commit/PR.

## DEF-001 — Separate kitchen preparation duties from manager access

- **Status:** Deferred
- **Recorded:** 2026-11-05
- **Area:** Restaurant / KDS permissions
- **Reason:** Revisit after the current restaurant implementation and testing.

### Current behavior

Accept, Start preparing and Mark ready are available to VunaPOS Kitchen Users,
VunaPOS Restaurant Managers and System Managers. A manager can therefore perform
preparation actions without being explicitly assigned kitchen duties.

### Intended outcome

- Require explicit **VunaPOS Kitchen User** assignment for preparation actions.
- Managers who operate the kitchen should receive that role in addition to their
  management role; management access alone should not grant preparation duties.
- Keep waiter progress visibility and Mark served behavior unchanged.
- Preserve Restaurant, Branch and Kitchen Station permission restrictions.
- Keep cancellation/manager approval policy separate from preparation permissions.
- Retain the explicit POS Profile-controlled cashier completion during billing
  as a separate scoped permission; it must not grant general KDS preparation actions.

### Decision to resolve

Define Administrator's emergency/superuser behavior explicitly. Frappe can resolve
Administrator to all roles, so checking the effective Kitchen User role alone may
not distinguish explicit kitchen assignment from superuser access.

### Completion checks

- Enforce the policy in server commands as well as visible KDS controls.
- Test kitchen staff, managers with/without kitchen assignment, waiters, cashiers
  and the agreed Administrator behavior.
- Verify direct API calls cannot bypass the role or station restrictions.
- Update the [Kitchen setup guide](restaurant/phase-5-kitchen-display.md).

## DEF-002 — Keep customers created in Retail findable straight away

- **Status:** Completed (2026-11-16) on branch `feature/restraunt-create-customer`, in the
  customer creation commit; add its commit/PR link once committed.
- **Recorded:** 2026-11-16
- **Area:** Retail / customer search
- **Reason:** Restaurant customer creation shipped this improvement for Restaurant
  mode only; Retail behaviour stays unchanged for now.

### Current behavior

In Retail, a customer created from the POS is held only in the customer
selector's memory. Once the selector or cart remounts it is not in the local
customer store until the next delta sync, and the server's customer search cache
(30 seconds) is not cleared. Restaurant mode already does all three steps below
(`useCustomerCreate`, `invalidate_customer_search_cache`).

### Intended outcome

- Write a Retail-created customer to the local customer store and bump the
  runtime cache revision.
- Clear the server customer search cache after a Retail creation.
- Keep Retail's inline single-field create form unless separately agreed.

### Completion checks

- Create a customer in Retail, close and reopen the cart, and find it by name
  and mobile number before the next sync.
- Extend `test_restaurant_creation_clears_the_customer_search_cache`, which now
  asserts that Retail leaves the cache alone.

### Resolution

Retail now uses the same create sheet as Restaurant (`CustomerCreateSheet` and
`useCustomerCreate`), which writes the new customer to the local customer store
and bumps the runtime cache revision. The server clears the customer search
cache after every POS creation; the test is now
`test_creation_clears_the_customer_search_cache_in_both_modes`. Retail's inline
name-only form was replaced by the sheet at the user's request.

## DEF-003 — Take payment at the kiosk

- **Status:** Deferred
- **Recorded:** 2026-11-17
- **Area:** Restaurant / kiosk
- **Reason:** The kiosk only places orders; payment is taken by a cashier. Agreed
  with the user.

### Current behavior

A kiosk order is paid at the counter. With **Pay at the counter first** the order is
a draft Sales Order until a VunaPOS Cashier chooses **Confirm payment** on the
session screen and takes the payment: one request submits the order (sending it to
the kitchen) and bills the visit on the cashier's till, which needs Complete
Preparation on Billing. With **Bill at the end** it goes to the kitchen at once and
is billed when the guests leave. See the [kiosk setup notes](restaurant/kiosk-setup.md).

### Intended outcome

- Let the customer pay on the kiosk (for example M-Pesa or card) and, once paid,
  send the order to the kitchen without a cashier.

### Decision to resolve

Which till and shift own a payment taken on the kiosk, since the kiosk login has no
shift and cannot create invoices.

### Completion checks

- Payment failure, timeout and retry never place the order twice or lose a payment.
- Shift closing and reconciliation include kiosk payments.

## DEF-004 — Retail kiosks

- **Status:** Deferred
- **Recorded:** 2026-11-17
- **Area:** Retail / kiosk
- **Reason:** Kiosk Mode is a separate POS Profile switch so retail can follow, but
  this version is built and tested for Restaurant profiles only.

### Current behavior

Saving a POS Profile with Kiosk Mode and POS Mode Retail is refused. A kiosk login
on a Retail profile sees "This kiosk is not set up".

### Intended outcome

- A self-service retail screen (catalogue, cart, checkout) on a Retail profile with
  Kiosk Mode, reusing the kiosk role, the locked screen, idle reset and PIN exit.

### Completion checks

- Decide how retail kiosk orders are recorded (Sales Order to pay at the counter,
  or invoice with payment from DEF-003) and test stock, pricing and shift rules.

## DEF-005 — Expire abandoned kiosk orders automatically

- **Status:** Deferred
- **Recorded:** 2026-11-17
- **Area:** Restaurant / kiosk
- **Reason:** Abandoned orders are cancelled by hand in this version.

### Current behavior

A kiosk order nobody pays for stays **Awaiting payment** on Open Orders and keeps its
table until a cashier or manager cancels it from the session screen (reason and the
till's order-cancel PIN rule). Its Sales Order is a draft, so it reserves no stock and
creates no kitchen tickets; cancelling deletes the draft and records the reason, user
and time on the Restaurant Session.

### Intended outcome

- Cancel kiosk orders still awaiting payment after a configurable time, freeing
  their tables, with an audit reason such as "Not paid within 30 minutes".

### Completion checks

- Never cancel an order whose payment was confirmed or is being confirmed.
- Record the automatic cancellation like a manual one (cancelled by, reason).

## DEF-006 — Lock the kiosk device down

- **Status:** Deferred
- **Recorded:** 2026-11-17
- **Area:** Restaurant / kiosk / devices
- **Reason:** The app can only lock its own screen; the device must do the rest.

### Current behavior

The kiosk login has no Desk access and sees only the kiosk screen. Leaving it
through the app needs a manager PIN (long press on the restaurant name). The app
asks the browser for full screen, but a customer can still leave full screen,
switch apps or close the browser unless the device is locked down.

### Intended outcome

- Documented device setup: Android screen pinning or a kiosk launcher, iPad
  Guided Access, or Chrome/Edge started in kiosk mode on the kiosk URL.

### Completion checks

- On each supported device, a customer cannot reach another app, the address bar
  or the browser's settings without the device's own unlock.

## DEF-007 — Print the kiosk slip without a print dialog

- **Status:** Deferred
- **Recorded:** 2026-11-17
- **Area:** Restaurant / kiosk / printing
- **Reason:** Browsers show a print dialog unless the device is set up otherwise.

### Current behavior

After checkout the kiosk renders the **Kiosk Order Slip** print format and opens the
browser's print dialog, which the customer must confirm.

### Intended outcome

- The slip prints straight away on the kiosk's receipt printer, for example
  Chrome started with `--kiosk-printing`, or a print service/agent.

### Completion checks

- A failed or missing printer still shows the order number on screen.
- The slip layout fits 58 mm and 80 mm receipt paper.

## DEF-008 — Refund or return a paid kiosk order

- **Status:** Deferred
- **Recorded:** 2026-11-17
- **Area:** Restaurant / kiosk / returns
- **Reason:** Agreed with the user: this version only cancels orders nobody paid for.

### Current behavior

Confirming a kiosk payment submits the order and bills it at once, so a paid order
is a settled visit with a submitted invoice. The kiosk **Cancel order** action is
refused once the order is paid, and kitchen cancellation is refused for billed
orders. A paid order that the kitchen cannot make, or a customer who changes their
mind after paying, needs a manual invoice return in Desk.

### Intended outcome

- A cashier or manager action that refunds a paid kiosk order (all or some lines)
  through a Sales Invoice return, with the refund payment, reason and approval.
- Its kitchen tickets are cancelled and its table released.

### Decision to resolve

Whether stock already moved at billing (ingredients used, dish made) is returned to
stock or written off when the dish was never made.

### Completion checks

- The refund appears in the shift that pays it out and in closing reconciliation.
- A refunded order cannot be served or refunded again.


## DEF-009 — Shared-demo and physical kitchen printer validation

- **Status:** Deferred
- **Recorded:** 2026-11-20
- **Area:** Kitchen printing
- **Current behavior:** Local manual ticket rendering is implemented; shared-demo deployment and physical printer delivery are not verified.
- **Intended outcome:** Validate the approved implementation on an assigned demo POS Profile and the selected printer, without changing unrelated demo data.
- **Completion checks:** Confirm deployed commit and versions; verify station routing, cancellation notices, reprints, permissions, paper width and disconnected-printer behavior. Confirm printing does not repeat preparation, stock or accounting actions.
- **Unresolved:** Demo deployment approval, test records, printer model and connection. Local focused code checks continue; this deferral is not release clearance.
## DEF-009 — Expire pending QR orders

- **Status:** Deferred
- **Recorded:** 2026-11-20
- **Area:** Restaurant / QR table ordering
- **Reason:** Agreed with the user: QR table ordering v1 (branch
  `feature/restraunt-qr-ordering`) leaves a pending QR order until staff accept or
  reject it. Related to [DEF-005](#def-005--expire-abandoned-kiosk-orders-automatically).

### Current behavior

A QR order waits as a pending draft and holds its table until a waiter, cashier or
manager accepts or rejects it. A prank or forgotten order blocks the table until
then.

### Intended outcome

A pending QR order nobody accepts within a configured time is rejected
automatically: the draft is deleted, the reason recorded on the visit and the table
freed.

### Decision to resolve

The timeout, where it is set (POS Profile or Restaurant) and whether staff are
warned before expiry.

### Completion checks

- An order accepted while expiry runs is never removed (lock and status check).
- The expiry reason and time show on the visit, like a staff rejection.

## DEF-010 — Add rounds to a visit by scanning again

- **Status:** Deferred
- **Recorded:** 2026-11-20
- **Area:** Restaurant / QR table ordering
- **Reason:** Agreed with the user: in v1, items after acceptance are added by staff
  through the waiter flow.

### Current behavior

Scanning a table that has an active visit shows "This table already has an order.
Please ask a waiter to add items." and creates nothing.

### Intended outcome

Guests at a table with an accepted QR visit can send another round from their
phone, which staff accept like the first one.

### Decision to resolve

How a scan proves it belongs to the seated party and not someone who photographed
the code (see DEF-012), and whether visits opened by a waiter accept QR rounds.

### Completion checks

- Pending rounds never reach the kitchen or the bill before acceptance.
- Billing and Confirm payment ignore or refuse pending rounds.

## DEF-011 — Several visits or customers on one table

- **Status:** Deferred
- **Recorded:** 2026-11-20
- **Area:** Restaurant / sessions / QR table ordering
- **Reason:** Agreed with the user: v1 keeps one active visit per table.

### Current behavior

`lock_tables` lets one active visit hold a table, whatever the Restaurant's "Allow
Multiple Open Orders per Table" setting says. That setting only affects older
orders without a visit and the floor plan's table tap. A QR order only starts on a
free table.

### Intended outcome

Two parties at one table can have separate visits and bills, from QR or from a
waiter choosing to start a separate order on an occupied table.

### Completion checks

- Table status, Open Orders, transfer, join, Clear table and billing handle several
  visits on a table.
- The "Allow Multiple Open Orders per Table" setting governs visits as its label
  says.

## DEF-012 — Join codes for a QR visit

- **Status:** Deferred
- **Recorded:** 2026-11-20
- **Area:** Restaurant / QR table ordering
- **Reason:** Agreed with the user: not part of v1.

### Intended outcome

The first guest's phone shows a short code, and other guests at the table enter it
to order into the same visit. Depends on DEF-010.

### Completion checks

- Codes are rate limited against guessing and stop working when the visit closes.

## DEF-013 — Takeaway through QR ordering

- **Status:** Deferred
- **Recorded:** 2026-11-20
- **Area:** Restaurant / QR table ordering
- **Reason:** Agreed with the user: QR v1 is dine-in only.

### Intended outcome

A guest who scans a table code can switch to Takeaway (the kiosk flow already
keeps the cart when switching service type).

### Decision to resolve

How a takeaway order nobody is seated for is collected and paid, and how staff tell
it apart from a prank.

## DEF-014 — Pay on the phone for QR orders

- **Status:** Deferred
- **Recorded:** 2026-11-20
- **Area:** Restaurant / QR table ordering / payments
- **Reason:** Agreed with the user: QR orders are billed at the end through the
  waiter flow in v1. Related to [DEF-003](#def-003--take-payment-at-the-kiosk).

### Intended outcome

A guest pays the bill (or a pay-first order) from their phone, for example by
M-PESA, without a cashier.

### Completion checks

- The payment lands in a cashier shift for closing reconciliation.
- No customer or bill data is exposed to someone holding only the table code.

## DEF-015 — Several QR cards per A4 sheet

- **Status:** Deferred
- **Recorded:** 2026-11-20
- **Area:** Restaurant / QR table ordering / printing
- **Reason:** Agreed with the user: v1 prints one A6 card per page.

### Intended outcome

Print all of a floor's cards on A4 sheets, several cards per sheet with cut marks.

## DEF-016 — Regenerate QR codes in bulk

- **Status:** Deferred
- **Recorded:** 2026-11-20
- **Area:** Restaurant / QR table ordering
- **Reason:** Agreed with the user: v1 regenerates one table at a time.

### Intended outcome

A manager regenerates every table's code on a floor or branch in one confirmed
action (for example after codes leak), then prints the new cards.

### Completion checks

- Every old code stops working at once; tables without a token stay without one.
