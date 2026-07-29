from unittest import TestCase

import frappe

from vunapos.services.checkout_queue_service import (
	QUEUE_STATUS_CANCELLED,
	QUEUE_STATUS_FAILED,
	QUEUE_STATUS_PROCESSING,
	QUEUE_STATUS_QUEUED,
	QUEUE_STATUS_REQUIRES_REVIEW,
	QUEUE_STATUS_SUBMITTED,
	get_queue_limits,
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
