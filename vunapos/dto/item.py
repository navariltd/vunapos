def item_to_dict(
	item,
	rate=None,
	price_list_rate=None,
	actual_qty=None,
	barcode=None,
	item_tax_template=None,
	item_tax=None,
	uoms=None,
	pricing_rule=None,
):
	price_list_rate = rate if price_list_rate is None else price_list_rate
	uoms = uoms if uoms is not None else item.get("uoms", [])
	uom_rows = [{"uom": item.stock_uom, "conversion_factor": 1.0, "rate": rate}]
	seen = {item.stock_uom}
	for row in uoms or []:
		uom = row.get("uom")
		if uom and uom not in seen:
			uom_rows.append(
				{
					"uom": uom,
					"conversion_factor": float(row.get("conversion_factor") or 0),
					"rate": row.get("rate"),
				}
			)
			seen.add(uom)
	return {
		"item_code": item.item_code,
		"item_name": item.item_name,
		"item_group": item.item_group,
		"description": item.description,
		"image": item.image,
		"stock_uom": item.stock_uom,
		"uoms": uom_rows,
		"rate": rate,
		"price_list_rate": price_list_rate,
		"pricing_rule": pricing_rule,
		"actual_qty": actual_qty,
		"is_stock_item": item.is_stock_item,
		"allow_negative_stock": item.allow_negative_stock,
		"has_batch_no": item.has_batch_no,
		"has_serial_no": item.has_serial_no,
		"barcode": barcode,
		"modified": item.get("modified"),
		"item_tax_template": item_tax_template,
		"item_tax": item_tax,
	}
