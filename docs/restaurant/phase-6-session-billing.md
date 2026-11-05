# Phase 6: session billing and settlement

Status: implemented for manual testing; one bill per Restaurant Session.

## Selling flow

1. Place one or more orders using the shared restaurant selling screen.
2. Place or clear any unsent cart items, then choose **View bill** next to
   **View orders**. Waiters can review the bill without receiving payment rights.
3. The preview combines every submitted, non-cancelled round. Previewing, closing
   the sheet, or refreshing the page does not create an invoice or release tables.
4. By default, complete the visit's native Work Orders through KDS/Desk and mark its KOTs
   Ready (or Served). Finishing a Work Order in Desk still requires Mark ready in
   KDS. Checkout is disabled while preparation is pending; **Refresh bill** checks
   readiness again. This prevents stranded Sent/Preparing tickets after billing.
5. A VunaPOS Cashier with their own open shift chooses **Checkout** and uses the
   existing payment allocation, shipping address, tax ID, loyalty and configured
   checkout-field controls. The restaurant bill does not replace the retail cart.
6. Successful native invoice submission settles the visit, releases its assigned
   tables and removes it from Open Orders. The cashier can **View receipt** in
   the existing Sales History/detail interface, including its normal print actions.

Run `bench --site <site> migrate` and `bench build --app vunapos` before testing.
The billing profile can differ from the order-taking profile, but must belong to
the same Restaurant, Branch, company and currency. The cashier must be assigned to it.

## Commercial and stock integrity

### Optional cashier-completed preparation

Enable **POS Profile → Restaurant → Complete Preparation on Billing** on the
**billing** profile for simpler/QSR workflows. It is off by default; another
order-taking profile's setting does not authorize the billing cashier.

When enabled and the cashier can access every required station, the bill shows a
notice and enables Checkout even if linked preparation is pending. Confirming
checkout accepts outstanding tickets, starts preparation, transfers any remaining
materials to WIP, and manufactures only outstanding quantities through the same
native production path used by KDS. Tickets become **Ready**, never automatically
Served. Completed/partially completed production is not duplicated.

This is an explicit, scoped cashier permission during billing, not a grant of
general KDS preparation rights or global Work Order/Stock Entry access. Station
User Permissions, BOM and ingredient checks, serial/batch requirements, Job Cards
and inspections still apply. Unlinked/invalid production must be resolved in Desk.
The app never fabricates completed operations or inspection results.

Each step records the cashier, billing profile and resulting stock entries in
Kitchen Ticket Action. Preparation and billing share a transaction: a stock,
inspection, payment or invoice failure rolls back that attempt's new production
and KOT progress as well as the invoice. Previously completed work remains intact.
Retry after correcting the issue; a completed bill cannot produce stock again.
Invoice stock posting is timestamped after the finished-goods receipt.

Without this setting, the normal kitchen-completes-first flow remains unchanged.

### Shared guarantees

- The client sends the session identity, billing profile, reviewed fingerprint
  and payment/checkout values. It cannot supply replacement bill items or rates.
- Each bill row retains its `sales_order`, `so_detail`, warehouse, selling UOM,
  quantity, rate and line discount. Repeated items from separate rounds stay
  separate source-linked rows. Cancelled rounds are excluded.
- Submitted prices and the session's price-list identity survive later Item Price
  changes and different billing-profile defaults. This is not a manual rate edit.
- ERPNext calculates the bill's taxes and totals; previews use the current native
  tax configuration. Rounding is at invoice level, not a sum of independently
  rounded order totals. A changed round set, tax total, loyalty value or billing
  date invalidates the review fingerprint and requires another review.
- Stock validation credits only reservations belonging to this visit's source
  rows. It cannot use stock promised to another order. Pending Work Orders cannot
  be replaced by taking unrelated finished stock from the shelf.
- Restaurant POS Invoices use source-validated stock availability rather than
  rejecting their own reserved output as unavailable. Unconsolidated POS sales
  are also counted, without counting another visit's live Sales Order reservation
  twice. The current bill is excluded from its own pending-sales total. Warehouse
  User Permissions remain enforced; retail POS Invoices and returns retain native
  ERPNext validation.
