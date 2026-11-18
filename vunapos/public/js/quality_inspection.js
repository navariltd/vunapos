frappe.ui.form.on("Quality Inspection", {
	async onload(frm) {
		if (!frm.is_new() || frm.__vunapos_receipt_context) return;
		const query = new URLSearchParams(window.location.search);
		const captured = window.vunaposReceiptInspectionContext || {};
		const pos_profile = query.get("vunapos_profile") || captured.pos_profile;
		const stock_entry = query.get("vunapos_source") || captured.stock_entry;
		const receipt = query.get("vunapos_receipt") || captured.receipt;
		const row_name = query.get("vunapos_row") || captured.row_name;
		if (!pos_profile || !stock_entry || !receipt || !row_name) return;
		if (frm.doc.reference_type !== "Stock Entry" || frm.doc.reference_name !== receipt) return;
		delete window.vunaposReceiptInspectionContext;
		frm.__vunapos_receipt_context = true;
		frm.disable_save();
		try {
			const response = await frappe.call({
				method: "vunapos.api.stock.inspection_context",
				args: { pos_profile, stock_entry, receipt, row_name },
			});
			const result = response.message;
			if (!result?.ok)
				throw new Error(
					result?.errors?.[0]?.message || __("Unable to validate the receipt item.")
				);
			if (result.data.name) {
				frappe.set_route("Form", "Quality Inspection", result.data.name);
				return;
			}
			// Frappe deliberately ignores no-copy fields in route defaults. Set the
			// row reference only after the server validates the receipt context.
			await frm.set_value(result.data.defaults);
			frm.enable_save();
		} catch (error) {
			frappe.msgprint({
				title: __("Receipt inspection"),
				message: error.message || __("Open the receipt again and retry."),
				indicator: "red",
			});
		}
	},
});
