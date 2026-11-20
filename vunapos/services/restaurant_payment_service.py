"""Visit-owned gateway attempts; receipts retain their original cashier/shift.

Restaurant dispatch is asynchronous: the attempt commits before any provider
call. A durable Started claim prevents automatic resend after an unknown result.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt, now_datetime

from vunapos.services import gateway_payment_service as gateway

LINK = "VunaPOS Gateway Payment Link"
MANAGERS = {"System Manager", "VunaPOS Restaurant Manager"}


def context(session_name, profile, *, open_only=False):
	from vunapos.services import restaurant_billing_service as billing

	if not session_name:
		gateway._gateway_error(
			"SESSION_PAYMENT_CONTEXT_REQUIRED", _("Reload the restaurant bill before requesting a payment.")
		)
	session = billing._load(session_name, for_update=True)
	billing._profile(session, profile.name, payment=True)
	if open_only and (session.status != "Open" or session.billing_invoice):
		gateway._gateway_error(
			"SESSION_NOT_OPEN", _("This visit already has a bill or is not open for payment.")
		)
	return session


def lock_link(name, reference=None):
	row = (
		frappe._dict(reference)
		if reference
		else frappe.db.get_value(LINK, name, ["source_doctype", "source_name"], as_dict=True)
	)
	if not row:
		gateway._gateway_error("GATEWAY_PAYMENT_NOT_FOUND", _("Gateway payment source was not found."))
	# Callbacks also update source -> link. Never lock a link then its source.
	if row.source_doctype in gateway.SUPPORTED_SOURCE_DOCTYPES:
		frappe.db.get_value(row.source_doctype, row.source_name, "name", for_update=True)
	return frappe.get_doc(LINK, name, for_update=True)


def require_access(link):
	if not link.get("restaurant_session"):
		return
	from vunapos.services.restaurant_session_service import _load

	_load(link.restaurant_session)
	if not set(frappe.get_roles()) & (MANAGERS | {"VunaPOS Cashier"}):
		frappe.throw(
			_("Only restaurant cashiers and managers may review visit payments."), frappe.PermissionError
		)


def _assigned(link, profile):
	from vunapos.services.profile_service import get_pos_session

	opening = get_pos_session(frappe.session.user, profile.name)
	return opening["ready"] and (
		link.get("settlement_profile") or link.pos_profile,
		link.get("settlement_opening_entry") or link.opening_entry,
		link.get("settlement_cashier") or link.cashier,
	) == (profile.name, opening["opening_entry"], frappe.session.user)


def links(session, *, legacy=True):
	if not frappe.db.has_column(LINK, "restaurant_session"):
		return []
	# Read the canonical reference index through the locked visit, not an older
	# REPEATABLE READ snapshot established before this request acquired its lock.
	index = frappe.db.get_value("Restaurant Session", session.name, "gateway_attempts", for_update=True)
	references = {row["name"]: row for row in frappe.parse_json(index or "[]") if isinstance(row, dict)}
	names = {row if isinstance(row, str) else row["name"] for row in frappe.parse_json(index or "[]")}
	names.update(
		frappe.get_all(LINK, filters={"restaurant_session": session.name, "consumed": 0}, pluck="name")
	)
	if legacy and frappe.db.table_exists("KE Payment Request"):
		orders = frappe.get_all(
			"Sales Order", filters={"vunapos_restaurant_session": session.name}, pluck="name"
		)
		requests = frappe.get_all(
			"KE Payment Request", filters={"account_reference": ["in", orders or [""]]}, pluck="name"
		)
		if requests:
			profiles = frappe.get_all(
				"POS Profile",
				filters={
					"company": session.company,
					"vunapos_restaurant": session.restaurant,
					"vunapos_branch": session.branch,
				},
				pluck="name",
			)
			names.update(
				frappe.get_all(
					LINK,
					filters={
						"source_doctype": "KE Payment Request",
						"source_name": ["in", requests],
						"restaurant_session": ["is", "not set"],
						"consumed": 0,
						"pos_profile": ["in", profiles or [""]],
						"customer": session.customer,
						"currency": session.currency,
					},
					pluck="name",
				)
			)
	if len(names) > 200:
		gateway._gateway_error(
			"SESSION_PAYMENT_REVIEW_REQUIRED",
			_("Too many payment attempts exist for this visit. Ask accounts to review it."),
		)
	result = []
	for name in sorted(
		names,
		key=lambda name: references.get(name, {}).get("source_name")
		or frappe.db.get_value(LINK, name, "source_name")
		or "",
	):
		link = lock_link(name, references.get(name))
		link = gateway._sync_link_from_source(link)
		if not link.consumed and link.status not in gateway.TERMINAL_RELEASED_LINK_STATUSES:
			result.append(link)
	return result


def register(link):
	if not link.get("restaurant_session"):
		return
	current = frappe.db.get_value(
		"Restaurant Session", link.restaurant_session, "gateway_attempts", for_update=True
	)
	names = frappe.parse_json(current or "[]")
	if link.name not in [row if isinstance(row, str) else row["name"] for row in names]:
		names.append(
			{"name": link.name, "source_doctype": link.source_doctype, "source_name": link.source_name}
		)
		frappe.db.set_value(
			"Restaurant Session",
			link.restaurant_session,
			"gateway_attempts",
			frappe.as_json(names),
			update_modified=False,
		)


def recover(session, profile):
	if not set(frappe.get_roles()) & (MANAGERS | {"VunaPOS Cashier"}):
		return []
	result = []
	for link in links(session):
		if (
			link.get("restaurant_session")
			and link.get("dispatch_state") == "Queued"
			and link.status == "Pending"
		):
			enqueue_dispatch(link.name)
		data = gateway.gateway_payment_link_to_dict(link)
		data["handover_required"] = not link.get("restaurant_session") or not _assigned(link, profile)
		data["can_handover"] = bool(set(frappe.get_roles()) & MANAGERS)
		result.append(data)
	return result


def prepare(
	profile, session_name, fingerprint, amount, mode, gateway_account, *, source=None, loyalty_points=None
):
	from vunapos.services import restaurant_billing_service as billing
	from vunapos.services.restaurant_session_service import require_qr_order_accepted

	session = context(session_name, profile, open_only=True)
	require_qr_order_accepted(session)
	orders = billing._orders(session, lock=True)
	bill = billing._build(session, profile, orders, loyalty_points)
	from vunapos.utils.permissions import require_create

	require_create(bill.doctype)
	if not fingerprint or fingerprint != billing._review_fingerprint(orders, bill):
		gateway._gateway_error("SESSION_BILL_CHANGED", _("Refresh the bill before requesting payment."))
	pending = billing._pending_production([order.name for order in orders])
	if pending and not billing._can_complete_preparation(profile, [order.name for order in orders], pending):
		gateway._gateway_error(
			"SESSION_PREPARATION_PENDING", _("Complete preparation before taking payment.")
		)
	current = links(session)
	total = flt(bill.rounded_total or bill.grand_total)
	if (
		len({link.mode_of_payment for link in current}) != len(current)
		or sum(flt(link.amount) for link in current) > total + 0.000001
	):
		gateway._gateway_error(
			"SESSION_PAYMENT_REVIEW_REQUIRED",
			_("Earlier receipts require reconciliation before another payment attempt."),
		)
	for link in current:
		if not link.get("restaurant_session") or not _assigned(link, profile):
			gateway._gateway_error(
				"SESSION_PAYMENT_HANDOVER_REQUIRED",
				_(
					"An earlier payment belongs to another cashier, shift or profile. A manager must review its handover before taking payment."
				),
			)
		if gateway.payment_mode_gateway(profile, link.mode_of_payment) != link.payment_gateway:
			gateway._gateway_error(
				"SESSION_PAYMENT_REVIEW_REQUIRED",
				_("An earlier payment uses a gateway no longer configured on this till."),
			)
		if link.mode_of_payment == mode:
			if (
				link.payment_gateway != gateway_account
				or flt(link.amount, 2) != flt(amount, 2)
				or (source and (link.source_doctype, link.source_name) != (source.doctype, source.name))
			):
				gateway._gateway_error(
					"SESSION_PAYMENT_REVIEW_REQUIRED",
					_("Resolve the existing payment for this mode before requesting a different one."),
				)
			return session, orders, link
	if sum(flt(link.amount) for link in current) + flt(amount) > total + 0.000001:
		gateway._gateway_error(
			"SESSION_PAYMENT_AMOUNT_EXCEEDED",
			_(
				"Existing payments plus this request exceed the bill. Review the original payments; do not charge again."
			),
		)
	return session, orders, None


def validate_checkout(session, profile, payments):
	rows = frappe.parse_json(payments) if isinstance(payments, str) else payments
	rows = rows or []
	if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
		gateway._gateway_error("INVALID_PAYMENTS", _("Provide payment allocations as a list."))
	supplied = [row.get("gateway_payment_link") for row in rows if row.get("gateway_payment_link")]
	if len(supplied) != len(set(supplied)):
		gateway._gateway_error(
			"GATEWAY_PAYMENT_ALREADY_CONSUMED", _("A payment receipt may only be allocated once.")
		)
	current = links(session)
	for link in current:
		if not link.get("restaurant_session") or not _assigned(link, profile):
			gateway._gateway_error(
				"SESSION_PAYMENT_HANDOVER_REQUIRED",
				_("A manager must review the earlier payment's cashier/shift assignment before checkout."),
			)
		if link.status not in gateway.SUCCESSFUL_LINK_STATUSES or link.name not in supplied:
			gateway._gateway_error(
				"SESSION_PAYMENT_UNRESOLVED",
				_(
					"Resolve and allocate all existing visit payments before checkout. A pending or received payment cannot be replaced with cash."
				),
			)
	for name in supplied:
		link = lock_link(name)
		if link.get("restaurant_session") != session.name:
			gateway._gateway_error(
				"SESSION_PAYMENT_CONTEXT_MISMATCH",
				_("This receipt does not belong to this restaurant visit."),
			)


def guard_order_change(session):
	if links(session):
		gateway._gateway_error(
			"SESSION_PAYMENT_UNRESOLVED",
			_(
				"This visit has an active or received payment. Resolve its payment before cancelling orders or changing charges."
			),
		)


def enqueue_dispatch(name):
	frappe.enqueue(
		"vunapos.services.restaurant_payment_service.dispatch",
		queue="short",
		enqueue_after_commit=True,
		job_id=f"restaurant-payment-{name}",
		deduplicate=True,
		link_name=name,
	)


def _claim_dispatch(link_name):
	"""DB-only claim; conflicts may be retried before any provider call."""
	visit = frappe.db.get_value(LINK, link_name, "restaurant_session")
	if not visit:
		return
	visit_state = frappe.db.get_value("Restaurant Session", visit, "status", for_update=True)
	link = lock_link(link_name)
	link = gateway._sync_link_from_source(link)
	if link.consumed or link.status != "Pending" or link.get("dispatch_state") != "Queued":
		return
	if visit_state != "Open":
		link.db_set(
			{"status": "Cancelled", "remarks": "Not dispatched: the restaurant visit is no longer open."}
		)
		return
	source = frappe.get_doc(link.source_doctype, link.source_name)
	if source.docstatus != 0:
		if source.docstatus == 1:
			link.db_set("dispatch_state", "Submitted")
		return
	if flt(source.amount) != flt(link.amount) or source.currency != link.currency:
		link.db_set(
			{
				"status": "Cancelled",
				"remarks": "Not dispatched: source amount or currency changed. Review the original request.",
			}
		)
		return
	link.db_set("dispatch_state", "Started")
	frappe.db.commit()  # nosemgrep - durable worker claim must precede external money movement
	return link, source


def dispatch(link_name):
	"""Worker only: commit the send claim BEFORE calling an external provider."""
	from vunapos.utils.transactions import run_with_database_retry

	claim = run_with_database_retry(_claim_dispatch, link_name)
	if not claim:
		return
	link, source = claim
	try:
		source.flags.ignore_permissions = True
		source.submit()
		link.db_set("dispatch_state", "Submitted")
		gateway._sync_link_from_source(link)
	except Exception:
		# Do not erase provider response IDs or retry after an ambiguous outcome.
		link.db_set(
			{
				"dispatch_state": "Uncertain",
				"status": "Pending",
				"remarks": "Payment dispatch outcome is unconfirmed. Check the original request/provider; do not send another prompt.",
			}
		)
		frappe.log_error(frappe.get_traceback(), "Restaurant payment dispatch unconfirmed")


def handover(link_name, session_name, pos_profile, reason):
	from vunapos.services.profile_service import require_open_pos_session, resolve_pos_profile

	if not set(frappe.get_roles()) & MANAGERS:
		frappe.throw(_("A restaurant manager must approve payment handover."), frappe.PermissionError)
	if not isinstance(reason, str) or not reason.strip() or len(reason) > 500:
		gateway._gateway_error(
			"PAYMENT_REASON_REQUIRED", _("Enter a handover reason of 1 to 500 characters.")
		)
	profile = resolve_pos_profile(pos_profile)
	session = context(session_name, profile, open_only=True)
	link = lock_link(link_name)
	if gateway.payment_mode_gateway(profile, link.mode_of_payment) != link.payment_gateway:
		gateway._gateway_error(
			"GATEWAY_PAYMENT_SESSION_MISMATCH",
			_("Choose a till with the same payment mode and gateway account for handover."),
		)
	if link.get("restaurant_session") and link.restaurant_session != session.name:
		gateway._gateway_error(
			"SESSION_PAYMENT_CONTEXT_MISMATCH", _("This payment belongs to another visit.")
		)
	original = frappe.get_cached_doc("POS Profile", link.pos_profile)
	if (
		original.company,
		original.get("vunapos_restaurant"),
		original.get("vunapos_branch"),
		link.customer,
		link.currency,
	) != (session.company, session.restaurant, session.branch, session.customer, session.currency):
		gateway._gateway_error(
			"SESSION_PAYMENT_CONTEXT_MISMATCH",
			_("The payment's original restaurant, branch, customer or currency does not match."),
		)
	if link.consumed:
		gateway._gateway_error("GATEWAY_PAYMENT_ALREADY_CONSUMED", _("This payment is already allocated."))
	link = gateway._sync_link_from_source(link)
	if link.status in gateway.TERMINAL_RELEASED_LINK_STATUSES:
		gateway._gateway_error(
			"SESSION_PAYMENT_REVIEW_REQUIRED",
			_("This reservation was released. Review the provider receipt before attaching it again."),
		)
	source = frappe.get_doc(link.source_doctype, link.source_name)
	if link.source_doctype == "KE Payment Request":
		referenced_visit = (
			frappe.db.get_value("Sales Order", source.get("account_reference"), "vunapos_restaurant_session")
			if source.get("account_reference")
			else None
		)
		if referenced_visit and referenced_visit != session.name:
			gateway._gateway_error(
				"SESSION_PAYMENT_CONTEXT_MISMATCH",
				_("The original prompt references a different restaurant visit."),
			)
	if link.status in gateway.SUCCESSFUL_LINK_STATUSES:
		gateway._validate_source(link, source, 2)
	opening = require_open_pos_session(profile.name)
	history = frappe.parse_json(link.get("handover_history") or "[]")
	history.append(
		{
			"at": str(now_datetime()),
			"by": frappe.session.user,
			"reason": reason.strip(),
			"previous": [
				link.get("settlement_profile") or link.pos_profile,
				link.get("settlement_opening_entry") or link.opening_entry,
				link.get("settlement_cashier") or link.cashier,
			],
			"next": [profile.name, opening.name, frappe.session.user],
		}
	)
	link.db_set(
		{
			"restaurant_session": session.name,
			"settlement_profile": profile.name,
			"settlement_opening_entry": opening.name,
			"settlement_cashier": frappe.session.user,
			"handover_history": frappe.as_json(history),
		}
	)
	register(link)
	return gateway.gateway_payment_link_to_dict(link)
