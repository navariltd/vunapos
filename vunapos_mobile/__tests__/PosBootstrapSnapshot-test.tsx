import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text } from "react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: () => ({
    companyUrl: "https://vuna.example.com",
    invalidateSession: jest.fn(),
    sessionId: "sid-1",
  }),
}));

jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => ({ connectionStatus: "online" }),
}));

jest.mock("@/components/splash/AppLaunchScreen", () => ({
  AppLaunchScreen: ({ message }: { message: string }) => {
    const { Text } = require("react-native");
    return <Text>{message}</Text>;
  },
}));

import {
  PosBootstrapState,
  usePosBootstrapConfig,
} from "@/features/pos/hooks/usePosBootstrap";
import { PosBootstrapSnapshotBoundary } from "@/sync/PosBootstrapSnapshot";

const snapshot = {
  data: {
    items: [{ item_code: "ITEM-001", item_name: "Milk" }],
    payment_modes: [],
    pos_profile: { name: "POS-001" },
  },
  error: null,
  hasHydratedCache: true,
  isHydratingCache: false,
  isInitialNetworkLoading: false,
  isLoading: false,
  isRefreshing: false,
  reload: jest.fn(),
} as PosBootstrapState;

const mounted = jest.fn();
const unmounted = jest.fn();

function WorkspaceConsumer() {
  const bootstrap = usePosBootstrapConfig();
  useEffect(() => {
    mounted();
    return () => unmounted();
  }, []);
  return <Text>{bootstrap.data?.pos_profile.name ?? "No POS profile"}</Text>;
}

describe("PosBootstrapSnapshotBoundary", () => {
  afterEach(cleanup);
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("waits for scoped cache hydration before mounting the workspace", async () => {
    const view = await render(
      <PosBootstrapSnapshotBoundary
        authState="signedIn"
        value={{ ...snapshot, data: null, hasHydratedCache: false, isHydratingCache: true }}
      >
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.getByText("Preparing your workspace…")).toBeTruthy();
    expect(screen.queryByText("No POS profile")).toBeNull();
    expect(mounted).not.toHaveBeenCalled();

    await view.rerender(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={snapshot}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    await waitFor(() => expect(screen.getByText("POS-001")).toBeTruthy());
    expect(screen.queryByText("Preparing your workspace…")).toBeNull();
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it("keeps consumers mounted and on one snapshot during background refresh", async () => {
    const view = await render(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={snapshot}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.getByText("POS-001")).toBeTruthy();
    await view.rerender(
      <PosBootstrapSnapshotBoundary
        authState="signedIn"
        value={{ ...snapshot, isRefreshing: true }}
      >
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.getByText("POS-001")).toBeTruthy();
    expect(screen.queryByText("Preparing your workspace…")).toBeNull();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("holds the old company snapshot until the new scoped snapshot is ready", async () => {
    const view = await render(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={snapshot}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    await view.rerender(
      <PosBootstrapSnapshotBoundary
        authState="signedIn"
        value={{ ...snapshot, data: null, hasHydratedCache: false, isHydratingCache: true }}
      >
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.queryByText("POS-001")).toBeNull();
    expect(screen.getByText("Preparing your workspace…")).toBeTruthy();
    await view.rerender(
      <PosBootstrapSnapshotBoundary
        authState="signedIn"
        value={{ ...snapshot, data: { ...snapshot.data!, pos_profile: { name: "POS-002" } } }}
      >
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.getByText("POS-002")).toBeTruthy();
  });

  it("blocks POS access after a failed cold or revoked-profile bootstrap", async () => {
    const signOut = jest.fn();
    await render(
      <PosBootstrapSnapshotBoundary
        authState="signedIn"
        onSignOut={signOut}
        value={{ ...snapshot, data: null, error: "Server unavailable", isLoading: false }}
      >
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.getByText("POS unavailable")).toBeTruthy();
    expect(screen.getByText("Server unavailable")).toBeTruthy();
    expect(screen.queryByText("No POS profile")).toBeNull();
    expect(screen.queryByText("Preparing your workspace…")).toBeNull();
    await act(async () => fireEvent.press(screen.getByText("Try again")));
    expect(snapshot.reload).toHaveBeenCalledWith({ full: true });
    await act(async () => fireEvent.press(screen.getByText("Sign out")));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("keeps the workspace mounted when a background refresh fails with last-good data", async () => {
    await render(
      <PosBootstrapSnapshotBoundary
        authState="signedIn"
        value={{ ...snapshot, error: "Connection interrupted", isRefreshing: false }}
      >
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    await waitFor(() => expect(screen.getByText("POS-001")).toBeTruthy());
    expect(screen.queryByText("POS unavailable")).toBeNull();
  });
});
