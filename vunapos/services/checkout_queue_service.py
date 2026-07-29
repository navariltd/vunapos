from __future__ import annotations

import hashlib
from collections.abc import Iterable

import frappe
from frappe import _
from frappe.utils import add_to_date, cint, now_datetime

QUEUE_STATUS_QUEUED = "Queued"
QUEUE_STATUS_PROCESSING = "Processing"
QUEUE_STATUS_SUBMITTED = "Submitted"
QUEUE_STATUS_FAILED = "Failed"
QUEUE_STATUS_REQUIRES_REVIEW = "Requires Review"
QUEUE_STATUS_CANCELLED = "Cancelled"

QUEUE_STATUSES = frozenset(
	{
		QUEUE_STATUS_QUEUED,
		QUEUE_STATUS_PROCESSING,
		QUEUE_STATUS_SUBMITTED,
		QUEUE_STATUS_FAILED,
		QUEUE_STATUS_REQUIRES_REVIEW,
		QUEUE_STATUS_CANCELLED,
	}
)

ALLOWED_QUEUE_TRANSITIONS = {
	None: frozenset({QUEUE_STATUS_QUEUED}),
	QUEUE_STATUS_QUEUED: frozenset({QUEUE_STATUS_PROCESSING, QUEUE_STATUS_CANCELLED}),
	QUEUE_STATUS_PROCESSING: frozenset({QUEUE_STATUS_SUBMITTED, QUEUE_STATUS_FAILED}),
	QUEUE_STATUS_FAILED: frozenset(
		{QUEUE_STATUS_QUEUED, QUEUE_STATUS_REQUIRES_REVIEW, QUEUE_STATUS_CANCELLED}
	),
	QUEUE_STATUS_REQUIRES_REVIEW: frozenset({QUEUE_STATUS_QUEUED, QUEUE_STATUS_CANCELLED}),
	QUEUE_STATUS_SUBMITTED: frozenset(),
	QUEUE_STATUS_CANCELLED: frozenset(),
}

DEFAULT_QUEUE_MAX_ATTEMPTS = 3
DEFAULT_QUEUE_PROCESSING_TIMEOUT_MINUTES = 5
MAX_QUEUE_ATTEMPTS = 10
MAX_QUEUE_PROCESSING_TIMEOUT_MINUTES = 120
MAX_QUEUE_ERROR_LENGTH = 1000


def _queue_error(code: str, message: str, meta: dict | None = None) -> None:
	exc = frappe.ValidationError(message)
	exc.vuna_error_code = code
	exc.vuna_error_meta = meta or {}
	raise exc


def normalize_queue_status(status: str | None) -> str | None:
	if status is None or not str(status).strip():
		return None
	normalized = str(status).strip()
	if normalized not in QUEUE_STATUSES:
		_queue_error(
			"QUEUE_STATE_INVALID",
			_("Unsupported VunaPOS queue state: {0}").format(normalized),
			{"status": normalized},
		)
	return normalized


def validate_queue_transition(current_status: str | None, target_status: str) -> tuple[str | None, str]:
	current = normalize_queue_status(current_status)
	target = normalize_queue_status(target_status)
	if target not in ALLOWED_QUEUE_TRANSITIONS.get(current, frozenset()):
		_queue_error(
			"QUEUE_STATE_INVALID",
			_("VunaPOS queue state cannot change from {0} to {1}").format(current or _("New"), target),
			{"current_status": current, "target_status": target},
		)
	return current, target


def transition_invoice_queue(
	doc,
	target_status: str,
	*,
	error_message: str | None = None,
	job_id: str | None = None,
) -> None:
	if not doc.get("vunapos_invoice"):
		_queue_error("INVALID_VUNAPOS_INVOICE", _("Only VunaPOS invoices can enter the checkout queue"))

	current, target = validate_queue_transition(doc.get("vunapos_queue_status"), target_status)
	if doc.docstatus == 1 and target != QUEUE_STATUS_SUBMITTED:
		_queue_error(
			"QUEUE_STATE_INVALID",
			_("A submitted invoice cannot be moved to queue state {0}").format(target),
		)
	if doc.docstatus == 2:
		_queue_error("QUEUE_STATE_INVALID", _("A cancelled invoice cannot enter the checkout queue"))

	now = now_datetime()
	doc.vunapos_queue_status = target
	if target == QUEUE_STATUS_QUEUED:
		doc.vunapos_queue_created_at = doc.get("vunapos_queue_created_at") or now
		doc.vunapos_queue_started_at = None
		doc.vunapos_queue_completed_at = None
		doc.vunapos_queue_error = ""
	if target == QUEUE_STATUS_PROCESSING:
		doc.vunapos_queue_started_at = now
		doc.vunapos_queue_attempts = cint(doc.get("vunapos_queue_attempts")) + 1
	if target in (QUEUE_STATUS_SUBMITTED, QUEUE_STATUS_CANCELLED):
		doc.vunapos_queue_completed_at = now
	if target in (QUEUE_STATUS_FAILED, QUEUE_STATUS_REQUIRES_REVIEW):
		doc.vunapos_queue_error = str(error_message or "").strip()[:MAX_QUEUE_ERROR_LENGTH]
	if target == QUEUE_STATUS_SUBMITTED:
		doc.vunapos_queue_error = ""
	if job_id is not None:
		doc.vunapos_queue_job_id = str(job_id).strip()

	# This branch documents the intended retry lifecycle and prevents callers from
	# accidentally erasing the attempt counter when a failed invoice is requeued.
	if current is None and target == QUEUE_STATUS_QUEUED:
		doc.vunapos_queue_attempts = 0