- Tracked rows consume exact batch/serial reservations from their Sales Orders.
  Configure **Auto Reserve Serial and Batch**, or explicitly allocate the source
  reservations in ERPNext. A missing exact allocation stops billing with an error;
  it does not silently substitute other batches or serials.
- Native invoices perform fulfilment/accounting. Billing does not manufacture
  already-completed quantities again, consume their BOM ingredients again, or create another draft invoice stock
  reservation. POS Invoice retains ERPNext's normal consolidation/accounting
  lifecycle and its source links.

Session row locks and a stable per-session invoice idempotency key protect the
settlement. Repeating a completed request returns the original bill rather than
creating a second invoice. Failed payment/stock validation rolls the entire
checkout back, leaving the visit open and tables assigned.

## Workflows and background submission

Restaurant settlement is synchronous even if background submission is enabled
for new retail carts: restaurant stock is already reserved against Sales Orders.
Adding another reservation layer would double-count those commitments.

When an active invoice workflow applies, checkout saves the initial workflow
draft without advancing it. The visit becomes **Settling**, appears as
**Billing pending** in Open Orders, and retains its tables. Finish the configured
workflow in Desk. Only successful native submission settles/releases the visit.
Placed rows and billing profile cannot be changed on the pending bill.

A cancelled bill is not automatically reissued, refunded or turned into a new
visit. It requires manager review of the original bill/payment and ERPNext's
normal correction/return process. A submitted visit remains historical; returning
an invoice must not reoccupy a table now used by someone else.

## Gateway payments

The common gateway connectors are reused. STK references use a source Sales Order
number (or the persisted workflow bill number), never the internal retry key.

For a refreshed, still-open checkout, the preview can recover an unconsumed STK
link matching this visit's source reference, current cashier, opening entry,
profile and customer. A pending/verified prompt is restored instead of inviting
another prompt. Multiple active prompts or a changed payment amount require
explicit review rather than another charge. Changing loyalty is blocked while
a recovered gateway prompt is active.

Verified links are claimed once when the bill is accepted, including a workflow
draft. The table still waits for invoice submission. C2B verification uses the
existing transaction-reference flow. Live provider calls require manual sandbox
testing; automated invoice tests do not contact payment providers.

## Manual checks

- Place two rounds, complete preparation, review one combined bill and pay. Check
  native source row links, stock balances and cashier opening/closing attribution.
- Review a bill and close checkout without confirming. Reload: the visit and
  table must still be open, with no new invoice.
- Add a round from another terminal after preview. The old checkout must stop
  and load the updated bill for review, not silently collect a different total.
- Change an Item Price after placing an order. Its submitted selling price must
  remain unchanged in preview and settlement.
- Bill from a different cashier profile in the same Restaurant; verify original
  prices/warehouse and the billing cashier's invoice ownership/shift link.
- Enable Complete Preparation on Billing on the billing profile. Place a QSR
  order without operating KDS, then complete checkout as a cashier without the
  Kitchen User role. Verify native production, Ready (not Served) KOT state,
  action audit, and only one manufacture after retry. Repeat with partial native
  production, restricted stations and a forced production/payment failure.
- Try billing before production completes, with insufficient finished stock, or
  using stock/batches reserved for another visit. Each must fail safely.
- Sell a tracked item spanning two reserved batches and a non-stock/service item.
- Test cash, split manual payments, permitted credit/partial payment, loyalty,
  address permissions and required checkout fields. Disallowed allocations must
  keep the visit open.
- Enable an invoice workflow. Confirm checkout saves Draft, the table stays
  occupied, and final Desk approval/submission releases it once.
- Test POS Invoice mode and normal native closing/consolidation in your setup.
- With a sandbox gateway, verify an order-number STK reference, duplicate-click
  protection, refresh recovery and one-time link consumption. Test C2B as well.
- Simulate an unknown checkout response and retry from two terminals. Verify
  one bill and no duplicate stock issue. Automated retries cover sequential
  recovery; the multi-terminal race remains a manual acceptance check.

This keeps the agreed one-bill-per-visit scope; it does not add seat/guest-based
splitting, aggregators, delivery, course firing or kitchen printer management.
Deferred decisions are tracked in [deferred work](../deferred-work.md).
