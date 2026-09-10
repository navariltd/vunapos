"""Short-lived Redis caches for permission-scoped POS catalogue responses."""

import frappe

CACHE_KEY_PREFIX = "vunapos:catalogue:v1:"
CACHE_TTL_SECONDS = 30


def _key(kind, *parts):
	return CACHE_KEY_PREFIX + ":".join([kind, *(str(part or "") for part in parts)])


def item_search_key(user, query, profile, customer, price_list, limit):
	return _key("items", user, query, profile, customer, price_list, limit)


def customer_search_key(user, query, limit):
	return _key("customers", user, query, limit)


def get(key):
	return frappe.cache().get_value(key, shared=True)


def set(key, value):
	frappe.cache().set_value(key, value, expires_in_sec=CACHE_TTL_SECONDS, shared=True)


def invalidate_catalogue_cache(doc=None, method=None):
	"""Invalidate all catalogue/customer snapshots after source data changes."""
	frappe.cache().delete_keys(CACHE_KEY_PREFIX, shared=True)
