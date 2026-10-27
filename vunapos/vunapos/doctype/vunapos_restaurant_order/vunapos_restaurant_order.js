// Copyright (c) 2026, Navari Limited and contributors
// For license information, please see license.txt

frappe.ui.form.on("VunaPOS Restaurant Order", {
	setup(frm) {
		// Only active tables of this order's POS Profile can be picked.
		frm.set_query("restaurant_table", () => ({
			filters: { pos_profile: frm.doc.pos_profile, is_active: 1 },
		}));
	},

	// requires_table is fetched from the service type. The Table field shows and
	// becomes mandatory through depends_on / mandatory_depends_on; switching to a
	// service type without tables clears the table, as the server also does.
	requires_table(frm) {
		if (!frm.doc.requires_table && frm.doc.restaurant_table) {
			frm.set_value("restaurant_table", null);
		}
	},

	pos_profile(frm) {
		if (frm.doc.restaurant_table) frm.set_value("restaurant_table", null);
	},
});

frappe.ui.form.on("VunaPOS Restaurant Order Item", {
	// Show the UOM as soon as an item is picked. The server applies the same
	// rule on save (Sales UOM, else Stock UOM) and rejects a UOM the item lacks.
	async item_code(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row.item_code) return;
		const { message } = await frappe.db.get_value("Item", row.item_code, [
			"sales_uom",
			"stock_uom",
		]);
		if (message) {
			frappe.model.set_value(cdt, cdn, "uom", message.sales_uom || message.stock_uom);
		}
	},
});
