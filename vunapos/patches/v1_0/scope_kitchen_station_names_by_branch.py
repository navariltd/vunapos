"""Run index migration even if the Kitchen Station JSON itself did not change."""


def execute():
	from vunapos.vunapos.doctype.kitchen_station.kitchen_station import on_doctype_update

	on_doctype_update()
