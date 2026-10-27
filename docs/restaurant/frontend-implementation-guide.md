# Restaurant mode: frontend implementation guide

**For:** the VunaPOS SPA team (`vunapos_spa/`).
**Backend status:** built and tested on branch `feature/restraunt-pos`. Everything below is live
on the demo site `restraunt-pos`.
**Goal:** a waiter picks a service type (and a table for Dine In), builds an order from the menu
and sends it; a cashier bills it. Kitchen tickets come in a later phase.

Read with:
- [../restaurant-pos-design.md](../restaurant-pos-design.md): the full API contract and agreed
  decisions (the source of truth if anything here differs).
- [demo-and-flow.md](demo-and-flow.md): the end-to-end flow, the demo data, and why it works this way.

---

## 1. What already exists in the SPA

| Piece | Where | Notes |
|---|---|---|
| Mode routing | `src/app/PosModeSwitch.tsx` | A profile with `pos_mode === "Restaurant"` renders `RestaurantApp`. Retail is unchanged. |
| Restaurant shell | `src/features/restaurant/RestaurantApp.tsx` | Pages: `Floor`, `Floor Editor`, `Profile`, and `Close Shift` for cashiers. `PosOpeningGate` only for `can_take_payment` users (see §5.2). |
| Floor view | `components/FloorView.tsx`, `FloorCanvas.tsx` | `FloorCanvas` takes `onTableActivate(table)`. Today it shows a "coming soon" toast. **This is where table selection plugs in.** |
| Floor data | `hooks/useFloorPlan.ts` | Loads `get_floor_plan`. Use the same pattern for the new calls. |
| Navigation | `src/lib/stores/navigationStore.ts` | Add pages to `POSPage`, `PAGE_PATHS` and `RESTAURANT_PAGES`. |
| API layer | `src/services/vunaApi.ts` | Add method names to `vunaMethods` and typed wrappers using `callAndUnwrap` (see `getFloorPlan`). Errors arrive as `VunaApiError` with `.code`. |
| Reusable retail pieces | `features/pos/components/*` | `CheckoutDialog`, `ManagerPinDialog`, `ItemCard`/`ItemGrid`, `CustomerSelector`. See §5 for the changes they need. |

The rules still apply: `yarn lint` runs `check-import-rules.mjs`, so there's no raw `fetch`, and
no `lib/db` or `lib/apiClient` imports from UI code.

## 2. Demo site for development

`restraunt-pos`, POS Profile **Nairobi**. Password for all users: `Demo@2026`.

| User | Role in the flow | Notes |
|---|---|---|
| `waiter.jane@goldenecho.test`, `waiter.brian@goldenecho.test` | Waiter | Sales User + VunaPOS Waiter. **No shift.** |
| `cashier.grace@goldenecho.test` | Cashier | VunaPOS Cashier. Opens a shift on entry (or resumes it). Bills orders. |
| `manager.mary@goldenecho.test` | Supervisor | Restaurant Manager. Manager PIN **1234**. Can edit the floor plan. |

Floors: Main Hall T1–T8, Terrace R1–R5, VIP V1–V2.

Open orders to test against:
- T1 (with a second round)
- T5
- R2 (beers)
- a takeaway order

There are also billed orders (cash and M-Pesa) and a cancelled one.

Pricing:
- **Takeaway/Delivery** use "Takeaway Prices" (food +50) and get 15% off Family Packs.
- **Dine In** adds a 10% service charge.
- The menu differs by floor and service type: no bar in the Main Hall.

Re-create the demo with
`bench --site restraunt-pos execute vunapos.setup.restaurant_demo.create_restaurant_demo`.

## 3. Screens to build (in priority order)

### 3.1 New order: pick a service type
- Source: `bootstrap.restaurant.service_types` (already in the bootstrap profile payload), or
  `get_service_types(pos_profile)`.
- Show one big button per type in `display_order`. Preselect the one with `is_default`.
- `requires_table: true` → go to table selection (3.2). Otherwise go straight to the order screen (3.3).

### 3.2 Pick a table (Dine In)
- Reuse `FloorView`/`FloorCanvas`. Add a **status overlay** from `get_table_status(pos_profile)`:
  `Free` vs `Occupied`, guests, time since `opened_at`, and the waiter.