def get_queue_limits(profile) -> dict:
	max_attempts = cint(profile.get("vunapos_queue_max_attempts")) or DEFAULT_QUEUE_MAX_ATTEMPTS
	timeout = (
		cint(profile.get("vunapos_queue_processing_timeout_minutes"))
		or DEFAULT_QUEUE_PROCESSING_TIMEOUT_MINUTES
	)
	return {
		"enabled": bool(profile.get("vunapos_enable_background_submission")),
		"max_attempts": min(max(max_attempts, 1), MAX_QUEUE_ATTEMPTS),
		"processing_timeout_minutes": min(max(timeout, 1), MAX_QUEUE_PROCESSING_TIMEOUT_MINUTES),
	}


def find_invoice_by_idempotency_key(
	idempotency_key: str | None,
	invoice_doctypes: Iterable[str],
):
	key = str(idempotency_key or "").strip()
	if not key:
		return None

	for doctype in invoice_doctypes:
		if not frappe.db.table_exists(doctype):
			continue
		meta = frappe.get_meta(doctype)
		if not meta.has_field("vunapos_idempotency_key"):
			continue
		filters = {"vunapos_idempotency_key": key, "docstatus": ["<", 2]}
		if meta.has_field("vunapos_invoice"):
			filters["vunapos_invoice"] = 1
		name = frappe.db.get_value(doctype, filters, "name")
		if name:
			return frappe.get_doc(doctype, name)
	return None


def _queue_job_id(doc) -> str:
	digest = hashlib.sha256(
		f"{doc.doctype}:{doc.name}:{cint(doc.get('vunapos_queue_attempts'))}".encode()
	).hexdigest()[:24]
	return f"vunapos-invoice-submit-{digest}"


def _enqueue_submission_job(doc) -> None:
	job_id = _queue_job_id(doc)
	doc.vunapos_queue_job_id = job_id
	doc.save(ignore_permissions=True)
	frappe.enqueue(
		"vunapos.services.checkout_queue_service.process_queued_invoice",
		queue="short",
		timeout=300,
		enqueue_after_commit=True,
		job_id=job_id,
		deduplicate=True,
		invoice_doctype=doc.doctype,
		invoice_name=doc.name,
	)


def _publish_queue_update(doc) -> None:
	from vunapos.realtime import publish_checkout_queue_change

	publish_checkout_queue_change(doc)


def _get_worker_profile(doc):
	"""Validate queue provenance without treating the background worker as the cashier."""
	if (
		not doc.get("pos_profile")
		or not doc.get("vunapos_session_cashier")
		or not doc.get("vunapos_opening_entry")
	):
		_queue_error(
			"QUEUE_PROVENANCE_INVALID",
			_("Queued invoice {0} is missing its POS session provenance").format(doc.name),
		)
	profile = frappe.get_cached_doc("POS Profile", doc.pos_profile)
	if doc.get("company") != profile.company:
		_queue_error(
			"QUEUE_PROVENANCE_INVALID",
			_("Queued invoice {0} does not belong to the POS Profile company").format(doc.name),
		)
	opening_exists = frappe.db.exists(
		"POS Opening Entry",
		{
			"name": doc.vunapos_opening_entry,
			"pos_profile": profile.name,
			"user": doc.vunapos_session_cashier,
			"docstatus": 1,
		},
	)
	if not opening_exists:
		_queue_error(
			"QUEUE_PROVENANCE_INVALID",
			_("Queued invoice {0} is not linked to a valid cashier opening entry").format(doc.name),
		)
	return profile


def enqueue_invoice_submission(doc) -> None:
	"""Persist the queued state and enqueue only after the draft transaction commits."""
	status = normalize_queue_status(doc.get("vunapos_queue_status"))
	if status in (QUEUE_STATUS_QUEUED, QUEUE_STATUS_PROCESSING, QUEUE_STATUS_SUBMITTED):
		return
	if status in (QUEUE_STATUS_FAILED, QUEUE_STATUS_REQUIRES_REVIEW, QUEUE_STATUS_CANCELLED):
		_queue_error(
			"QUEUE_RETRY_REQUIRED",
			_("This invoice requires an explicit retry before it can be queued again"),
			{"status": status},
		)

	transition_invoice_queue(doc, QUEUE_STATUS_QUEUED)
	_enqueue_submission_job(doc)
	_publish_queue_update(doc)


