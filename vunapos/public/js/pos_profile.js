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
	const targetDoctype = row.target_doctype;

	frappe.model.with_doctype(targetDoctype, () => {
		// A metadata request for the previous DocType may finish after the user
		// has already selected a new one. Never let that stale response restore
		// the old field list.
		const currentRow = frappe.get_doc(row.doctype, row.name);
		if (!currentRow || currentRow.target_doctype !== targetDoctype) return;
		const fields = (frappe.get_meta(targetDoctype)?.fields || []).filter(
			(field) =>
				field.fieldname &&
				!field.read_only &&
				VUNAPOS_CHECKOUT_FIELD_TYPES.has(field.fieldtype)
		);
		const options = fields.map((field) => field.fieldname).join("\n");
		const gridRow = grid.get_row(row.name);
		const fieldDoc = gridRow?.docfields?.find((field) => field.fieldname === "fieldname");
		if (fieldDoc) {
			// Grid.update_docfield_property mutates every row. That makes the
			// last asynchronous metadata response (often Sales Order) overwrite
			// the options for all other rows. Keep the options on this row only.
			fieldDoc.options = options;
			const column = gridRow.columns_list?.find((item) => item.df.fieldname === "fieldname");
			if (column?.field) {
				column.field.df = fieldDoc;
				column.field.set_data?.(options);
			}
			gridRow.refresh_field("fieldname");
		}

		const selected = fields.find((field) => field.fieldname === currentRow.fieldname);
		if (selected && !row.label) {
			frappe.model.set_value(
				row.doctype,
				currentRow.name,
				"label",
				selected.label || selected.fieldname
			);
		}
	});
}

function reset_checkout_field_selection(frm, cdt, cdn) {
	frappe.model.set_value(cdt, cdn, "fieldname", "");
	frappe.model.set_value(cdt, cdn, "label", "");
	refresh_checkout_field_options(frm, frappe.get_doc(cdt, cdn));
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

for (const doctype of ["POS Profile", "POS Settings"]) {
	frappe.ui.form.on(doctype, {
		vunapos_checkout_fields_target_doctype(frm, cdt, cdn) {
			reset_checkout_field_selection(frm, cdt, cdn);
		},

		vunapos_checkout_fields_fieldname(frm, cdt, cdn) {
			const row = frappe.get_doc(cdt, cdn);
			if (!row.target_doctype || !row.fieldname) return;
			frappe.model.set_value(cdt, cdn, "label", "");
		},
	});
}
