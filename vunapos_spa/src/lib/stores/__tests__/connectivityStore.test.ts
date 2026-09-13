import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as apiClient from "../../apiClient";
import { getConnectivityState, onConnectivityChange, useConnectivityStore } from "../connectivityStore";

beforeEach(() => {
	useConnectivityStore.setState({ state: "unknown" });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("connectivityStore", () => {
	it("checkReachability resolves to reachable when ping succeeds", async () => {
		vi.spyOn(apiClient, "pingServer").mockResolvedValue({ server_time: "2026-07-10" });

		const result = await useConnectivityStore.getState().checkReachability();

		expect(result).toBe("reachable");
		expect(getConnectivityState()).toBe("reachable");
	});

	it("checkReachability resolves to unreachable when ping fails", async () => {
		vi.spyOn(apiClient, "pingServer").mockRejectedValue(new TypeError("Failed to fetch"));

		const result = await useConnectivityStore.getState().checkReachability();

		expect(result).toBe("unreachable");
	});

	it("keeps a known connection during one transient ping failure", async () => {
		useConnectivityStore.setState({ state: "reachable", failedChecks: 0 });
		vi.spyOn(apiClient, "pingServer").mockRejectedValue(new TypeError("Request timed out"));

		const result = await useConnectivityStore.getState().checkReachability();

		expect(result).toBe("reachable");
		expect(getConnectivityState()).toBe("reachable");
	});

	it("marks a known connection unavailable after repeated ping failures", async () => {
		useConnectivityStore.setState({ state: "reachable", failedChecks: 0 });
		vi.spyOn(apiClient, "pingServer").mockRejectedValue(new TypeError("Failed to fetch"));

		await useConnectivityStore.getState().checkReachability();
		const result = await useConnectivityStore.getState().checkReachability();

		expect(result).toBe("unreachable");
	});

	it("notifies subscribers on state changes", async () => {
		vi.spyOn(apiClient, "pingServer").mockResolvedValue({ server_time: "2026-07-10" });
		const seen: string[] = [];
		const unsubscribe = onConnectivityChange((state) => seen.push(state));

		await useConnectivityStore.getState().checkReachability();
		unsubscribe();

		expect(seen).toContain("checking");
		expect(seen).toContain("reachable");
	});

	it("reportReachable marks the state reachable without a network call", () => {
		useConnectivityStore.getState().reportReachable();
		expect(getConnectivityState()).toBe("reachable");
	});

	it("onConnectivityChange's unsubscribe stops further delivery", async () => {
		vi.spyOn(apiClient, "pingServer").mockResolvedValue({ server_time: "2026-07-10" });
		const seen: string[] = [];
		const unsubscribe = onConnectivityChange((state) => seen.push(state));
		unsubscribe();

		await useConnectivityStore.getState().checkReachability();

		expect(seen).toEqual([]);
	});
});
