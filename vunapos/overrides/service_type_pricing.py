from vunapos.services.service_type_service import apply_service_type_pricing


class VunaPOSServiceTypePricingMixin:
	"""Keep a restaurant service type's price list and taxes on its invoice."""

	def set_pos_fields(self, for_validate=False):
		pos = super().set_pos_fields(for_validate)
		if pos and self.get("vunapos_service_type"):
			apply_service_type_pricing(self, pos, for_validate)
		return pos
