frappe.ui.form.on("Restaurant Availability", {
	setup(frm) {
		frm.set_query("item", () => ({ filters: { disabled: 0, is_sales_item: 1 } }));
		frm.set_query("restaurant", () => ({ filters: { enabled: 1 } }));
		frm.set_query("branch", () => ({ filters: { vunapos_company: frm.doc.company || "" } }));
		frm.set_query("kitchen_station", () => ({
			filters: { restaurant: frm.doc.restaurant || "", branch: frm.doc.branch || "" },
		}));
	},
	async restaurant(frm) {
		const restaurant = frm.doc.restaurant;
		const company = restaurant
			? await frappe.db.get_value("Restaurant", restaurant, "company")
			: null;
		if (frm.doc.restaurant !== restaurant) return;
		await frm.set_value({
			company: company?.message?.company || null,
			branch: null,
			kitchen_station: null,
		});
	},
	branch(frm) {
		if (frm.is_new()) return frm.set_value("kitchen_station", null);
	},
	target_type(frm) {
		if (frm.is_new()) return frm.set_value({ item: null, kitchen_station: null });
	},
	refresh(frm) {
		if (!frm.is_new()) {
			for (const field of ["restaurant", "branch", "target_type", "item", "kitchen_station"])
				frm.set_df_property(field, "read_only", 1);
		}
	},
});
