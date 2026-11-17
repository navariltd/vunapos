# Kiosk setup

Status: first version. A self-service kiosk where a customer builds an order like
a waiter would, checks out and takes a printed slip. Restaurant profiles only; no
payment on the kiosk (see [deferred work](../deferred-work.md), DEF-003 to DEF-007).

## How it works

1. **Tap to order**, choose the service type (for example Dine In or Takeaway), then
   the table for dine-in: the floor plan, or **Show as a list**. Taken tables are
   greyed out and say "Please ask a member of staff".
2. Add items from the menu, with choices and notes, then **Review order**. The review
   shows the server's total and checks stock, as for any order.
3. **Checkout** places the order: a Restaurant Session with one Sales Order round,
   for the profile's Customer, with a short **order number** (1, 2, 3… per branch,
   starting again at local midnight). The session and Sales Order keep their normal
   names. The confirmation shows the number and the slip prints.
4. The kiosk returns to the start screen after the confirmation, or when the
   customer taps **Start over** on any step. After the idle time the customer is
   asked "Still there?" with **Continue my order** or **Start over**; with no answer
   the cart clears 15 seconds later.

### Kiosk Payment Timing

- **Pay at the counter first** (default): the order is **Awaiting payment**. It gets
  no kitchen tickets and reserves no stock. It appears on Open Orders with an
  **Awaiting payment** badge (and filter). When the customer has paid, a
  **VunaPOS Cashier** opens it and chooses **Confirm payment**: the order goes to the
  kitchen, reserving stock as any order does. The cashier then bills it through the
  normal session checkout. Billing is refused until payment is confirmed.
- **Bill at the end**: the order goes to the kitchen straight away and is billed
  through the normal session checkout when the guests leave. There is no confirm step.

Tick **Complete Preparation on Billing** on the tills that confirm and bill kiosk
orders. Recipe (BOM) dishes can then be billed as soon as the customer pays;
otherwise session billing waits until the kitchen marks them Ready.

### Cancelling an order nobody paid for

On the session screen, a VunaPOS Cashier or Restaurant Manager chooses **Cancel order**
and enters a reason. The cancelling till's **Require Manager PIN to Cancel Orders**
applies (managers are not asked). The Sales Order is cancelled and the table freed.
Orders already sent to the kitchen are cancelled from their kitchen ticket as usual.

## Setting up a kiosk

1. **POS Profile** (Restaurant mode), in the **Kiosk** section:
   - **Kiosk Mode** ticked.
   - **Kiosk Payment Timing**.
   - **Kiosk Idle Reset (Seconds)**, 30 to 3600 (default 90).
   - **Kiosk Service Types**: each must be offered at the restaurant branch.
   - **Kiosk Floors**: leave empty for every floor of the branch. When set, the kiosk
     only offers tables on those floors; their floor menus apply as usual. A
     restaurant with one kiosk per floor uses one POS Profile per kiosk.
   - The profile also needs a **Customer** (kiosk orders are placed for it) and an
     enabled **Manager** row in the PIN users table (needed to leave the kiosk).
2. **User** for the device with only the **VunaPOS Kiosk** role, added to the
   profile's Applicable for Users, and the same Branch User Permission as staff.
   The role has no Desk access, needs no POS shift and lands on `/vunapos` after
   signing in. It can read the menu and place orders, nothing else: no billing,
   cancelling, other pages or customer creation.
3. Sign in on the device, open `/vunapos`, and lock the device into the browser
   (DEF-006). To leave the kiosk, press and hold the restaurant name at the top for
   about three seconds and enter a manager PIN; the kiosk signs out.

## Printing

The slip is the **Kiosk Order Slip** print format (Sales Order): restaurant, order
number, service type and table, items with choices and notes, total, and "Please pay
at the counter". It is only printed by the kiosk and never becomes the default
Sales Order format. Printing goes through the browser's print dialog (DEF-007).
