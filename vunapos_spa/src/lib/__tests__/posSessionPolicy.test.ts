import { describe, expect, it } from "vitest";

import { evaluateCachedPosSession } from "../posSessionPolicy";
import type { CachedPosSession } from "../types";

const NOW = new Date("2026-07-20T12:00:00");

function session(overrides: Partial<CachedPosSession> = {}): CachedPosSession {
	return {
		has_opening_entry: true,
		opening_entry: "OPEN-1",
		cashier: "cashier@example.com",
		pos_profile: "Profile-1",
		ready: true,
		status: "OPEN",
		opened_at: "2026-07-20T08:00:00",
		verified_at: "2026-07-20T08:00:00",
		...overrides,
	};
}

describe("evaluateCachedPosSession", () => {
	it("accepts a verified session inside its configured lifetime", () => {
		expect(evaluateCachedPosSession(session(), "Profile-1", 12, NOW).status).toBe("valid");
	});

	it("expires a session after the configured lifetime", () => {
		expect(evaluateCachedPosSession(session(), "Profile-1", 3, NOW).status).toBe("expired");
	});

	it("rejects missing, malformed, closed, and wrong-profile cached sessions", () => {
		expect(evaluateCachedPosSession(undefined, "Profile-1", 12, NOW).status).toBe("missing");
		expect(evaluateCachedPosSession(session({ verified_at: "bad" }), "Profile-1", 12, NOW).status).toBe(
			"invalid",
		);
		expect(evaluateCachedPosSession(session({ ready: false }), "Profile-1", 12, NOW).status).toBe("invalid");
		expect(evaluateCachedPosSession(session(), "Profile-2", 12, NOW).status).toBe("profile_mismatch");
	});
});
