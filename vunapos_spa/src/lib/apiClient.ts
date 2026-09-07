import { unwrapVunaResponse, VunaApiError } from "../services/vunaApi";
import type { BootstrapConfigPayload, BootstrapPayload } from "./types";

// The only module allowed to import fetch (dependency rule, spec §4.4). Catalogue
// bootstrap and connectivity checks run outside React's render lifecycle, so they can't use the
// useFrappeGetCall/useFrappePostCall hooks that the rest of the app calls the API with.
const API_BASE = "/api/method";

async function getJson(path: string, params: Record<string, string | undefined> = {}): Promise<unknown> {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value) {
			query.set(key, value);
		}
	}
	const url = query.toString() ? `${API_BASE}/${path}?${query.toString()}` : `${API_BASE}/${path}`;
	const response = await fetch(url, {
		method: "GET",
		headers: { Accept: "application/json" },
		credentials: "same-origin",
	});
	if (!response.ok) {
		throw new VunaApiError(`Request to ${path} failed with status ${response.status}`, "HTTP_ERROR");
	}
	return response.json();
}

export async function pingServer(): Promise<{ server_time: string }> {
	const json = await getJson("vunapos.api.pos.ping");
	return unwrapVunaResponse(json);
}

export async function fetchBootstrap(posProfile?: string, since?: string): Promise<BootstrapPayload> {
	const json = await getJson("vunapos.api.pos.get_pos_bootstrap", {
		pos_profile: posProfile,
		since,
	});
	return unwrapVunaResponse(json);
}

export async function fetchBootstrapConfig(posProfile?: string): Promise<BootstrapConfigPayload> {
	const json = await getJson("vunapos.api.pos.get_pos_bootstrap_config", {
		pos_profile: posProfile,
	});
	return unwrapVunaResponse(json);
}
