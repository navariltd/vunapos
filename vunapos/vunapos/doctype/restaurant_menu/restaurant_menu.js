frappe.ui.form.on("Restaurant Menu", {
	setup(frm) {
		frm.set_query("restaurant", () => ({
			filters: { enabled: 1, ...(frm.doc.company ? { company: frm.doc.company } : {}) },
		}));
		frm.set_query("branch", () => ({ filters: { vunapos_company: frm.doc.company || "" } }));
		frm.set_query("floor", "floors", () => ({
			filters: {
				is_active: 1,
				...(frm.doc.restaurant ? { restaurant: frm.doc.restaurant } : {}),
				...(frm.doc.branch ? { branch: frm.doc.branch } : {}),
			},
		}));
		frm.set_query("item_code", "items", () => ({
			filters: { disabled: 0, is_sales_item: 1 },
		}));
		frm.set_query("menu_section", "items", () => ({ filters: { enabled: 1 } }));
	},
	async restaurant(frm) {
		const restaurant = frm.doc.restaurant;
		if (!restaurant) return;
		const { message } = await frappe.db.get_value("Restaurant", restaurant, "company");
		if (frm.doc.restaurant === restaurant && message)
			await frm.set_value("company", message.company);
	},
});