- Tapping a **Free** table starts a new order on it.
- Tapping an **Occupied** table opens its open order (`orders[0].name`). If the profile allows
  several orders per table (`bootstrap.restaurant.allow_multiple_orders_per_table`), show the
  list plus a "New order on this table" option.
- Inactive tables are already filtered out in `FloorView`. Keep that.
- **Refresh:** there are no realtime events yet. Poll `get_table_status` every ~10–15 s while
  the floor is visible, and right after any order action.

### 3.3 Order screen: menu + order panel
**Menu:** `get_menu(pos_profile, service_type, table?, query?, customer?)`
- Category tabs come from `categories` (`[{item_group, label}]`, already in display order). An
  item belongs to the tab whose `item_group` equals its `menu_category`. If `restricted` is
  false there are no categories, so show everything (or group by `item_group`).
- Items are the **same shape as the retail catalogue** (`ItemDTO`), so `ItemCard`/`ItemGrid`
  can be reused.
  - `rate` is what the customer pays.
  - When `rate < price_list_rate`, an offer applies: show the list price crossed out
    (for example, takeaway Family Pilau 3,300 → 2,805).
- Prices are **already for the service type** (takeaway prices for Takeaway). Reload the menu
  whenever the service type or table changes.
- Search: pass `query` (server-side), or filter locally if the menu is small.

**Order panel:** service type and table chip (changeable), guests, customer, order note, lines
(item, qty, note), and actions.

**Saving:**
- First save: `create_order({pos_profile, service_type, table?, customer?, pax?, order_note?,
  items, idempotency_key})`.
- Later rounds: `add_order_items(order, items)`.
- Line edits: `update_order_item(order, line_id, qty?, note?)`.
- Header changes: `update_order(order, service_type?, table?, customer?, pax?, order_note?)`.
  Omit a field to leave it unchanged. Send `""` to clear it.
- **Generate `line_id` on the client** (`crypto.randomUUID()`) for every new line, and an
  `idempotency_key` for `create_order`. Retries are then safe: the server ignores a `line_id`
  it already has.
- Each line is `{item_code, qty, uom?, note?, line_id}`. The server fills `uom` (Sales UOM, else
  Stock UOM) if it's omitted.
- **Keep unsent lines locally** and send them as a batch on "Save / Send". Saved lines come back
  in the order response. Render from that.

**Totals:** orders store no prices.
- Show a running subtotal from menu `rate`s.
- For the real bill, call `preview_order(order)`. It returns `{order, invoice}`, where `invoice`
  is the normal `InvoiceDTO`: service charge in `invoice.taxes`, `invoice.totals.grand_total`,
  and offers applied per line.
- Call it when the waiter opens "Bill" or "Print bill", and before checkout. It needs no shift.
- Do **not** use `invoiceEngine.ts` for restaurant totals. It only knows the profile's tax
  template, not the service type's service charge.

### 3.4 Orders list
- `list_orders(pos_profile, status="Open" | "Billed" | "Cancelled" | "", table?, service_type?)`
  returns summaries `{name, status, service_type, table, table_label, customer, pax, waiter,
  opened_at, invoice, ...}`.
- Cashier view: open orders with Bill and Open actions. Filter by service type (takeaway
  orders have no table).

### 3.5 Bill (cashier)
1. Only users with `can_take_payment` see Bill. They already have an open shift (§5.2).
2. `preview_order(order)` gives the totals to charge.
3. Open `CheckoutDialog` with `invoice.totals.grand_total`. On confirm, call
   `checkout_order({order, payments, idempotency_key, customer?, is_credit_sale?, due_date?,
   loyalty_points?, tax_id?, salesperson?, salesperson_token?, checkout_fields?})`.
   It returns `{order, invoice}`.
4. On success: print with the existing `renderInvoice`, show change, and go back to the floor.
   The table is now Free.
5. **Retry with the same `idempotency_key`** on a network failure. You get the same sale back,
   never a second charge.

