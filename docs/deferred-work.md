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
