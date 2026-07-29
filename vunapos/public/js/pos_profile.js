frappe.ui.form.on("POS Profile", {
	setup(frm) {
		frm.set_query("price_list", "vunapos_allowed_price_lists", () => ({
			filters: {
				enabled: 1,
				selling: 1,
			},
		}));
	},
});
