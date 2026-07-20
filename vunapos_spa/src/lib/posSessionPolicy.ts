import type { CachedPosSession } from "./types";

export type CachedSessionPolicy =
	| { status: "valid"; expiresAt: Date; session: CachedPosSession }
	| { status: "missing" | "invalid" | "expired" | "profile_mismatch"; session?: CachedPosSession };

function parseServerDate(value: string | null | undefined): Date | null {
	if (!value) {
		return null;
	}
	const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T"));
	return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function evaluateCachedPosSession(
	session: CachedPosSession | undefined,
	posProfile: string,
	ttlHours: number | undefined,
	now = new Date(),
): CachedSessionPolicy {
	if (!session) {
		return { status: "missing" };
	}
	if (session.pos_profile !== posProfile) {
		return { status: "profile_mismatch", session };
	}
	if (!session.ready || !session.opening_entry) {
		return { status: "invalid", session };
	}
	const openedAt = parseServerDate(session.opened_at);
	const verifiedAt = parseServerDate(session.verified_at);
	if (!openedAt || !verifiedAt || !Number.isFinite(ttlHours) || !ttlHours || ttlHours <= 0) {
		return { status: "invalid", session };
	}
	const expiresAt = new Date(openedAt.getTime() + ttlHours * 60 * 60 * 1000);
	if (now.getTime() > expiresAt.getTime()) {
		return { status: "expired", session };
	}
	return { status: "valid", session, expiresAt };
}
