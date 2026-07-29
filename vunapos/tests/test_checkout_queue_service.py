from unittest import TestCase
from unittest.mock import Mock, patch

import frappe

from vunapos.services.checkout_queue_service import (
	QUEUE_STATUS_CANCELLED,
	QUEUE_STATUS_FAILED,
	QUEUE_STATUS_PROCESSING,
	QUEUE_STATUS_QUEUED,
	QUEUE_STATUS_REQUIRES_REVIEW,
	QUEUE_STATUS_SUBMITTED,
	enqueue_invoice_submission,
	get_queue_limits,
	process_queued_invoice,
	transition_invoice_queue,
	validate_queue_transition,
)


class TestCheckoutQueueService(TestCase):
	def _invoice(self, status=None, docstatus=0):
		return frappe._dict(
			doctype="Sales Invoice",
			name="ACC-SINV-QUEUE-0001",
			docstatus=docstatus,
			vunapos_invoice=1,
			vunapos_queue_status=status,
			vunapos_queue_attempts=0,
		)

	def test_queue_lifecycle_sets_timestamps_and_attempts(self):
		doc = self._invoice()

		transition_invoice_queue(doc, QUEUE_STATUS_QUEUED, job_id="job-1")
		self.assertEqual(doc.vunapos_queue_status, QUEUE_STATUS_QUEUED)
		self.assertEqual(doc.vunapos_queue_attempts, 0)
		self.assertEqual(doc.vunapos_queue_job_id, "job-1")
		self.assertIsNotNone(doc.vunapos_queue_created_at)

		transition_invoice_queue(doc, QUEUE_STATUS_PROCESSING)
		self.assertEqual(doc.vunapos_queue_attempts, 1)
		self.assertIsNotNone(doc.vunapos_queue_started_at)

		transition_invoice_queue(doc, QUEUE_STATUS_SUBMITTED)
		self.assertIsNotNone(doc.vunapos_queue_completed_at)
		self.assertEqual(doc.vunapos_queue_error, "")

	def test_failed_invoice_can_be_requeued_without_losing_attempt_count(self):
		doc = self._invoice(QUEUE_STATUS_PROCESSING)
		doc.vunapos_queue_attempts = 2

		transition_invoice_queue(doc, QUEUE_STATUS_FAILED, error_message="temporary failure")
		self.assertEqual(doc.vunapos_queue_error, "temporary failure")
		transition_invoice_queue(doc, QUEUE_STATUS_QUEUED)

		self.assertEqual(doc.vunapos_queue_attempts, 2)
		self.assertEqual(doc.vunapos_queue_error, "")

	def test_terminal_queue_states_cannot_be_reopened(self):
		for status in (QUEUE_STATUS_SUBMITTED, QUEUE_STATUS_CANCELLED):
			with self.subTest(status=status), self.assertRaises(frappe.ValidationError):
				validate_queue_transition(status, QUEUE_STATUS_QUEUED)

	def test_processing_failure_can_require_review(self):
		validate_queue_transition(QUEUE_STATUS_PROCESSING, QUEUE_STATUS_FAILED)
		validate_queue_transition(QUEUE_STATUS_FAILED, QUEUE_STATUS_REQUIRES_REVIEW)

	def test_non_vunapos_invoice_cannot_enter_queue(self):
		doc = self._invoice()
		doc.vunapos_invoice = 0

		with self.assertRaises(frappe.ValidationError) as context:
			transition_invoice_queue(doc, QUEUE_STATUS_QUEUED)

		self.assertEqual(context.exception.vuna_error_code, "INVALID_VUNAPOS_INVOICE")

	def test_queue_limits_are_bounded(self):
		limits = get_queue_limits(
			frappe._dict(
				vunapos_enable_background_submission=1,
				vunapos_queue_max_attempts=999,
				vunapos_queue_processing_timeout_minutes=999,
			)
		)

		self.assertTrue(limits["enabled"])
		self.assertEqual(limits["max_attempts"], 10)
		self.assertEqual(limits["processing_timeout_minutes"], 120)

	@patch("frappe.enqueue")
	def test_enqueue_uses_a_deterministic_deduplicated_after_commit_job(self, enqueue):
		doc = self._invoice()
		doc.save = Mock()

		enqueue_invoice_submission(doc)

		self.assertEqual(doc.vunapos_queue_status, QUEUE_STATUS_QUEUED)
		doc.save.assert_called_once_with(ignore_permissions=True)
		enqueue.assert_called_once_with(
			"vunapos.services.checkout_queue_service.process_queued_invoice",
			queue="short",
			timeout=300,
			enqueue_after_commit=True,
			job_id=doc.vunapos_queue_job_id,
			deduplicate=True,
			invoice_doctype=doc.doctype,
			invoice_name=doc.name,
		)

	@patch("frappe.enqueue")
	def test_repeated_enqueue_does_not_create_a_second_job(self, enqueue):
		doc = self._invoice(QUEUE_STATUS_QUEUED)

		enqueue_invoice_submission(doc)

		enqueue.assert_not_called()

	@patch("frappe.log_error")
	@patch("frappe.db.rollback")
	@patch("frappe.db.commit")
	@patch("vunapos.services.stock_reservation_service.validate_invoice_stock_reservations")
	@patch("vunapos.services.profile_service.resolve_pos_profile")
	@patch("frappe.get_doc")
	def test_worker_records_failure_without_discarding_the_draft(
		self,
		get_doc,
		resolve_profile,
		validate_reservations,
		commit,
		rollback,
		log_error,
	):
		doc = self._invoice(QUEUE_STATUS_QUEUED)
		doc.save = Mock()
		doc.submit = Mock()
		get_doc.return_value = doc
		resolve_profile.return_value = frappe._dict(
			vunapos_enable_background_submission=1,
			vunapos_queue_max_attempts=3,
		)
		validate_reservations.side_effect = frappe.ValidationError("reservation changed")

		result = process_queued_invoice(doc.doctype, doc.name)

		self.assertEqual(result["status"], QUEUE_STATUS_FAILED)
		self.assertEqual(doc.vunapos_queue_status, QUEUE_STATUS_FAILED)
		self.assertEqual(doc.docstatus, 0)
		doc.submit.assert_not_called()
		rollback.assert_called_once()
		self.assertEqual(commit.call_count, 2)
		log_error.assert_called_once()
