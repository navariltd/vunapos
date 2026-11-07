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

## DocType export metadata

Standard restaurant DocType definitions, including child tables, include literal
`creation`, `modified`, `owner` and `modified_by` metadata. Datetimes use Frappe's
`YYYY-MM-DD HH:MM:SS.ffffff` format in the development site's timezone
(Africa/Nairobi for this repair). Existing creation values are preserved.

On 7 November 2026, 14 definitions lacked creation/ownership metadata and five
also lacked a modification timestamp. No original creation values were present
in their Git history. The following creation dates are therefore **approximations
from the first commit containing each same-named DocType**, not recovered exact
developer-mode creation times:

| DocTypes | Creation approximation | Source commit |
| --- | --- | --- |
| Restaurant Session; Restaurant Session Table | 2026-11-04 21:01:06.000000 | `316207d` |
| Menu Section; Restaurant Item Addon; Restaurant Item Modifier; Restaurant Menu Modifier; Restaurant Modifier Group; Restaurant Modifier Option | 2026-11-04 22:11:50.000000 | `e036350` |
| Kitchen Order Ticket; Kitchen Order Ticket Item; Kitchen Station Item Group | 2026-11-05 07:53:35.000000 | `ea1fe54` |
| Kitchen Ticket Action | 2026-11-05 10:39:27.000000 | `814808c` |
| Restaurant Menu Floor | 2026-11-05 15:32:01.000000 | `ef40a29` |
| Kitchen Station Floor | 2026-11-07 21:10:40.000000 | `9125f14` |

Kitchen Station Floor was copied from Restaurant Menu Floor; its source file's
earlier date is not its own creation date. Missing ownership metadata follows the
repository's `Administrator` convention, rather than treating Git authors as
Frappe Users. Modification timestamps record the metadata repair. No business
record timestamps, layouts, permissions or optional behavioral settings change.

The layout regression suite checks audit-key presence, valid absolute datetime
format and creation-before-modification ordering for all restaurant definitions.

## Outside this phase

Restaurant Sessions/ordering rounds, menu sections/courses, modifiers, KOTs,
manufacturing/reservations, production-aware cancellation and settlement
recovery are subsequent phases. Individual guest/seat tracking is excluded
from v1; use guest count only.