### 3.6 Cancel / remove (supervisor control)
- **Cancel order:** a reason is mandatory. If `bootstrap.restaurant.require_manager_pin_order_cancel`
  is on and the user is not a Restaurant Manager, get a PIN token first, then call
  `cancel_order(order, reason, manager_pin_token)`.
- **Remove a line:** `remove_order_item(order, line_id, manager_pin_token?)`. A PIN is needed
  when the profile's `require_manager_pin_item_removal` is on (the same rule as retail).
- PIN token: `vunapos.api.pin.verify_manager(pos_profile, pin, action)` with
  `action: "order_cancel"` for cancellations and `"item_removal"` for line removal (see §5.3).

### 3.7 Table transfer / change of service type
- **Move table:** `update_order(order, table=<new table>)`. It fails with `TABLE_OCCUPIED` if the
  target is busy.
- **Switch to Takeaway:** `update_order(order, service_type="Takeaway")`. The table is cleared
  automatically, and every line must have a takeaway price, or `ITEM_NOT_PRICED_FOR_SERVICE_TYPE`.

## 4. Types to add (`features/restaurant/types.ts`)

```ts
export type ServiceTypeDTO = {
  name: string;
  service_type_name: string;
  requires_table: boolean;
  display_order: number;
  description?: string | null;
  price_list?: string | null;
  taxes_and_charges?: string | null;
  is_default: boolean;
};

export type RestaurantSettingsDTO = {          // bootstrap.restaurant (null on Retail profiles)
  service_types: ServiceTypeDTO[];
  allow_multiple_orders_per_table: boolean;
  require_manager_pin_order_cancel: boolean;
};

export type MenuDTO = {
  pos_profile: string;
  service_type: string | null;
  table: string | null;
  floor: string | null;
  price_list: string;
  restricted: boolean;
  source: "Menu" | "POS Profile Item Groups" | "All Items";
  categories: Array<{ item_group: string; label: string }>;
  items: Array<ItemDTO & { menu_category: string | null }>;   // ItemDTO from features/pos/types
};

export type TableStatusDTO = {
  table: string;
  table_label: string;
  floor: string;
  seats: number;
  status: "Free" | "Occupied";
  orders: Array<{ name: string; service_type: string; pax: number; waiter: string; opened_at: string }>;
};

export type RestaurantOrderLineDTO = {
  line_id: string;
  item_code: string;
  item_name: string;
  qty: number;
  uom: string;
  note: string | null;
  added_by: string;
  added_at: string;
};

export type RestaurantOrderDTO = {
  name: string;
  status: "Open" | "Billed" | "Cancelled";
  pos_profile: string;
  service_type: string;
  table: string | null;
  table_label: string | null;
  customer: string | null;
  customer_name: string | null;
  pax: number;
  waiter: string;
  opened_at: string;
  order_note: string | null;
  items: RestaurantOrderLineDTO[];
  invoice_doctype: string | null;
  invoice: string | null;
  billed_by: string | null;
  billed_at: string | null;
  cancel_reason: string | null;
  cancel_approved_by: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  modified: string;
};

export type RestaurantOrderSummaryDTO = Pick<
  RestaurantOrderDTO,
  "name" | "status" | "service_type" | "table" | "table_label" | "customer" | "pax" | "waiter" |
  "opened_at" | "invoice_doctype" | "invoice" | "modified"
>;

export type OrderLineInput = { item_code: string; qty?: number; uom?: string; note?: string; line_id: string };

export type OrderWithInvoiceDTO = { order: RestaurantOrderDTO; invoice: InvoiceDTO };  // preview + checkout
```

Add `restaurant?: RestaurantSettingsDTO | null` to the bootstrap profile type.

## 5. API methods to add to `vunaApi.ts`

All are in `vunapos.api.restaurant` and use the standard envelope (`callAndUnwrap`). Use
`useFrappePostCall` for all of them (as `useFloorPlan` does). Methods marked POST must be POST.

