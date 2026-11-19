"""Savepoint cleanup that preserves the error which aborted a transaction."""

import frappe

DATABASE_CONFLICTS = (frappe.QueryDeadlockError, frappe.QueryTimeoutError)


def run_with_database_retry(fn, *args, **kwargs):
	"""Replay a DB-only transaction, never an external action or a partial write."""
	for attempt in range(3):
		messages = list(frappe.local.message_log or [])
		try:
			return fn(*args, **kwargs)
		except DATABASE_CONFLICTS:
			# Error 1020 can remove every savepoint. A retry needs a new read
			# view and must discard callbacks and cached docs from the old one.
			frappe.db.rollback()
			frappe.local.cache.clear()
			frappe.local.message_log = messages
			if attempt == 2:
				raise


def rollback_savepoint(name):
	try:
		frappe.db.rollback(save_point=name)
	except frappe.db.OperationalError as exc:
		if not exc.args or exc.args[0] != 1305:
			raise
		# InnoDB may already have rolled back everything after a deadlock or
		# snapshot conflict. There is no savepoint left; reset callbacks/caches
		# through Frappe's full rollback instead of masking the original error.
		frappe.db.rollback()
