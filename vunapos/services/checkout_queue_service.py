from __future__ import annotations

from collections.abc import Iterable

import frappe
from frappe import _
from frappe.utils import cint, now_datetime

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
