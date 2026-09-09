const VUNAPOS_CHECKOUT_DOCTYPES = ["Sales Invoice", "POS Invoice", "Sales Order"];
const VUNAPOS_CHECKOUT_FIELD_TYPES = new Set([
	"Data",
	"Small Text",
	"Long Text",
	"Int",
	"Float",
	"Currency",
	"Percent",
	"Date",
	"Datetime",
	"Time",
	"Check",
	"Select",
	"Link",
]);

function refresh_checkout_field_options(frm, row) {
	const grid = frm.fields_dict.vunapos_checkout_fields?.grid;
	if (!grid || !row?.target_doctype) return;

	frappe.model.with_doctype(row.target_doctype, () => {
		const fields = (frappe.get_meta(row.target_doctype)?.fields || []).filter(
			(field) =>
				field.fieldname &&
				!field.read_only &&
				VUNAPOS_CHECKOUT_FIELD_TYPES.has(field.fieldtype)
		);
		const options = fields.map((field) => field.fieldname).join("\n");
		grid.update_docfield_property("fieldname", "fieldtype", "Select");
		grid.update_docfield_property("fieldname", "options", options);
		frm.refresh_field("vunapos_checkout_fields");

		const selected = fields.find((field) => field.fieldname === row.fieldname);
		if (selected && !row.label) {
			frappe.model.set_value(
				row.doctype,
				row.name,
				"label",
				selected.label || selected.fieldname
			);
		}
	});
}

function setup_checkout_field_form(frm) {
	if (frm.doctype === "POS Profile") {
		frm.set_query("price_list", "vunapos_allowed_price_lists", () => ({
			filters: { enabled: 1, selling: 1 },
		}));
	}
	frm.set_query("target_doctype", "vunapos_checkout_fields", () => ({
		filters: { name: ["in", VUNAPOS_CHECKOUT_DOCTYPES] },
	}));
	frm.fields_dict.vunapos_checkout_fields?.grid?.grid_rows?.forEach((grid_row) =>
		refresh_checkout_field_options(frm, grid_row.doc)
	);
}

function setup_workflow_configuration(frm) {
	frm.set_query("transaction_doctype", "vunapos_workflow_configuration", () => ({
		filters: { name: ["in", VUNAPOS_CHECKOUT_DOCTYPES] },
	}));
}

["POS Profile", "POS Settings"].forEach((doctype) => {
	frappe.ui.form.on(doctype, {
		setup: setup_checkout_field_form,
		refresh: setup_checkout_field_form,
		vunapos_checkout_fields_add(frm, cdt, cdn) {
			refresh_checkout_field_options(frm, frappe.get_doc(cdt, cdn));
		},
	});
});

frappe.ui.form.on("POS Profile", {
	setup: setup_workflow_configuration,
	refresh: setup_workflow_configuration,
	vunapos_workflow_configuration_transaction_doctype(frm, cdt, cdn) {
		const row = frappe.get_doc(cdt, cdn);
		const duplicate = (frm.doc.vunapos_workflow_configuration || []).some(
			(other) =>
				other.name !== row.name && other.transaction_doctype === row.transaction_doctype
		);
		if (!duplicate) return;
		frappe.msgprint(
			__(
				"This transaction DocType is already configured. Each DocType can appear only once."
			)
		);
		frappe.model.set_value(cdt, cdn, "transaction_doctype", "");
	},
});

frappe.ui.form.on("POS Profile", {
	vunapos_checkout_fields_target_doctype(frm, cdt, cdn) {
		const row = frappe.get_doc(cdt, cdn);
		row.fieldname = "";
		row.label = "";
		frm.refresh_field("vunapos_checkout_fields");
		refresh_checkout_field_options(frm, row);
	},
});

frappe.ui.form.on("POS Settings", {
	vunapos_checkout_fields_target_doctype(frm, cdt, cdn) {
		const row = frappe.get_doc(cdt, cdn);
		row.fieldname = "";
		row.label = "";
		frm.refresh_field("vunapos_checkout_fields");
		refresh_checkout_field_options(frm, row);
	},

	vunapos_checkout_fields_fieldname(frm, cdt, cdn) {
		const row = frappe.get_doc(cdt, cdn);
		if (!row.target_doctype || !row.fieldname || row.label) return;
		frappe.model.with_doctype(row.target_doctype, () => {
			const field = frappe
				.get_meta(row.target_doctype)
				?.fields?.find((item) => item.fieldname === row.fieldname);
			if (field) frappe.model.set_value(cdt, cdn, "label", field.label || field.fieldname);
		});
	},
});
