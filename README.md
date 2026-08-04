<div align="center">
	<img src="./vunapos/public/logo.png" alt="VunaPOS Logo" height="250px" width="200xp"/>
    <p align="center">
        <p>Fast, flexible point-of-sale for ERPNext</p>
    </p>
</div>

<div align="center">
	<!-- <img src="./frappoint/public/images/hero_image.png"/> -->
    <!-- Include a calendar image showcassing the booked appointments, dashboard sort of -->
</div>

## VunaPOS

**VunaPOS** is a modern point-of-sale application built on top of **Frappe Framework** and **ERPNext**.

It provides cashiers with a fast and focused interface for finding items, selecting customers, managing a cart, processing payments, and creating ERPNext invoices. VunaPOS uses existing ERPNext configuration and accounting documents, keeping stock, taxes, payments, and invoices within the standard ERPNext workflow.

### Key Features

* **Item Search** - Find items quickly using item names, codes, or barcodes.
* **Customer Selection** - Search for existing customers or use the default customer configured in the POS Profile.
* **Cart Management** - Add items, change quantities, remove items, clear the cart, and view invoice totals.
* **Hold and Restore** - Save an active sale as a draft invoice and restore it later.
* **Flexible Invoicing** - Create either a **Sales Invoice** or **POS Invoice**, depending on the configured POS Settings.
* **Tax Handling** - Support ERPNext inclusive and exclusive tax calculations.
* **Batch Allocation** - Automatically allocate stock from valid batches, including quantities distributed across multiple batches.
* **Serial Number Allocation** - Automatically allocate available serial numbers for serialised items during checkout.
* **Multiple Payment Modes** - Use the payment methods configured in the ERPNext POS Profile.
* **M-Pesa Payments** - Verify payments using STK Push or existing C2B transactions.
* **Receipt Printing** - Render and print receipts using ERPNext Print Formats.
* **API-First Backend** - Expose reusable Frappe APIs that can support alternative POS frontends.

## Basic Usage

### Start a Sale

1. Open **VunaPOS**.
2. Search for an item using its name, item code, or barcode.
3. Select the item to add it to the cart.
4. Select a customer where required.
5. Adjust quantities and review the invoice totals.

### Complete Checkout

1. Click **Checkout**.
2. Select a mode of payment.
3. Enter or verify the payment amount.
4. Complete any required gateway verification.
5. Click **Complete Sale**.
6. Print the resulting receipt where required.

### Hold a Sale

1. Add the required items to the cart.
2. Click **Hold**.
3. Restore the draft later from the held sales list.

## Configuration

VunaPOS uses standard ERPNext configuration wherever possible.

* **POS Settings** determine whether VunaPOS creates a **Sales Invoice** or **POS Invoice**.
* **POS Profile** provides the company, warehouse, price list, default customer, modes of payment, and print format.
* **Items and Item Prices** control the products and selling rates available in the POS.
* **Sales Taxes and Charges Templates** and **Item Tax Templates** control tax calculation.
* **Modes of Payment** define the payment options available during checkout.

## Under the Hood

* [**Frappe Framework**](https://github.com/frappe/frappe): Provides the backend, database layer, authentication, permissions, document model, and API framework.

* [**ERPNext**](https://github.com/frappe/erpnext): Provides customers, items, stock, warehouses, taxes, accounting, POS Profile, Sales Invoice, POS Invoice, and payment functionality.

* [**React**](https://react.dev/): Powers the VunaPOS cashier interface.

* [**Frappe React SDK**](https://github.com/The-Commit-Company/frappe-react-sdk): Connects the React frontend to the Frappe backend.

* [**Tailwind CSS**](https://tailwindcss.com/): Provides the frontend styling system.

## Production Setup

### Managed Hosting

VunaPOS can be deployed on any environment that supports Frappe and ERPNext, including [Frappe Cloud](https://frappecloud.com).

Frappe Cloud handles installation, deployments, backups, monitoring, upgrades, and site management.

<!-- Add a Frappe Cloud Marketplace link here when VunaPOS is published. -->

## Development Setup

### Manual Installation

1. Set up a Frappe bench by following the [Frappe installation guide](https://docs.frappe.io/framework/user/en/installation), then start the server:

   ```bash
   bench start
   ```

2. In another terminal, create a site:

   ```bash
   bench new-site vunapos.localhost
   ```

3. Install ERPNext:

   ```bash
   bench get-app erpnext
   bench --site vunapos.localhost install-app erpnext
   ```

4. Get and install VunaPOS:

   ```bash
   bench get-app https://github.com/navariltd/vunapos
   bench --site vunapos.localhost install-app vunapos
   ```

5. Build the assets and migrate the site:

   ```bash
   bench build --app vunapos
   bench --site vunapos.localhost migrate
   ```

6. Open the site in your browser:

   ```text
   http://vunapos.localhost:8000
   ```

## Documentation

Read the [VunaPOS documentation](https://docs.navari.co.ke/vunapos/introduction) for setup instructions, feature guides, payment workflows, troubleshooting, and developer references.

## Contributing

This project uses `pre-commit` for formatting and linting.

Install and enable it inside the repository:

```bash
cd apps/vunapos
pre-commit install
```

The configured checks may include:

* ruff
* eslint
* prettier
* pyupgrade

## CI

GitHub Actions can be configured to:

* Install VunaPOS and run backend tests.
* Build and type-check the React frontend.
* Run linting and formatting checks.
* Run Frappe security and dependency checks.

## License

AGPL-3.0
