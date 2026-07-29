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
	_get_worker_profile,
	audit_checkout_queue_integrity,
	cancel_queued_invoice,
	enqueue_invoice_submission,
	get_queue_limits,
	process_queued_invoice,
	recover_stale_checkout_jobs,
	retry_queued_invoice,
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
	@patch("vunapos.services.checkout_queue_service._get_worker_profile")
	@patch("frappe.get_doc")
	def test_worker_records_failure_without_discarding_the_draft(
		self,
		get_doc,
		get_worker_profile,
		validate_reservations,
		commit,
		rollback,
		log_error,
	):
		doc = self._invoice(QUEUE_STATUS_QUEUED)
		doc.save = Mock()
		doc.submit = Mock()
		get_doc.return_value = doc
		get_worker_profile.return_value = frappe._dict(
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

	@patch("vunapos.services.checkout_queue_service._publish_queue_update")
	@patch("frappe.db.commit")
	@patch("vunapos.services.stock_reservation_service.validate_invoice_stock_reservations")
	@patch("vunapos.services.checkout_queue_service._get_worker_profile")
	@patch("frappe.get_doc")
	def test_worker_publishes_processing_and_submitted_updates(
		self,
		get_doc,
		get_worker_profile,
		validate_reservations,
		commit,
		publish_update,
	):
		doc = self._invoice(QUEUE_STATUS_QUEUED)
		doc.save = Mock()
		doc.submit = Mock(side_effect=lambda: setattr(doc, "docstatus", 1))
		get_doc.return_value = doc
		get_worker_profile.return_value = frappe._dict(
			vunapos_enable_background_submission=1,
			vunapos_queue_max_attempts=3,
		)
		published_statuses = []
		publish_update.side_effect = lambda queued_doc: published_statuses.append(
			queued_doc.vunapos_queue_status
		)

		result = process_queued_invoice(doc.doctype, doc.name)

		self.assertEqual(result["status"], QUEUE_STATUS_SUBMITTED)
		self.assertEqual(published_statuses, [QUEUE_STATUS_PROCESSING, QUEUE_STATUS_SUBMITTED])
		validate_reservations.assert_called_once_with(doc)
		self.assertEqual(commit.call_count, 2)

	@patch("vunapos.services.checkout_queue_service._enqueue_submission_job")
	@patch("vunapos.services.stock_reservation_service.validate_invoice_stock_reservations")
	@patch("vunapos.services.checkout_queue_service._require_owned_queue_invoice")
	def test_cashier_retry_revalidates_reservation_and_queues_new_attempt(
		self, require_owned, validate_reservations, enqueue_job
	):
		doc = self._invoice(QUEUE_STATUS_FAILED)
		doc.vunapos_queue_attempts = 1
		doc.add_comment = Mock()
		profile = frappe._dict(vunapos_enable_background_submission=1, vunapos_queue_max_attempts=3)
		require_owned.return_value = (doc, profile)

		result = retry_queued_invoice("Counter 1", doc.name)

		self.assertEqual(result["queue_status"], QUEUE_STATUS_QUEUED)
		validate_reservations.assert_called_once_with(doc)
		enqueue_job.assert_called_once_with(doc)

	@patch("vunapos.services.stock_reservation_service.release_invoice_stock_reservations")
	@patch("vunapos.services.checkout_queue_service._require_owned_queue_invoice")
	def test_cashier_cancel_releases_reservation_and_closes_queue_record(
		self, require_owned, release_reservations
	):
		doc = self._invoice(QUEUE_STATUS_FAILED)
		doc.add_comment = Mock()
		doc.save = Mock()
		require_owned.return_value = (doc, frappe._dict())

		result = cancel_queued_invoice("Counter 1", doc.name)

		self.assertEqual(result["queue_status"], QUEUE_STATUS_CANCELLED)
		release_reservations.assert_called_once_with(doc)
		doc.save.assert_called_once_with(ignore_permissions=True)

	@patch("vunapos.services.checkout_queue_service._enqueue_submission_job")
	@patch("frappe.get_cached_doc")
	@patch("frappe.get_doc")
	@patch("frappe.get_all")
	def test_stale_processing_job_is_requeued(self, get_all, get_doc, get_profile, enqueue_job):
		get_all.return_value = [
			frappe._dict(
				name="ACC-SINV-STALE-1",
				pos_profile="Counter 1",
				vunapos_queue_status=QUEUE_STATUS_PROCESSING,
				vunapos_queue_started_at=frappe.utils.add_days(frappe.utils.now_datetime(), -1),
			)
		]
		doc = self._invoice(QUEUE_STATUS_PROCESSING)
		doc.vunapos_queue_attempts = 1
		get_doc.return_value = doc
		get_profile.return_value = frappe._dict(
			vunapos_enable_background_submission=1,
			vunapos_queue_max_attempts=3,
			vunapos_queue_processing_timeout_minutes=5,
		)

		recover_stale_checkout_jobs()

		self.assertEqual(doc.vunapos_queue_status, QUEUE_STATUS_QUEUED)
		enqueue_job.assert_called_once_with(doc)

	@patch("vunapos.services.checkout_queue_service._enqueue_submission_job")
	@patch("frappe.get_cached_doc")
	@patch("frappe.get_doc")
	@patch("frappe.get_all")
	def test_stale_queued_invoice_is_enqueued_again(self, get_all, get_doc, get_profile, enqueue_job):
		get_all.return_value = [
			frappe._dict(
				name="ACC-SINV-QUEUED-STALE-1",
				pos_profile="Counter 1",
				vunapos_queue_status=QUEUE_STATUS_QUEUED,
				vunapos_queue_created_at=frappe.utils.add_days(frappe.utils.now_datetime(), -1),
			)
		]
		doc = self._invoice(QUEUE_STATUS_QUEUED)
		get_doc.return_value = doc
		get_profile.return_value = frappe._dict(
			vunapos_enable_background_submission=1,
			vunapos_queue_processing_timeout_minutes=5,
		)

		recover_stale_checkout_jobs()

		enqueue_job.assert_called_once_with(doc)

	@patch("frappe.db.exists", return_value=True)
	@patch("frappe.get_cached_doc")
	def test_worker_profile_uses_invoice_provenance_not_worker_assignment(self, get_profile, exists):
		doc = self._invoice(QUEUE_STATUS_QUEUED)
		doc.company = "Vuna Company"
		doc.pos_profile = "Counter 1"
		doc.vunapos_session_cashier = "cashier@example.com"
		doc.vunapos_opening_entry = "POS-OPE-0001"
		profile = frappe._dict(name="Counter 1", company="Vuna Company")
		get_profile.return_value = profile

		self.assertIs(_get_worker_profile(doc), profile)
		exists.assert_called_once_with(
			"POS Opening Entry",
			{
				"name": "POS-OPE-0001",
				"pos_profile": "Counter 1",
				"user": "cashier@example.com",
				"docstatus": 1,
			},
		)

	@patch("frappe.db.exists", return_value=False)
	@patch("frappe.get_cached_doc", return_value=frappe._dict(name="Counter 1", company="Vuna Company"))
	def test_worker_rejects_an_invalid_opening_entry(self, _get_profile, _exists):
		doc = self._invoice(QUEUE_STATUS_QUEUED)
		doc.company = "Vuna Company"
		doc.pos_profile = "Counter 1"
		doc.vunapos_session_cashier = "cashier@example.com"
		doc.vunapos_opening_entry = "POS-OPE-INVALID"

		with self.assertRaises(frappe.ValidationError) as context:
			_get_worker_profile(doc)

		self.assertEqual(context.exception.vuna_error_code, "QUEUE_PROVENANCE_INVALID")

	@patch("frappe.log_error")
	@patch(
		"vunapos.services.stock_reservation_service.validate_invoice_stock_reservations",
		side_effect=frappe.ValidationError("reservation mismatch"),
	)
	@patch("frappe.get_doc")
	@patch("frappe.get_all", side_effect=[[frappe._dict(name="ACC-SINV-BROKEN-1")], []])
	def test_integrity_audit_reports_active_mismatches(
		self, _get_all, get_doc, _validate_reservations, log_error
	):
		get_doc.return_value = self._invoice(QUEUE_STATUS_FAILED)

		result = audit_checkout_queue_integrity()

		self.assertEqual(result["active_checked"], 1)
		self.assertEqual(result["integrity_errors"], ["ACC-SINV-BROKEN-1"])
		self.assertEqual(result["terminal_reservations_released"], [])
		log_error.assert_called_once()

	@patch(
		"erpnext.stock.doctype.stock_reservation_entry.stock_reservation_entry.cancel_stock_reservation_entries"
	)
	@patch("frappe.db.get_value")
	@patch("frappe.get_doc")
	@patch("frappe.get_all", side_effect=[[], ["ACC-SINV-SUBMITTED-1"]])
	def test_integrity_audit_releases_only_terminal_reservation_leaks(
		self, _get_all, get_doc, get_value, cancel_reservations
	):
		get_value.return_value = frappe._dict(
			vunapos_invoice=1,
			vunapos_queue_status=QUEUE_STATUS_SUBMITTED,
		)
		doc = Mock()
		get_doc.return_value = doc

		result = audit_checkout_queue_integrity()

		self.assertEqual(result["terminal_reservations_released"], ["ACC-SINV-SUBMITTED-1"])
		cancel_reservations.assert_called_once_with(
			voucher_type="Sales Invoice",
			voucher_no="ACC-SINV-SUBMITTED-1",
			notify=False,
		)
		doc.add_comment.assert_called_once()
