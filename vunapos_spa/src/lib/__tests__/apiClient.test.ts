import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchBootstrap, pingServer } from "../apiClient";
import { VunaApiError, unwrapVunaResponse } from "../../services/vunaApi";

describe("API response parsing", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("parses successful JSON responses", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ message: { server_time: "2026-09-18T00:00:00Z" } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		));

		expect(await pingServer()).toEqual({ server_time: "2026-09-18T00:00:00Z" });
	});

	it("reports an HTML response instead of leaking a JSON parse error", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
			new Response("<!doctype html><html><body>Login</body></html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			}),
		));

		await expect(fetchBootstrap()).rejects.toMatchObject({
			name: "VunaApiError",
			code: "INVALID_SERVER_RESPONSE",
		});
	});

	it("rejects HTML returned through a Frappe SDK call", () => {
		expect(() => unwrapVunaResponse("<html>session expired</html>")).toThrowError(
			new VunaApiError(
				"The server returned HTML instead of a JSON API response. Your session may have expired.",
				"INVALID_SERVER_RESPONSE",
			),
		);
	});
});
