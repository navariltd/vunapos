// Capture the receipt context before Desk replaces the /new URL and consumes
// route defaults. Nothing is saved or approved by this bridge.
(() => {
	if (!/^\/desk\/quality-inspection\/new/.test(window.location.pathname)) return;
	const query = new URLSearchParams(window.location.search);
	const context = {
		pos_profile: query.get("vunapos_profile"),
		stock_entry: query.get("vunapos_source"),
		receipt: query.get("vunapos_receipt"),
		row_name: query.get("vunapos_row"),
	};
	if (Object.values(context).every(Boolean)) {
		window.vunaposReceiptInspectionContext = context;
	}
})();
