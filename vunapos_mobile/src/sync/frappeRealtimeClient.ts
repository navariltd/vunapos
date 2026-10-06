import { io } from "socket.io-client";

import { invalidateRealtimeResource } from "@/sync/realtimeInvalidation";
import {
  POS_PROFILE_CHANGED_RESOURCE,
  POS_REFERENCE_DATA_RESOURCE,
} from "@/sync/posResourceKeys";

export const DOMAIN_DATA_CHANGED_EVENT = "vunapos_domain_data_changed";
export const CONFIGURATION_EVENT = DOMAIN_DATA_CHANGED_EVENT;
export const CHECKOUT_QUEUE_EVENT = "vunapos_checkout_queue_changed";
export type PosDomainResource =
  | typeof POS_REFERENCE_DATA_RESOURCE
  | typeof POS_PROFILE_CHANGED_RESOURCE;

export function parsePosDomainResource(payload: unknown): PosDomainResource {
  if (payload && typeof payload === "object") {
    const resource = (payload as { resource?: unknown }).resource;
    if (
      resource === POS_REFERENCE_DATA_RESOURCE ||
      resource === POS_PROFILE_CHANGED_RESOURCE
    ) {
      return resource;
    }
  }
  // Older servers sent doctype/action/refresh metadata. It is safe to treat
  // that signal as ordinary reference data, but it cannot prove a profile
  // scope/access change, so it must not trigger a destructive rebootstrap.
  return POS_REFERENCE_DATA_RESOURCE;
}

// `adb reverse` and Android's 10.0.2.2 alias expose the bench HTTP service to
// the emulator. The Socket.IO namespace is supplied by the backend bootstrap,
// so this client does not assume a particular developer site name.
const CONFIGURATION_DEBOUNCE_MS = 350;

type FrappeRealtimeConnection = {
  siteName: string;
  url: string;
  hostHeader?: string;
  originHeader?: string;
};

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export type RealtimeDiagnostics = {
  lastConnectedAt?: string;
  lastError?: string;
  status: ConnectionStatus;
};

type SocketLike = {
  disconnect(): unknown;
  off(event: string, listener: (payload?: unknown) => void): unknown;
  on(event: string, listener: (payload?: unknown) => void): unknown;
};

type SocketFactory = (url: string, options: Record<string, unknown>) => SocketLike;

let diagnostics: RealtimeDiagnostics = { status: "disconnected" };
const diagnosticListeners = new Set<() => void>();

function setDiagnostics(next: RealtimeDiagnostics) {
  diagnostics = next;
  for (const listener of diagnosticListeners) listener();
}

export function getRealtimeDiagnostics() {
  return diagnostics;
}

export function subscribeRealtimeDiagnostics(listener: () => void) {
  diagnosticListeners.add(listener);
  return () => diagnosticListeners.delete(listener);
}

/**
 * Deployed Frappe sites proxy Socket.IO through their normal public origin.
 * Only conventional loopback bench sites expose Socket.IO directly on :9000.
 */
export function getFrappeRealtimeConnection(
  companyUrl: string,
  siteName?: string,
): FrappeRealtimeConnection {
  const url = new URL(companyUrl);
  const isAndroidEmulatorBench =
    url.protocol === "http:" &&
    url.port === "8000" &&
    url.hostname === "10.0.2.2";
  const isLoopbackBench =
    url.protocol === "http:" &&
    url.port === "8000" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".localhost") ||
      url.hostname === "10.0.2.2");
  if (isLoopbackBench) url.port = "9000";

  const connection = {
    siteName: siteName?.trim() || url.hostname,
    // Direct bench Socket.IO uses a site namespace. Public deployments expose
    // the Socket.IO endpoint through the normal origin and reject that extra
    // hostname path as an unknown namespace.
    url: isLoopbackBench
      ? `${url.origin}/${
          siteName?.trim() || url.hostname
        }`
      : url.origin,
  };
  if (isAndroidEmulatorBench) {
    return {
      ...connection,
      // Android's 10.0.2.2 alias reaches the host machine but is not the
      // bench's virtual host. Set these headers so Frappe's Socket.IO handshake
      // reaches the backend-provided Frappe site namespace.
      hostHeader: "localhost:9000",
      originHeader: "http://localhost:8000",
    };
  }
  return connection;
}

/** One authenticated socket for the whole signed-in mobile session. */
export class FrappeRealtimeClient {
  private connectedOnce = false;
  private configurationRefreshInFlight = false;
  private configurationRefreshPayloads = new Map<PosDomainResource, unknown>();
  private configurationRefreshQueued = false;
  private configurationRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private socket: SocketLike | undefined;

  constructor(
    private readonly socketFactory: SocketFactory = (url, options) => io(url, options),
  ) {}

