# Kiosk setup

Status: second version. A self-service kiosk where a customer builds an order like
a waiter would, checks out and takes a printed slip. Restaurant profiles only; no
payment on the kiosk (see [deferred work](../deferred-work.md), DEF-003 to DEF-008).

## How it works

1. The kiosk opens on the restaurant name and its service types (for example Dine In
   or Takeaway); with only one service type it opens straight on the menu. For
   dine-in the customer then chooses the table: the floor plan, or **Show as a
   list**. Taken tables are greyed out and say "Please ask a member of staff" (or
   "Paid" while a paid order's guests are still seated).
2. Add items from the menu, with choices and notes, then **Review order**. The menu
   shows item cards with images on phones, tablets and large screens; the list
   button switches to compact rows. The review shows the server's total and checks
   stock, as for any order.
3. **Checkout** places the order: a Restaurant Session with one Sales Order round,
   for the profile's Customer, with a short **order number** (1, 2, 3… per branch,
   starting again at local midnight). The session and Sales Order keep their normal
   names. The confirmation shows the number and the slip prints.
4. The kiosk returns to the service types after the confirmation (**Done**, or after
   20 seconds), or when the customer taps **Start over**. Once something is in the
   cart (or on the table step), after the idle time the customer is asked "Still
   there?" with **Continue my order** or **Start over**; with no answer the cart
   clears 15 seconds later.

### Kiosk Payment Timing

- **Pay at the counter first** (default): the order is saved as a **draft** Sales
  Order and the visit is **Awaiting payment**. A draft gets no kitchen tickets and
  reserves no stock. It appears on Open Orders with an **Awaiting payment** badge (and
  filter), with its total, and staff find it by order number, session or Sales Order.
- **Bill at the end**: the order is submitted at checkout and goes to the kitchen
  straight away. It is billed through the normal session checkout when the guests
  leave, and its table is released then. There is no confirm step.

### Confirming a payment

When the customer comes to the counter, a **VunaPOS Cashier** opens the order (Open
Orders, or the table on the floor plan) and chooses **Confirm payment**. The bill
shows the order's lines and total; **Take payment** opens the usual payment dialog,
where the cashier picks one or more payment methods (cash, M-Pesa with its
reference, card…). Confirming does all of this in one step, on the cashier's till
and shift:

1. submits the draft Sales Order, which sends it to the kitchen (tickets, Work Orders
   for recipe dishes, stock reservations);
2. bills the visit with the payment, completing the stock side of preparation
   (ingredient transfers and manufacture) for its recipe dishes;
3. prints the receipt.

If anything fails (for example the payment does not cover the bill, or stock ran out)
nothing is kept: the order stays a draft, Awaiting payment, and the cashier can
retry. Orders confirmed on a later day are billed on the day of confirmation.

The kitchen still sees each ticket as new, with a **Paid** badge, and accepts,
starts, readies and serves it as usual. Those steps only change the ticket's status:
its stock already moved at billing.

Confirming always completes the preparation of the order being confirmed, whatever
the confirming till's **Complete Preparation on Billing** setting says. That setting
only affects waiter orders billed before the kitchen finishes them.

### Paid dine-in tables

Billing a pay-first order settles it but keeps its table: the table shows **Paid** on
the floor plan, the table pickers and the kiosk, and the order stays on Open Orders
with a **Paid** badge. When the guests leave, a VunaPOS Waiter, Cashier or
Restaurant Manager chooses **Clear table**: on the table in the floor plan, on the
order in Open Orders, or on the order's screen. Marking the food served does not
free the table. Every other order (waiter orders, Bill at the end, takeaway) frees
its tables when billed, as before.

### Cancelling an order nobody paid for

On the session screen, a VunaPOS Cashier or Restaurant Manager chooses **Cancel order**
and enters a reason. The cancelling till's **Require Manager PIN to Cancel Orders**
applies (managers are not asked). The draft Sales Order is deleted, the reason, user
and time are recorded on the Restaurant Session (with the approving manager when a PIN
was entered, as **Cancel Approved By**), the session is Cancelled and the table freed. A paid order cannot be cancelled here; refunds are DEF-008.

## Setting up a kiosk

1. **POS Profile** (Restaurant mode), in the **Kiosk** section:
   - **Kiosk Mode** ticked.
   - **Kiosk Payment Timing**.
   - **Kiosk Idle Reset (Seconds)**, 30 to 3600 (default 90).
   - **Kiosk Service Types**: each must be offered at the restaurant branch.
   - **Kiosk Floors**: leave empty for every floor of the branch. When set, the kiosk
     only offers tables on those floors; their floor menus apply as usual. A
     restaurant with one kiosk per floor uses one POS Profile per kiosk. Kiosk
     Floors limit kiosk logins only: staff and QR orders on the same profile serve
     every floor.
   - The profile also needs a **Customer** (kiosk orders are placed for it) and an
     enabled **Manager** row in the PIN users table (needed to leave the kiosk).
2. **User** for the device with only the **VunaPOS Kiosk** role, added to the
   profile's Applicable for Users, and the same Branch User Permission as staff.
   The role has no Desk access, needs no POS shift and lands on `/vunapos` after
   signing in. It can read the menu and place orders, nothing else: no billing,
   cancelling, other pages or customer creation. On Sales Orders it may only create
   and read its own; it cannot edit or submit them through the API, and the server
   refuses any Sales Order added to a visit outside the restaurant actions.
3. Sign in on the device, open `/vunapos`, and lock the device into the browser
   (DEF-006). To leave the kiosk, press and hold the restaurant name at the top for
   about three seconds and enter a manager PIN; the kiosk signs out.

## Printing

The slip is the **Kiosk Order Slip** print format (Sales Order): restaurant, order
number, service type and table, items with choices and notes, total, and "Please pay
at the counter". It is only printed by the kiosk and never becomes the default
Sales Order format. Printing goes through the browser's print dialog (DEF-007).

The receipt printed when a cashier confirms a payment is the till's usual invoice
receipt.

## Kiosk Mode on a staff till

Kiosk Mode can be ticked on the till staff already use. Each login's screen follows
its role: kiosk logins get the kiosk, staff the normal restaurant screens. The kiosk
settings change nothing for staff, apart from the profile Customer (their default
customer too) and the Manager PIN row the kiosk needs. Staff shifts, billing and
Open Orders work as before. On a shared till, kiosk, QR and waiter orders all carry
the same POS Profile, so use the visit's **Order Source** to tell them apart.

## QR codes on tables

Guests ordering from their own phone are set up separately, with **QR Table
Ordering**: see the [QR table ordering guide](qr-ordering-setup.md).
