def success(data=None, meta=None, warnings=None):
	return {
		"ok": True,
		"data": {} if data is None else data,
		"warnings": warnings or [],
		"meta": meta or {},
	}


def failure(message, code=None, field=None, meta=None):
	error = {
		"code": code or "ERROR",
		"message": message,
	}
	if field:
		error["field"] = field

	return {
		"ok": False,
		"data": None,
		"errors": [error],
		"warnings": [],
		"meta": meta or {},
	}