  start(companyUrl: string, sessionId: string, siteName?: string) {
    this.stop();
    const connection = getFrappeRealtimeConnection(companyUrl, siteName);
    setDiagnostics({ status: "connecting" });
    this.socket = this.socketFactory(connection.url, {
      autoConnect: true,
      extraHeaders: {
        Cookie: `sid=${encodeURIComponent(sessionId)}`,
        ...(connection.hostHeader ? { Host: connection.hostHeader } : {}),
        Origin: connection.originHeader ?? companyUrl,
        "X-Frappe-Site-Name": connection.siteName,
      },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 15_000,
      transports: ["websocket", "polling"],
    });
    this.socket.on("connect", this.handleConnect);
    this.socket.on("connect_error", this.handleConnectError);
    this.socket.on(CONFIGURATION_EVENT, this.handleConfigurationChange);
    this.socket.on(CHECKOUT_QUEUE_EVENT, this.handleCheckoutQueueChange);
  }

  stop() {
    if (this.configurationRefreshTimer) {
      clearTimeout(this.configurationRefreshTimer);
      this.configurationRefreshTimer = undefined;
    }
    this.configurationRefreshQueued = false;
    this.configurationRefreshPayloads.clear();
    this.configurationRefreshInFlight = false;
    if (this.socket) {
      this.socket.off("connect", this.handleConnect);
      this.socket.off("connect_error", this.handleConnectError);
      this.socket.off(CONFIGURATION_EVENT, this.handleConfigurationChange);
      this.socket.off(CHECKOUT_QUEUE_EVENT, this.handleCheckoutQueueChange);
      this.socket.disconnect();
      this.socket = undefined;
    }
    this.connectedOnce = false;
    setDiagnostics({ status: "disconnected" });
  }

  private readonly handleConnect = () => {
    const recovered = this.connectedOnce;
    this.connectedOnce = true;
    setDiagnostics({ status: "connected", lastConnectedAt: new Date().toISOString() });
    if (recovered) this.scheduleConfigurationRefresh();
  };

  private readonly handleConnectError = (error?: unknown) => {
    setDiagnostics({
      lastError: error instanceof Error ? error.message : "Realtime connection unavailable.",
      status: "error",
    });
  };

  private readonly handleConfigurationChange = (payload?: unknown) => {
    this.scheduleConfigurationRefresh(parsePosDomainResource(payload), payload);
  };

  private readonly handleCheckoutQueueChange = (payload?: unknown) => {
    void invalidateRealtimeResource("checkout-queue", payload);
  };

  private readonly scheduleConfigurationRefresh = (
    resource: PosDomainResource = POS_REFERENCE_DATA_RESOURCE,
    payload?: unknown,
  ) => {
    this.configurationRefreshPayloads.set(resource, payload);
    this.configurationRefreshQueued = true;
    if (this.configurationRefreshTimer) return;
    this.configurationRefreshTimer = setTimeout(() => {
      this.configurationRefreshTimer = undefined;
      void this.flushConfigurationRefresh();
    }, CONFIGURATION_DEBOUNCE_MS);
  };

  private readonly flushConfigurationRefresh = async () => {
    if (this.configurationRefreshInFlight) return;
    if (!this.configurationRefreshQueued) return;
    const payloads = new Map(this.configurationRefreshPayloads);
    this.configurationRefreshPayloads.clear();
    this.configurationRefreshQueued = false;
    this.configurationRefreshInFlight = true;
    try {
      // A profile-scope change is a superset of an ordinary reference refresh.
      // If both arrive in one debounce window, perform only the rebootstrap so
      // the root coordinator cannot issue two equivalent requests.
      const entries = payloads.has(POS_PROFILE_CHANGED_RESOURCE)
        ? ([
            [
              POS_PROFILE_CHANGED_RESOURCE,
              payloads.get(POS_PROFILE_CHANGED_RESOURCE),
            ],
          ] as const)
        : [...payloads.entries()];
      await Promise.all(
        entries.map(([resource, payload]) =>
          invalidateRealtimeResource(resource, payload),
        ),
      );
    } finally {
      this.configurationRefreshInFlight = false;
      // If another event arrived while the refresh was running, schedule one
      // follow-up rather than starting overlapping bootstrap requests.
      if (this.configurationRefreshQueued) {
        if (!this.configurationRefreshTimer) {
          this.configurationRefreshTimer = setTimeout(() => {
            this.configurationRefreshTimer = undefined;
            void this.flushConfigurationRefresh();
          }, CONFIGURATION_DEBOUNCE_MS);
        }
      }
    }
  };
}

export const frappeRealtimeClient = new FrappeRealtimeClient();
