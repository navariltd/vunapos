# QR table ordering

Status: first version. Guests scan the QR code on their table and send an order from
their own phone, without signing in. Staff accept the order before it reaches the
kitchen, then serve and bill it like any waiter order. Dine-in only. Later versions
are tracked in [deferred work](../deferred-work.md), DEF-009 to DEF-016.

## How it works

1. A guest scans the table's code. The page shows the restaurant, the floor and table,
   and the menu for that table's floor. The table is chosen by the code; the guest
   cannot change it.
2. The guest adds items (with choices and notes), reviews the order and taps **Send
   order**. The phone shows "Order sent. A waiter will confirm it shortly."
3. The order opens the table's visit with one **draft** Sales Order. A draft gets no
   kitchen tickets and reserves no stock. The table shows **New QR order** on the
   floor plan, and the visit shows the same badge on Open Orders.
4. A **VunaPOS Waiter**, **Cashier** or **Restaurant Manager** opens it (from the floor
   plan or Open Orders), checks the items and chooses:
   - **Accept**: the draft is submitted, which sends it to the kitchen (tickets, Work
     Orders for recipe dishes, stock reservations). The staff member becomes the
     visit's waiter. Accepting needs their own open shift.
   - **Reject**, with a reason: the draft is deleted, the reason is recorded on the
     visit, the visit is cancelled and the table is free again. No manager PIN is
     needed: nothing reached the kitchen.
5. The guest's phone shows "Your order has been accepted", or "Sorry, the restaurant
   could not accept this order. Please ask a waiter."
6. After acceptance the visit is an ordinary waiter visit: staff add more rounds,
   and the bill is taken at the end with the billing till's settings (Complete
   Preparation on Billing, payment methods, PIN rules). Paying the bill frees the
   table. Scanning again adds nothing.

A QR order only starts on a free table. If the table has any active visit (waiter,
kiosk or QR), the phone shows "This table already has an order. Please ask a waiter
to add items." and nothing is created. While a QR order waits for staff, nobody can
add rounds to it, bill it, move its table or change its guests.

## Setting up

1. **POS Profile** (Restaurant mode), **QR Table Ordering** section:
   - Tick **QR Table Ordering**. Only one enabled profile per restaurant branch may
     have it; it covers every table of the branch. It does not need Kiosk Mode.
   - **QR Service Type**: the service type QR orders are recorded as, for example
     Dine In. It must be offered at the branch and use tables.
   - The profile needs a **Customer**: QR orders are placed for it.
   - Saving creates the **QR Ordering User** and adds it to the profile's users. It is
     disabled and has no password, so it can never sign in; guest orders are placed as
     this user, with the VunaPOS Kiosk role's rights. Do not enable it or give it
     other roles.
2. The QR profile can be the staff till itself (with or without Kiosk Mode), or its
   own profile beside the staff and kiosk tills. Pricing (the QR service type's price
   list) and the menu come from the QR profile.
3. Make sure the site URL (`host_name` in the site config) is the address guests can
   reach: printed codes use it.

## Printing the codes

On the floor plan, managers (VunaPOS Restaurant Manager or System Manager) choose
**QR codes**. The page lists the branch's active tables by floor, once QR Table
Ordering is switched on:

- **Print**: prints the table's card. The first print creates the table's code;
  printing again never changes it.
- **Regenerate**: after a confirmation, gives the table a new code. The old printed
  code stops working at once. The page then offers to print the new code.
- **Print all**: every table of the floor in one print job.

Each card is an A6 page: the company logo (from the Company), the restaurant name,
the floor and table, the QR code and "Scan to order". Printing uses the browser's
print dialog; choose A6 paper, or print at 100% on larger paper and cut.

The link on the card is `/vunapos/table/<code>` and contains nothing but the code.
Staff and kiosk logins cannot read the codes; only managers can.

## Security

- Guest requests never carry a login. A staff phone that scans a code orders as a
  guest too.
- Each guest action is rate limited per network address and table code (sending an
  order: 6 per 10 minutes).
- Guests are only told the restaurant, table and menu, and their own order's status:
  never the customer, visit, waiter or other orders.
- A pending order holds its table until staff accept or reject it. Expiry of pending
  orders is DEF-009.