| `vunaMethods` key | Method | POST |
|---|---|---|
| `getServiceTypes` | `get_service_types` | |
| `getMenu` | `get_menu` | |
| `getTableStatus` | `get_table_status` | |
| `listRestaurantOrders` | `list_orders` | |
| `getRestaurantOrder` | `get_order` | |
| `previewRestaurantOrder` | `preview_order` | |
| `createRestaurantOrder` | `create_order` | ✓ |
| `updateRestaurantOrder` | `update_order` | ✓ |
| `addRestaurantOrderItems` | `add_order_items` | ✓ |
| `updateRestaurantOrderItem` | `update_order_item` | ✓ |
| `removeRestaurantOrderItem` | `remove_order_item` | ✓ |
| `cancelRestaurantOrder` | `cancel_order` | ✓ |
| `checkoutRestaurantOrder` | `checkout_order` | ✓ |

JSON-encode list arguments (`items`, `payments`), as `saveFloorPlan` does with `payload`.

### 5.1 Changes needed in existing components
1. **`RestaurantApp`:** add the new pages, and replace the "coming soon" toast in
   `FloorView.onTableActivate` with table selection.
2. **`navigationStore`:** new pages (for example `Order` `/vunapos/order`, `Orders`
   `/vunapos/orders`), added to `RESTAURANT_PAGES` and to the restaurant entries in the `Sidebar`
   and `BottomNav`. A deep link like `/vunapos/order/<VRO-…>` is useful.
3. **`ManagerPinDialog`:** it hard-codes `action: "item_removal"`. Add an `action` prop, so
   cancellations can send `"order_cancel"`.
4. **`CheckoutDialog`:** reuse it, but it posts through retail callbacks. Wire `onConfirm` to
   `checkout_order` for restaurant orders. It also **does not collect `reference_no` /
   `reference_date`** for bank-type payment modes (retail M-Pesa uses the gateway flow). On the
   demo, **M-Pesa is a plain bank-type mode** (`requires_reference: true` in
   `bootstrap.modes_of_payment`). So either add a transaction-code + date field for modes with
   `requires_reference`, sent as `payments[i].reference_no` / `reference_date`, or connect
   M-Pesa through the payment gateway as retail does. Without one of these, M-Pesa checkout
   fails with a "transaction reference is required" error.

### 5.2 Opening-entry gate (team decision 6)
The gate is **on entry, for users who can take payment**. This is already built:
- `bootstrap.can_take_payment` is true only with the **VunaPOS Cashier** role. Restaurant
  Manager and other roles don't count.
- For those users, `RestaurantApp` wraps the shell in `PosOpeningGate`, so they open a shift
  (`PosOpeningEntryDialog`) before they reach the floor. Close Shift is in their sidebar, and on
  phones on the Profile page.
- Everyone else (waiters, managers without the Cashier role) goes straight to the floor with no
  shift.

For the order screens this means:
- **Show Bill and checkout only when `can_take_payment` is true.** Waiters can't bill: they have
  no permission to create invoices, so `checkout_order` refuses them even with a shift.
- Waiters can still show the customer the bill with `preview_order`, which needs no shift.
- A cashier always has an open shift inside the app, so the order screens need no shift prompt
  of their own. If the shift is closed elsewhere, `PosOpeningGate` blocks the app as in retail,
  and checkout still enforces it on the server.

## 6. Error codes → what the UI should do

