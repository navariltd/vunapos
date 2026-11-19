// Mirrors vunapos/services/phone_search.py: 0790 001 011, 790001011, +254790001011
// and +254-790001011 all reduce to the national digits 790001011.
const PHONE_QUERY = /^[\d\s+\-().]+$/;

/** A phone number's digits without its trunk 0 or this country's dialling code; null if it isn't one. */
export function nationalDigits(value: string, isd = ""): string | null {
	const text = value.trim();
	if (!PHONE_QUERY.test(text)) return null;
	let digits = text.replace(/\D/g, "");
	let international = text.startsWith("+") || digits.startsWith("00");
	if (digits.startsWith("00")) digits = digits.slice(2);
	// Without a + the dialling code only counts when a full number follows it.
	if (isd && digits.startsWith(isd) && (international || digits.length > isd.length + 6)) {
		digits = digits.slice(isd.length);
		international = false;
	}
	if (!international && digits.startsWith("0")) digits = digits.slice(1);
	return digits.length >= 3 ? digits : null;
}