def _require_owned_queue_invoice(pos_profile: str, invoice_name: str):
	from vunapos.services.profile_service import require_open_pos_session, resolve_pos_profile
	from vunapos.utils.permissions import require_read, require_write

	profile = resolve_pos_profile(pos_profile)
	require_read("Sales Invoice", invoice_name)
	require_write("Sales Invoice", invoice_name)
	doc = frappe.get_doc("Sales Invoice", invoice_name, for_update=True)
	opening_entry = require_open_pos_session(profile.name)
	if (
		not doc.get("vunapos_invoice")
		or doc.get("pos_profile") != profile.name
		or doc.get("vunapos_session_cashier") != frappe.session.user
		or doc.get("vunapos_opening_entry") != opening_entry.name
	):
		_queue_error(
			"QUEUE_INVOICE_NOT_AVAILABLE",
			_("This queued invoice is not available in the current cashier shift"),
		)
	return doc, profile


def get_checkout_queue(pos_profile: str) -> list[dict]:
	from vunapos.services.profile_service import require_open_pos_session, resolve_pos_profile

	profile = resolve_pos_profile(pos_profile)
	opening_entry = require_open_pos_session(profile.name)
	return frappe.get_list(
		"Sales Invoice",
		filters={
			"docstatus": 0,
			"vunapos_invoice": 1,
			"pos_profile": profile.name,
			"vunapos_opening_entry": opening_entry.name,
			"vunapos_session_cashier": frappe.session.user,
			"vunapos_queue_status": [
				"in",
				[
					QUEUE_STATUS_QUEUED,
					QUEUE_STATUS_PROCESSING,
					QUEUE_STATUS_FAILED,
					QUEUE_STATUS_REQUIRES_REVIEW,
				],
			],
		},
		fields=[
			"name",
			"customer",
			"customer_name",
			"currency",
			"grand_total",
			"rounded_total",
			"posting_date",
			"posting_time",
			"vunapos_queue_status as queue_status",
			"vunapos_queue_attempts as queue_attempts",
			"vunapos_queue_error as queue_error",
			"vunapos_queue_created_at as queued_at",
			"vunapos_queue_started_at as processing_started_at",
		],
		order_by="vunapos_queue_created_at desc, creation desc",
		limit_page_length=200,
	)


def retry_queued_invoice(pos_profile: str, invoice_name: str) -> dict:
	from vunapos.dto.invoice import invoice_to_dict
	from vunapos.services.stock_reservation_service import validate_invoice_stock_reservations

	doc, profile = _require_owned_queue_invoice(pos_profile, invoice_name)
	status = normalize_queue_status(doc.get("vunapos_queue_status"))
	if status not in (QUEUE_STATUS_FAILED, QUEUE_STATUS_REQUIRES_REVIEW):
		_queue_error("QUEUE_RETRY_NOT_ALLOWED", _("Only failed queued invoices can be retried"))
	limits = get_queue_limits(profile)
	if cint(doc.get("vunapos_queue_attempts")) >= limits["max_attempts"]:
		_queue_error(
			"QUEUE_MAX_ATTEMPTS_REACHED",
			_("This invoice has reached its maximum submission attempts and must be cancelled or reviewed"),
		)
	validate_invoice_stock_reservations(doc)
	transition_invoice_queue(doc, QUEUE_STATUS_QUEUED)
	doc.add_comment("Info", _("Background submission retried by {0}").format(frappe.session.user))
	_enqueue_submission_job(doc)
	_publish_queue_update(doc)
	return invoice_to_dict(doc)


def cancel_queued_invoice(pos_profile: str, invoice_name: str) -> dict:
	from vunapos.dto.invoice import invoice_to_dict
	from vunapos.services.stock_reservation_service import release_invoice_stock_reservations

	doc, _profile = _require_owned_queue_invoice(pos_profile, invoice_name)
	status = normalize_queue_status(doc.get("vunapos_queue_status"))
	if status not in (QUEUE_STATUS_QUEUED, QUEUE_STATUS_FAILED, QUEUE_STATUS_REQUIRES_REVIEW):
		_queue_error(
			"QUEUE_CANCEL_NOT_ALLOWED",
			_("This invoice cannot be cancelled while its submission worker is running"),
		)
	release_invoice_stock_reservations(doc)
	transition_invoice_queue(doc, QUEUE_STATUS_CANCELLED)
	doc.add_comment("Info", _("Queued sale cancelled by {0}").format(frappe.session.user))
	doc.save(ignore_permissions=True)
	_publish_queue_update(doc)
	return invoice_to_dict(doc)


