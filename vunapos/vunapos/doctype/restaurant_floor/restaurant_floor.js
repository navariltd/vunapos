// Copyright (c) 2026, Navari Limited and contributors
// For license information, please see license.txt

frappe.ui.form.on("Restaurant Floor", {
	setup(frm) {
		frm.set_query("branch", () => ({
			filters: { vunapos_company: frm.restaurant_company || "" },
		}));
	},
	async refresh(frm) {
		await load_floor_company(frm);
	},
	async restaurant(frm) {
		await load_floor_company(frm);
	},
});

async function load_floor_company(frm) {
	const restaurant = frm.doc.restaurant;
	frm.restaurant_company = null;
	if (!restaurant) return;
	const { message } = await frappe.db.get_value("Restaurant", restaurant, "company");
	if (frm.doc.restaurant === restaurant) frm.restaurant_company = message?.company;
}
