import { unwrapVunaResponse, VunaApiError } from "../services/vunaApi";
import type { BootstrapConfigPayload, BootstrapPayload } from "./types";

// The only module allowed to import fetch (dependency rule, spec §4.4). Catalogue
// bootstrap and connectivity checks run outside React's render lifecycle, so they can't use the
// useFrappeGetCall/useFrappePostCall hooks that the rest of the app calls the API with.
const API_BASE = "/api/method";

export async function getKitchenSigningCertificate(posProfile: string) {
  return (await getJson("vunapos.api.kitchen_printing.signing_certificate", {
    pos_profile: posProfile,
  })) as {
    message: { enabled: boolean; certificate: string | null };
  };
}

export async function signKitchenRequest(
  message: string,
  posProfile: string
): Promise<string> {
  const response = await fetch(
    `${API_BASE}/vunapos.api.kitchen_printing.sign_request`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Frappe-CSRF-Token": window.csrf_token || "",
      },
      body: JSON.stringify({ message, pos_profile: posProfile }),
    }
  );
  if (!response.ok)
    throw new Error(
      "QZ signing was rejected. Check printing access, the terminal clock and the site's signing configuration."
    );
  const body = await response.json();
  if (typeof body.message !== "string" || !body.message)
    throw new Error("The server returned an invalid printing signature.");
  return body.message;
}

async function getJson(
  path: string,
  params: Record<string, string | undefined> = {}
): Promise<unknown> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }
  const url = query.toString()
    ? `${API_BASE}/${path}?${query.toString()}`
    : `${API_BASE}/${path}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!response.ok) {
    const code =
      response.status === 401
        ? "HTTP_401"
        : response.status === 403
        ? "HTTP_403"
        : "HTTP_ERROR";
    throw new VunaApiError(
      `Request to ${path} failed with status ${response.status}`,
      code
    );
  }
  const body = await response.text();
  if (!body.trim()) {
    throw new VunaApiError(
      `Request to ${path} returned an empty response`,
      "INVALID_SERVER_RESPONSE"
    );
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new VunaApiError(
      `Request to ${path} returned a non-JSON response`,
      "INVALID_SERVER_RESPONSE"
    );
  }
}

export async function pingServer(): Promise<{ server_time: string }> {
  const json = await getJson("vunapos.api.pos.ping");
  return unwrapVunaResponse(json);
}

export async function fetchBootstrap(
  posProfile?: string,
  since?: string
): Promise<BootstrapPayload> {
  const json = await getJson("vunapos.api.pos.get_pos_bootstrap", {
    pos_profile: posProfile,
    since,
  });
  return unwrapVunaResponse(json);
}

export async function fetchBootstrapConfig(
  posProfile?: string
): Promise<BootstrapConfigPayload> {
  const json = await getJson("vunapos.api.pos.get_pos_bootstrap_config", {
    pos_profile: posProfile,
  });
  return unwrapVunaResponse(json);
}