| Code | When | UI |
|---|---|---|
| `POS_MODE_NOT_RESTAURANT` | Profile isn't in Restaurant mode | Shouldn't happen behind `PosModeSwitch`. Show an error. |
| `SERVICE_TYPE_REQUIRED` / `SERVICE_TYPE_NOT_ALLOWED` | Missing or unknown service type | Return to the service type picker. |
| `TABLE_REQUIRED` | Dine In without a table | Open the table picker. |
| `TABLE_NOT_FOUND` / `TABLE_INACTIVE` | Bad or deactivated table | Refresh the floor and ask again. |
| `TABLE_OCCUPIED` (`meta.order`) | The table already has an open order | Offer to open `meta.order` instead. |
| `MENU_ITEM_NOT_AVAILABLE` | Item not on the menu for this floor and service type | Remove it from the local cart, and reload the menu. |
| `ITEM_NOT_PRICED_FOR_SERVICE_TYPE` | No price in the type's price list (also when switching type) | Explain, and keep the old service type. |
| `ITEM_HAS_VARIANTS` | Template picked | Open the variant picker (reuse the retail one). |
| `SERVICE_ITEMS_DISABLED` / `ITEM_NOT_SELLABLE` | Item can't be sold here | Show the message. |
| `INVALID_QTY` / `INVALID_PAX` / `NOTE_TOO_LONG` | Input problems (notes max 500 chars) | Inline validation. |
| `ORDER_NOT_FOUND` / `ORDER_LINE_NOT_FOUND` | Stale screen | Reload the order. |
| `ORDER_NOT_OPEN` | Someone billed or cancelled it | Reload, show it read-only, and go back to the floor. |
| `ORDER_EMPTY` | Bill or preview with no lines | Disable Bill until there are lines. |
| `ORDER_ALREADY_BILLED` | Second checkout with a new key | Show the existing invoice (`meta.invoice`). |
| `CANCEL_REASON_REQUIRED` | No reason | Require the reason field. |
| `PIN_TOKEN_REQUIRED` / `PIN_TOKEN_INVALID` / `INVALID_MANAGER_PIN` / `PIN_LOCKED` | Supervisor approval | Open or re-open `ManagerPinDialog`. |
| `SERVICE_TYPE_PRICE_LIST_INVALID` / `SERVICE_TYPE_TAX_TEMPLATE_INVALID` | Setup problem | "Ask a manager to check the service type setup." |
| Checkout codes (`PAYMENT_TOTAL_MISMATCH`, shift missing, reference required…) | From the existing checkout | Same handling as retail (`getCheckoutErrorMessage`). The order stays Open. |

## 7. Rules the UI must respect

- **The table only matters when `requires_table`.** Hide table controls otherwise.
- **The menu is context-specific.** Reload it when the service type or table (floor) changes.
- **Prices are taken at billing.** Use `preview_order` for the bill, not cached menu prices.
- **Open orders only.** Billed or cancelled orders are read-only.
- **One open order per table** unless the profile setting allows more.
- **Waiters have no shift.** Never block order taking on the opening entry.
- **Everything is online-only.** There's no offline queue for orders. Show the connectivity
  banner (`ConnectivityMonitor`) and retry with the same keys.
- **Roles:** the floor `Edit` button appears only when `get_floor_plan().can_edit`. Waiters
  can't cancel without a PIN when the setting is on.

## 8. Test checklist (on the demo site)

| # | Scenario | Expected |
|---|---|---|
| 1 | Jane: Dine In → T4 → add Chicken Biryani ×2 (note "mild") → Save | Order created. T4 shows Occupied. |
| 2 | Jane: Dine In → T4 again | Opens the same order (`TABLE_OCCUPIED` if forced new) |
| 3 | Jane: Dine In → Main Hall table: Bar tab | No Bar category |
| 4 | Jane: Dine In → Terrace R1 | Bar (beers, wines, cocktails) available |
| 5 | Jane: Takeaway menu | Biryani 1,000 (not 950). Family Pilau 3,300 → 2,805. No bar. |
| 6 | Preview T1 (VRO-2026-00001) | Service Charge 10% = 554, total **6,094** |
| 7 | Preview the takeaway order (VRO-2026-00004) | Total **3,205**, no service charge |
| 8 | Brian: cancel T5 without PIN | `PIN_TOKEN_REQUIRED` → Mary enters 1234 → Cancelled, approver recorded |
| 9 | Jane (Waiter): open an order | No Bill button; Print bill (`preview_order`) works. Grace (Cashier) gets the shift dialog on entry and can bill |
| 10 | Grace: bill T1 with Cash 6,500 | Invoice submitted, change 406, T1 Free |
| 11 | Grace: bill a takeaway order with M-Pesa | Needs a transaction code + date (§5.1) |
| 12 | Move the T5 order to T6, then to T1 while T1 is busy | Move works, then `TABLE_OCCUPIED` |
| 13 | Switch a Dine In order containing a beer to Takeaway | `ITEM_NOT_PRICED_FOR_SERVICE_TYPE` |
| 14 | Lose network during Save, then retry | No duplicate lines or orders |

## 9. Not in scope yet

Kitchen tickets and the kitchen display, split and merge bills, realtime events (poll for now),
happy-hour pricing, and per-seat ordering. The backend for these is planned. Ask before building
UI for them.
