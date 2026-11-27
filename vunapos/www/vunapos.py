import frappe

no_cache = 1


def get_context(context):
	context.update(
		{
			"build_version": frappe.utils.get_build_version(),
			"vunapos_site_name": frappe.local.site,
		}
	)
	return context
