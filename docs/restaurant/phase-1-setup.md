# Restaurant Phase 1: location and transaction foundation

Restaurant is a physical business in one ERPNext Branch. Multiple POS Profiles
may serve that restaurant. No Outlet DocType is introduced. POS Profile remains
the source of warehouse, cost center, payment, tax and price-list defaults.

## Upgrade

1. Run `bench --site <site> migrate`.
2. Set **Company** on each restaurant Branch.
3. Select that Branch on each Restaurant. Existing restaurants without a Branch
   remain stored, but restaurant operations are blocked until configured.
4. Check each restaurant POS Profile's company. Its Restaurant Branch is derived
   from Restaurant, not independently configured.
5. Assign Branch User Permissions to staff requiring location restrictions.

Migration only backfills an empty Branch company when every existing Restaurant
linked to it has the same Company. It never invents branches, overwrites an
existing company, or resolves conflicting company ownership automatically.
Resolve ambiguous ownership manually before operating affected profiles.

A configured Restaurant cannot be moved to a different Branch once referenced
by a POS Profile, floor or Sales Order. Create a new Restaurant for a new
physical location so historical location context cannot silently change.

## Permissions

Restaurant manager roles can create/update Branches; waiters, cashiers and Sales
Users receive read access. Existing customized role rules are preserved.
These grants do not automatically restrict a user to one Branch: configure
standard Frappe User Permissions for that restriction.

Restaurant API access validates company ownership and Branch User Permissions,
including when the user is assigned to profiles at more than one location.
Desk Restaurant, floor, table and Sales Order access also follows Restaurant's
Branch permission. Ordinary non-restaurant Sales Orders retain their normal
access rules. No automatic Employee-to-Branch permission synchronization is
introduced in this phase.

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
