// Client-generated ids for order lines and idempotency keys. crypto.randomUUID only
// exists in secure contexts (HTTPS or localhost); getRandomValues also works on
// plain-http sites such as a local bench.
export function newId(
	fillRandom: (bytes: Uint8Array<ArrayBuffer>) => void = (bytes) => {
		crypto.getRandomValues(bytes);
	},
): string {
	const bytes = new Uint8Array(16);
	fillRandom(bytes);
	// RFC 4122 version 4 layout.
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
