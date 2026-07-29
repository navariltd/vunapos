app_name = "vunapos"
app_title = "VunaPOS"
app_publisher = "Navari Limited"
app_description = "VunaPOS"
app_email = "solutions@navari.co.ke"
app_license = "agpl-3.0"

# Apps
# ------------------

required_apps = ["frappe/erpnext"]

# Each item in the list will be shown as an app in the apps page
app_logo_url = "/assets/vunapos/logo.png"
app_icon_title = "VunaPOS"

add_to_apps_screen = [
	{
		"name": app_name,
		"logo": app_logo_url,
		"title": app_title,
		"route": "/desk/vunapos",
		"has_permission": "vunapos.permissions.has_app_permission",
	}
]

fixtures = [
	{
		"doctype": "Custom HTML Block",
		"filters": [["name", "=", "VunaPOS Launcher"]],
	}
]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/vunapos/css/vunapos.css"
# app_include_js = "/assets/vunapos/js/vunapos.js"

# include js, css files in header of web template
# web_include_css = "/assets/vunapos/css/vunapos.css"
# web_include_js = "/assets/vunapos/js/vunapos.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "vunapos/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {"POS Profile": "public/js/pos_profile.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "vunapos/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "vunapos.utils.jinja_methods",
# 	"filters": "vunapos.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "vunapos.install.before_install"
after_install = "vunapos.setup.utils.ensure_vunapos_custom_fields"
after_migrate = "vunapos.setup.utils.ensure_vunapos_custom_fields"

# Uninstallation
# ------------

# before_uninstall = "vunapos.uninstall.before_uninstall"
# after_uninstall = "vunapos.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "vunapos.utils.before_app_install"
# after_app_install = "vunapos.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "vunapos.utils.before_app_uninstall"
# after_app_uninstall = "vunapos.utils.after_app_uninstall"

# Build
# ------------------
# To hook into the build process

# after_build = "vunapos.build.after_build"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "vunapos.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
	doctype: {
		"on_update": "vunapos.realtime.publish_configuration_change",
		"on_trash": "vunapos.realtime.publish_configuration_change",
	}
	for doctype in (
		"POS Profile",
		"POS Settings",
		"Accounts Settings",
		"Sales Taxes and Charges Template",
		"Item Tax Template",
		"Item",
		"Item Price",
		"Price List",
		"Pricing Rule",
		"Mode of Payment",
	)
}

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"vunapos.tasks.all"
# 	],
# 	"daily": [
# 		"vunapos.tasks.daily"
# 	],
# 	"hourly": [
# 		"vunapos.tasks.hourly"
# 	],
# 	"weekly": [
# 		"vunapos.tasks.weekly"
# 	],
# 	"monthly": [
# 		"vunapos.tasks.monthly"
# 	],
# }

# Testing
# -------

before_tests = "vunapos.setup.utils.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "vunapos.custom.task.CustomTaskMixin"
# }
extend_doctype_class = {
	"POS Closing Entry": "vunapos.overrides.pos_closing_entry.VunaPOSClosingEntryMixin",
	"POS Opening Entry": "vunapos.overrides.pos_opening_entry.VunaPOSOpeningEntryMixin",
	"POS Invoice": "vunapos.overrides.credit_sale.VunaPOSCreditSaleMixin",
}

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "vunapos.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "vunapos.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["vunapos.utils.before_request"]
# after_request = ["vunapos.utils.after_request"]

# Job Events
# ----------
# before_job = ["vunapos.utils.before_job"]
# after_job = ["vunapos.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"vunapos.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

website_route_rules = [
	{"from_route": "/vunapos/<path:app_path>", "to_route": "vunapos"},
	{"from_route": "/vunapos", "to_route": "vunapos"},
]
