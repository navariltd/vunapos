frappe.ui.form.on("Restaurant Modifier Group", {
	setup(frm) {
		frm.set_query("addon_item", "options", () => ({
			filters: { disabled: 0, is_sales_item: 1, has_variants: 0 },
		}));
	},
});
