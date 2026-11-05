frappe.ui.form.on("Item", {
	setup(frm) {
		frm.set_query("modifier_group", "vunapos_restaurant_modifiers", () => ({
			filters: { enabled: 1 },
		}));
		frm.set_query("addon_item", "vunapos_restaurant_addons", () => ({
			filters: { disabled: 0, is_sales_item: 1, has_variants: 0 },
		}));
	},
});
