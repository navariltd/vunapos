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
- **Reason:** The first kiosk version only places orders; agreed with the user.

### Current behavior

A kiosk order is paid at the counter. With **Pay at the counter first** a VunaPOS
Cashier confirms the payment on the session screen, which sends the order to the
kitchen, then bills it through the normal session checkout. With **Bill at the end**
it goes to the kitchen at once and is billed when the guests leave. See the
[kiosk setup notes](restaurant/kiosk-setup.md).

### Intended outcome

- Let the customer pay on the kiosk (for example M-Pesa or card) and, once paid,
  send the order to the kitchen without a cashier.

### Decision to resolve

Session billing requires recipe dishes to be produced before an invoice is made,
unless the billing till has Complete Preparation on Billing. Decide how a payment
taken before preparation is recorded (advance payment, or billing with completion)
and which till's shift owns it.

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
till's order-cancel PIN rule). It reserves no stock and creates no kitchen tickets.

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
