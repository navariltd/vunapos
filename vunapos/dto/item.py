def item_to_dict(item, rate=None, actual_qty=None, barcode=None):
	return {
		"item_code": item.item_code,
		"item_name": item.item_name,
		"description": item.description,
		"image": item.image,
		"stock_uom": item.stock_uom,
		"rate": rate,
		"actual_qty": actual_qty,
		"is_stock_item": item.is_stock_item,
		"allow_negative_stock": item.allow_negative_stock,
		"barcode": barcode,
	}