def recover_stale_checkout_jobs() -> None:
	"""Restore queued jobs lost before pickup and processing jobs abandoned by a worker."""
	for row in frappe.get_all(
		"Sales Invoice",
		filters={
			"docstatus": 0,
			"vunapos_invoice": 1,
			"vunapos_queue_status": ["in", [QUEUE_STATUS_QUEUED, QUEUE_STATUS_PROCESSING]],
		},
		fields=[
			"name",
			"pos_profile",
			"vunapos_queue_status",
			"vunapos_queue_created_at",
			"vunapos_queue_started_at",
		],
		limit_page_length=1000,
	):
		profile = frappe.get_cached_doc("POS Profile", row.pos_profile)
		limits = get_queue_limits(profile)
		cutoff = add_to_date(now_datetime(), minutes=-limits["processing_timeout_minutes"])
		if row.vunapos_queue_status == QUEUE_STATUS_QUEUED:
			if row.vunapos_queue_created_at and row.vunapos_queue_created_at > cutoff:
				continue
			doc = frappe.get_doc("Sales Invoice", row.name, for_update=True)
			if doc.get("vunapos_queue_status") == QUEUE_STATUS_QUEUED:
				_enqueue_submission_job(doc)
			continue
		if row.vunapos_queue_started_at and row.vunapos_queue_started_at > cutoff:
			continue
		doc = frappe.get_doc("Sales Invoice", row.name, for_update=True)
		if doc.get("vunapos_queue_status") != QUEUE_STATUS_PROCESSING:
			continue
		message = _("The background worker exceeded its processing timeout")
		transition_invoice_queue(doc, QUEUE_STATUS_FAILED, error_message=message)
		if cint(doc.get("vunapos_queue_attempts")) >= limits["max_attempts"]:
			transition_invoice_queue(doc, QUEUE_STATUS_REQUIRES_REVIEW, error_message=message)
			doc.save(ignore_permissions=True)
			_publish_queue_update(doc)
			continue
		transition_invoice_queue(doc, QUEUE_STATUS_QUEUED)
		_enqueue_submission_job(doc)
		_publish_queue_update(doc)


def process_queued_invoice(invoice_doctype: str, invoice_name: str) -> dict:
	"""Submit one already validated and reserved draft invoice."""
	from vunapos.services.stock_reservation_service import validate_invoice_stock_reservations

	doc = frappe.get_doc(invoice_doctype, invoice_name, for_update=True)
	if doc.docstatus == 1:
		return {"doctype": doc.doctype, "name": doc.name, "status": QUEUE_STATUS_SUBMITTED}
	if doc.docstatus != 0 or normalize_queue_status(doc.get("vunapos_queue_status")) != QUEUE_STATUS_QUEUED:
		_queue_error(
			"QUEUE_STATE_INVALID",
			_("Invoice {0} is not ready for background submission").format(doc.name),
		)

	profile = _get_worker_profile(doc)
	limits = get_queue_limits(profile)
	transition_invoice_queue(doc, QUEUE_STATUS_PROCESSING)
	doc.save(ignore_permissions=True)
	_publish_queue_update(doc)
	frappe.db.commit()

	try:
		doc = frappe.get_doc(invoice_doctype, invoice_name, for_update=True)
		validate_invoice_stock_reservations(doc)
		doc.submit()
		transition_invoice_queue(doc, QUEUE_STATUS_SUBMITTED)
		doc.save(ignore_permissions=True)
		_publish_queue_update(doc)
		frappe.db.commit()
		return {"doctype": doc.doctype, "name": doc.name, "status": QUEUE_STATUS_SUBMITTED}
	except Exception as exc:
		frappe.db.rollback()
		failed = frappe.get_doc(invoice_doctype, invoice_name, for_update=True)
		if failed.docstatus == 0 and failed.get("vunapos_queue_status") == QUEUE_STATUS_PROCESSING:
			transition_invoice_queue(failed, QUEUE_STATUS_FAILED, error_message=str(exc))
			if cint(failed.get("vunapos_queue_attempts")) >= limits["max_attempts"]:
				transition_invoice_queue(
					failed,
					QUEUE_STATUS_REQUIRES_REVIEW,
					error_message=str(exc),
				)
			failed.save(ignore_permissions=True)
			_publish_queue_update(failed)
			frappe.db.commit()
		frappe.log_error(
			message=frappe.get_traceback(with_context=True),
			title=f"VunaPOS queued invoice failed: {invoice_name}",
		)
		return {
			"doctype": invoice_doctype,
			"name": invoice_name,
			"status": failed.get("vunapos_queue_status"),
			"error": str(exc)[:MAX_QUEUE_ERROR_LENGTH],
		}
