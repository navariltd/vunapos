import frappe

from vunapos.services.batch_service import allocate_batches as allocate_batches_service
from vunapos.services.batch_service import get_item_batches as get_item_batches_service
from vunapos.services.batch_service import validate_batch_allocation as validate_batch_allocation_service
from vunapos.utils.response import failure, success


def _failure_from_exception(exc):
	return failure(
		str(exc),
		code=getattr(exc, "vuna_error_code", exc.__class__.__name__),
		meta=getattr(exc, "vuna_error_meta", None),
	)


@frappe.whitelist()
def get_item_batches(item_code: str, warehouse: str | None = None, pos_profile: str | None = None):
	try:
		return success(
			get_item_batches_service(item_code=item_code, warehouse=warehouse, pos_profile=pos_profile)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def allocate_batches(item_code, qty, warehouse=None, pos_profile=None, strategy="FEFO"):
	try:
		return success(
			allocate_batches_service(
				item_code=item_code,
				qty=qty,
				warehouse=warehouse,
				pos_profile=pos_profile,
				strategy=strategy,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)


@frappe.whitelist()
def validate_batch_allocation(item_code, qty, allocations, warehouse=None):
	try:
		return success(
			validate_batch_allocation_service(
				item_code=item_code,
				qty=qty,
				allocations=frappe.parse_json(allocations),
				warehouse=warehouse,
			)
		)
	except Exception as exc:
		return _failure_from_exception(exc)
