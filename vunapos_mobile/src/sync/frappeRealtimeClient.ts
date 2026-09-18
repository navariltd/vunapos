import { io } from "socket.io-client";

import { invalidateRealtimeResource } from "@/sync/realtimeInvalidation";

export const CONFIGURATION_EVENT = "vunapos_configuration_changed";

// `adb reverse` exposes the bench to an Android emulator as localhost. The
// physical Frappe site remains meru.localhost, which is also the namespace
// used when Frappe publishes realtime events. Keep this development bridge
// narrow; deployed sites use their own public hostname as the site name.
const LOCAL_BENCH_SITE_NAME = "meru.localhost";

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
export function getFrappeRealtimeConnection(companyUrl: string) {
  const url = new URL(companyUrl);
  const isAdbReversedBench =
    url.protocol === "http:" &&
    url.port === "8000" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  const isLoopbackBench =
    url.protocol === "http:" &&
    url.port === "8000" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".localhost"));
  if (isLoopbackBench) url.port = "9000";

  return {
    siteName: isAdbReversedBench ? LOCAL_BENCH_SITE_NAME : url.hostname,
    url: `${url.origin}/${
      isAdbReversedBench ? LOCAL_BENCH_SITE_NAME : url.hostname
    }`,
  };
}

/** One authenticated socket for the whole signed-in mobile session. */
export class FrappeRealtimeClient {
  private connectedOnce = false;
  private socket: SocketLike | undefined;

  constructor(
    private readonly socketFactory: SocketFactory = (url, options) => io(url, options),
  ) {}

  start(companyUrl: string, sessionId: string) {
    this.stop();
    const connection = getFrappeRealtimeConnection(companyUrl);
    setDiagnostics({ status: "connecting" });
    this.socket = this.socketFactory(connection.url, {
      autoConnect: true,
      extraHeaders: {
        Cookie: `sid=${encodeURIComponent(sessionId)}`,
        Origin: companyUrl,
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
  }

  stop() {
    if (this.socket) {
      this.socket.off("connect", this.handleConnect);
      this.socket.off("connect_error", this.handleConnectError);
      this.socket.off(CONFIGURATION_EVENT, this.handleConfigurationChange);
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
    if (recovered) invalidateRealtimeResource("workspace-configuration");
  };

  private readonly handleConnectError = (error?: unknown) => {
    setDiagnostics({
      lastError: error instanceof Error ? error.message : "Realtime connection unavailable.",
      status: "error",
    });
  };

  private readonly handleConfigurationChange = () => {
    invalidateRealtimeResource("workspace-configuration");
  };
}

export const frappeRealtimeClient = new FrappeRealtimeClient();
