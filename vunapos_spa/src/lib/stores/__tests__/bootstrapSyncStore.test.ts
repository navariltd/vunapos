import { beforeEach, describe, expect, it } from "vitest";

import { useBootstrapSyncStore } from "../bootstrapSyncStore";

beforeEach(() => {
	useBootstrapSyncStore.setState({ phase: "hydrating", error: null });
});

describe("bootstrapSyncStore", () => {
	it("defaults to hydrating with no error", () => {
		expect(useBootstrapSyncStore.getState()).toMatchObject({ phase: "hydrating", error: null });
	});

	it("setPhase updates phase without touching error", () => {
		useBootstrapSyncStore.getState().setError("stale data");

		useBootstrapSyncStore.getState().setPhase("ready");

		expect(useBootstrapSyncStore.getState()).toMatchObject({ phase: "ready", error: "stale data" });
	});

	it("setError updates error without touching phase", () => {
		useBootstrapSyncStore.getState().setPhase("blocked");

		useBootstrapSyncStore.getState().setError("no cached data and unreachable");

		expect(useBootstrapSyncStore.getState()).toMatchObject({
			phase: "blocked",
			error: "no cached data and unreachable",
		});
	});

	it("setError(null) clears a previous error", () => {
		useBootstrapSyncStore.getState().setError("boom");

		useBootstrapSyncStore.getState().setError(null);

		expect(useBootstrapSyncStore.getState().error).toBeNull();
	});
});
