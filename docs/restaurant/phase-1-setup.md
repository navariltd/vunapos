# Restaurant Phase 1: location and transaction foundation

Restaurant is a business within a Company and can span several ERPNext Branches.
Multiple POS Profiles may serve each branch. No Outlet DocType is introduced. POS Profile remains
the source of warehouse, cost center, payment, tax and price-list defaults.

## Upgrade

1. Run `bench --site <site> migrate`.
2. Set **Company** on each restaurant Branch.
3. Link each Restaurant to its Company; Restaurant no longer has a Branch field.
4. Select the Restaurant and operating Branch on each Restaurant-mode POS Profile.
   Select the matching Branch on Floors and Kitchen Stations. Tables inherit it.
5. Assign Branch User Permissions to staff requiring location restrictions.

Migration preserves legacy Restaurant Branch values on blank profile/floor/station
links and derives table Branches from their floors. Branch company inference uses
unambiguous existing POS Profiles. It never invents branches, overwrites an
existing company, or resolves conflicting company ownership automatically.
Resolve ambiguous ownership manually before operating affected profiles.

A POS Profile with restaurant history cannot change Restaurant or Branch. Create
another POS Profile for a new location so historical context cannot silently change.
The Restaurant itself can be shared across those profiles and branches.

## Permissions

Restaurant manager roles can create/update Branches; waiters, cashiers and Sales
Users receive read access. Existing customized role rules are preserved.
These grants do not automatically restrict a user to one Branch: configure
standard Frappe User Permissions for that restriction.

Restaurant API access validates company ownership and Branch User Permissions,
including when the user is assigned to profiles at more than one location.
Desk floor, table and Sales Order access follows the operating Branch permission.
Restaurant is a shared Company-level master. Ordinary non-restaurant Sales Orders retain their normal
access rules. No automatic Employee-to-Branch permission synchronization is
introduced in this phase.

See [Branch and floor menus](branch-and-floor-menus.md) for the current location
model, menu precedence and table-first ordering rules.

## Transactions

Restaurant write APIs establish a savepoint before invoking their service.
Both raised exceptions and failure response envelopes roll back to that
savepoint. This prevents caught errors from committing partial writes while
preserving unrelated earlier work in the request. No manual commits are added.

## Outside this phase

Restaurant Sessions/ordering rounds, menu sections/courses, modifiers, KOTs,
manufacturing/reservations, production-aware cancellation and settlement
recovery are subsequent phases. Individual guest/seat tracking is excluded
from v1; use guest count only.
