# Phase 3: menu sections, modifiers and add-ons

## Setup in Desk

1. Create **Menu Section** records, such as Drinks, Starters and Main Courses.
   Set Display Order; sections are independent of ERPNext Item Groups. Courses
   categorize the menu only: delayed/course firing is not implemented.
2. In **Restaurant Menu → Items**, add ERPNext Items (or variant templates),
   select a Section / Course, and set Display Order. Available controls temporary
   availability; Exclude prevents an item or variant from being sold on that menu.
3. Set the menu as the Restaurant's Default Menu. POS Profiles still supply
   commercial defaults; menus do not duplicate prices, taxes or warehouses.
4. Create **Restaurant Modifier Group** records. Set minimum selections to 0 for
   optional choices, or 1+ for required choices; maximum limits how many may be
   selected. Add enabled choices with distinct labels.
5. In **Item → Restaurant → Modifier Groups**, assign those reusable groups to
   the product, e.g. Tea → Sugar preference. Instruction-only choices such as
   No sugar need no add-on Item. A constrained group (e.g. Milk choice) may also
   link a particular choice to a chargeable Item when necessary.
6. In **Item → Restaurant → Optional Add-ons**, add extras such as Extra milk
   or Extra cheese. Link an ERPNext sales Item, quantity per main selling unit,
   and optionally its UOM (defaults to stock UOM). No Modifier Group is required
   for these standalone extras. Their Item Prices determine charges. A free
   add-on needs an explicit zero Item Price; a missing price is not free.
   Non-stock sales Items can model charge-only extras; Stock Items model physical
   ingredients/extras. Add-ons are single-level choices, not recursive recipes.
7. Variants inherit both tables from their template when neither is configured
   on the variant. Configuring either table uses that variant's own settings for
   both; use Override Template Restaurant Options to explicitly choose no options.
   Each Item's settings apply consistently across menus, including the profile's
   catalogue fallback when no Restaurant Menu is assigned.

System Managers and Restaurant Managers configure menus and modifier-group
masters. Editing restaurant options on Item requires the user's normal ERPNext
Item write permission; no broad Item editing permission is granted to waiters or
cashiers. Menu actions still require an assigned POS Profile and
restaurant access. Configuration events refresh the active menu, with the server
revalidating membership and selections when a round is sent.

## Selling behaviour

- Choose a section above the shared catalogue. Pick a variant first if necessary,
  then select customization options. Required groups block confirmation until valid.
- Identical item/UOM/choice combinations merge; different customizations remain
  separate lines. Edit choices below a cart row, and use Item Note for free text.
- Cart prices are estimates including add-ons. Add-on quantities scale with the
  main selling quantity; changing its UOM does not change the configured add-on
  quantity per selling unit. The server prices all rows through ERPNext when sent.
- A round stores a label/configuration snapshot on the parent Sales Order Item.
  Add-ons are normal separately priced Sales Order Item rows linked to that parent.
  Instruction-only choices do not create stock rows. Stock is not issued when the
  Sales Order is sent. Billing/stock issue remains the later settlement workflow.
- Committed rounds stay immutable. Changing menu configuration does not rewrite
  existing choices, labels, prices or quantities. New rounds use current settings.
- ERPNext Selling Settings must allow repeated Items when an order contains the
  same Item in multiple configurations/UOMs or as an add-on to multiple dishes.

No independent modifier pricing engine, recipe/BOM expansion, kitchen routing,
KOT generation or course firing is introduced here. Pricing Rules and taxes stay
in ERPNext. Add-on prices may therefore change during authoritative pricing.

## Migration

Run `bench --site <site> migrate` before testing. The idempotent migration expands
legacy group-based menus into explicit Item rows and Menu Sections, preserving
single-item overrides and exclusions. Old group rows are retained hidden for
reference, not used as categories after conversion. New Items in those inventory
groups must subsequently be added to the menu explicitly. Menus without a default
menu retain the POS Profile Item Group / all-sales-item fallback.

Existing menu-based modifier assignments are migrated to Item. Hidden legacy
rows remain as history; they are no longer active configuration. Identical
assignments across menus are deduplicated. If menus disagree for an Item, choose
its defaults under Item → Restaurant → Modifier Groups (or explicitly override
template options), then rerun migration. Existing Item defaults are never overwritten.

The Restaurant chooses one default menu, shared by its POS Profiles. No
profile-specific menu setting is included. Menus control availability and
presentation, not modifier ownership.

## Manual checks

1. Configure Tea under Drinks on a menu. On Item → Restaurant, assign a required
   Sugar preference group and add Extra milk under Optional Add-ons, quantity 1,
   Item Price 25. Verify section filtering; no modifier setup belongs on Menu.
2. Add Tea: sugar selection is required, Extra milk is optional. Choose No sugar
   and Extra milk, then set Tea quantity to 2: extras estimate is 50; the round's
   milk row has quantity 2. Ordering without milk must create no add-on row.
3. Add Tea with Normal sugar: it stays separate. Add the same customized Tea
   again: only matching Item/UOM/choices merge. Edit/remove and recheck totals.
4. Send the round, reopen it and confirm choices and parent/add-on linkage persist.
   Retry the same request: no duplicate round or add-on rows may appear.
5. Disable a choice/item or remove its Item Price while another screen is open.
   The server must reject stale/invalid choices and never accept client-supplied
   prices or arbitrary add-on Items. Refresh/reselect as prompted.
6. Test variant inheritance and an explicitly excluded variant. Test optional
   groups, multiple-choice maxima, instruction-only options and zero-priced extras.
7. Change labels/prices after sending a round; its historical snapshot must remain.
   Confirm retail POS behaviour is unchanged.
8. Put Tea on another menu: its Item-owned choices should work without duplicate
   setup. Test variant inheritance, explicitly configured variant options, and an
   empty variant override. Editing a Menu must not alter any Item's choices.
