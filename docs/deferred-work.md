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
