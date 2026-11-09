frappe.ui.form.on("Restaurant", {
	setup(frm) {
		frm.set_query("branch", "service_types", () => ({
			filters: { vunapos_company: frm.doc.company || "" },
		}));
	},
});
