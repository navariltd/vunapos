frappe.ui.form.on("Kitchen Station", {
	setup(frm) {
		frm.set_query("restaurant", () => ({
			filters: { enabled: 1, ...(frm.doc.company ? { company: frm.doc.company } : {}) },
		}));
		frm.set_query("branch", () => ({
			filters: {
				...(frm.doc.company ? { vunapos_company: frm.doc.company } : {}),
			},
		}));
		for (const field of ["raw_material_warehouse", "wip_warehouse"]) {
			frm.set_query(field, () => ({
				filters: { company: frm.doc.company, is_group: 0, disabled: 0 },
			}));
		}
	},
	async refresh(frm) {
		await set_restaurant_context(frm);
	},
	async restaurant(frm) {
		await set_restaurant_context(frm);
	},
	async company(frm) {
		if (!frm.doc.restaurant) return;
		const restaurant = frm.doc.restaurant;
		const company = frm.doc.company;
		const { message } = await frappe.db.get_value("Restaurant", restaurant, ["company"]);
		if (frm.doc.restaurant !== restaurant || frm.doc.company !== company) return;
		if (message && frm.doc.company && message.company !== frm.doc.company) {
			await frm.set_value({ restaurant: null, branch: null });
		}
	},
});

async function set_restaurant_context(frm) {
	const restaurant = frm.doc.restaurant;
	if (!restaurant) {
		if (frm.doc.branch) await frm.set_value("branch", null);
		return;
	}
	const { message } = await frappe.db.get_value("Restaurant", restaurant, "company");
	if (frm.doc.restaurant !== restaurant || !message) return;
	if (frm.doc.company !== message.company) {
		await frm.set_value({ company: message.company, branch: null });
	}
}
