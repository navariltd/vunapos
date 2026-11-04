frappe.ui.form.on("Restaurant Menu", {
	setup(frm) {
		frm.set_query("item_code", "items", () => ({
			filters: { disabled: 0, is_sales_item: 1 },
		}));
		frm.set_query("menu_section", "items", () => ({ filters: { enabled: 1 } }));
	},
});
