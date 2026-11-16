"""Short-lived Redis caches for permission-scoped POS catalogue responses."""

import frappe

CACHE_KEY_PREFIX = "vunapos:catalogue:v1:"
CACHE_TTL_SECONDS = 30


def _key(kind, *parts):
	return CACHE_KEY_PREFIX + ":".join([kind, *(str(part or "") for part in parts)])


def item_search_key(user, query, profile, customer, price_list, limit, item_groups=None, item_codes=None):
	groups = "" if item_groups is None else ",".join(sorted(item_groups)) or "-"
	codes = "" if item_codes is None else ",".join(sorted(item_codes)) or "-"
	return _key("items", user, query, profile, customer, price_list, limit, groups, codes)


def customer_search_key(user, query, limit, customer_groups=None):
	groups = ",".join(customer_groups) if customer_groups else ""
	return _key("customers", user, query, limit, groups)


def get(key):
	return frappe.cache().get_value(key, shared=True)


def set(key, value):
	frappe.cache().set_value(key, value, expires_in_sec=CACHE_TTL_SECONDS, shared=True)


def invalidate_customer_search_cache():
	"""Drop cached customer searches so a new customer is found straight away."""
	cache = frappe.cache()
	# get_keys returns bytes, while shared keys are cached in-request as str;
	# delete by str so this request's local copy goes too.
	keys = [
		key.decode() if isinstance(key, bytes) else key
		for key in cache.get_keys(_key("customers"), shared=True)
	]
	cache.delete_value(keys, shared=True)


def invalidate_catalogue_cache(doc=None, method=None):
	"""Invalidate all catalogue/customer snapshots after source data changes."""
	frappe.cache().delete_keys(CACHE_KEY_PREFIX, shared=True)
