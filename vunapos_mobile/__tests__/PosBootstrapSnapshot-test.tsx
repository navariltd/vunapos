import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { useEffect, useState } from "react";
import { Text, TextInput } from "react-native";

const mockUseAppSession = jest.fn(() => ({
  companyUrl: "https://vuna.example.com",
  sessionId: "sid-1",
}));

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: () => mockUseAppSession(),
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
  const [note, setNote] = useState("");
  useEffect(() => {
    mounted();
    return () => unmounted();
  }, []);
  return <>
    <Text>{bootstrap.data?.pos_profile.name ?? "No POS profile"}</Text>
    <Text>{bootstrap.isLoading ? "Cold-start loading" : "Workspace usable"}</Text>
    <TextInput accessibilityLabel="Draft checkout note" onChangeText={setNote} value={note} />
  </>;
}

describe("PosBootstrapSnapshotBoundary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({
      companyUrl: "https://vuna.example.com",
      sessionId: "sid-1",
    });
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

  it("does not reuse a previous user's snapshot after session scope changes", async () => {
    const view = await render(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={snapshot}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    mockUseAppSession.mockReturnValue({
      companyUrl: "https://vuna.example.com",
      sessionId: "sid-2",
    });
    await view.rerender(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={{
        ...snapshot, data: null, isHydratingCache: true,
      }}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.queryByText("POS-001")).toBeNull();
    expect(screen.getByText("Preparing your workspace…")).toBeTruthy();
  });

  it("removes the previous POS snapshot from context after sign-out", async () => {
    const view = await render(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={snapshot}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    await view.rerender(
      <PosBootstrapSnapshotBoundary authState="signedOut" value={snapshot}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.queryByText("POS-001")).toBeNull();
    expect(screen.getByText("No POS profile")).toBeTruthy();
  });

  it("holds the old company snapshot until the new scoped snapshot is ready", async () => {
    const view = await render(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={snapshot}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    mockUseAppSession.mockReturnValue({
      companyUrl: "https://other.example.com",
      sessionId: "sid-2",
    });
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
    await waitFor(() => expect(screen.getByText("POS-002")).toBeTruthy());
  });

  it("keeps the same-scope route and form mounted through an unexpected background null", async () => {
    const view = await render(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={snapshot}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    await fireEvent.changeText(screen.getByLabelText("Draft checkout note"), "Do not lose this");
    await view.rerender(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={{
        ...snapshot, data: null, isLoading: true, isHydratingCache: true,
      }}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.getByText("POS-001")).toBeTruthy();
    expect(screen.getByText("Workspace usable")).toBeTruthy();
    expect(screen.queryByText("Cold-start loading")).toBeNull();
    expect(screen.getByLabelText("Draft checkout note").props.value).toBe("Do not lose this");
    expect(screen.queryByText("Preparing your workspace…")).toBeNull();
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(unmounted).not.toHaveBeenCalled();
    await view.rerender(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={{
        ...snapshot, data: null, error: "Storage read interrupted",
      }}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.getByLabelText("Draft checkout note").props.value).toBe("Do not lose this");
    expect(screen.queryByText("POS unavailable")).toBeNull();
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("blocks profile-scope revalidation without unmounting the route", async () => {
    const view = await render(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={snapshot}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    await fireEvent.changeText(screen.getByLabelText("Draft checkout note"), "Keep this draft");
    await view.rerender(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={{
        ...snapshot, data: null, isScopeInvalidated: true, isLoading: true,
      }}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.getByText("Checking POS access…")).toBeTruthy();
    expect(screen.queryByText("Preparing your workspace…")).toBeNull();
    expect(unmounted).not.toHaveBeenCalled();
    await view.rerender(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={{
        ...snapshot, data: { ...snapshot.data!, pos_profile: { name: "POS-002" } },
        isScopeInvalidated: true,
      }}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.getByText("POS-001")).toBeTruthy();
    expect(screen.getByText("Checking POS access…")).toBeTruthy();
    await view.rerender(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={{
        ...snapshot, data: { ...snapshot.data!, pos_profile: { name: "POS-002" } },
      }}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.getByText("POS Profile changed")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText("Open new POS Profile")));
    await waitFor(() => expect(screen.getByText("POS-002")).toBeTruthy());
    expect(screen.getByLabelText("Draft checkout note").props.value).toBe("Keep this draft");
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("requires an explicit handoff before exposing a different authorized POS Profile", async () => {
    const view = await render(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={snapshot}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    await fireEvent.changeText(screen.getByLabelText("Draft checkout note"), "Old profile draft");
    const next = {
      ...snapshot,
      data: { ...snapshot.data!, pos_profile: { name: "POS-002" } },
    } as PosBootstrapState;
    await view.rerender(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={next}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.getByText("POS Profile changed")).toBeTruthy();
    expect(screen.getByText("POS-001")).toBeTruthy();
    expect(screen.queryByText("POS-002")).toBeNull();
    expect(screen.getByLabelText("Draft checkout note").props.value).toBe("Old profile draft");
    expect(unmounted).not.toHaveBeenCalled();

    await act(async () => fireEvent.press(screen.getByText("Open new POS Profile")));
    expect(screen.queryByText("POS Profile changed")).toBeNull();
    expect(screen.getByText("POS-002")).toBeTruthy();
  });

  it("keeps a revoked-profile failure blocked and actionable without discarding the draft", async () => {
    const view = await render(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={snapshot}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    await fireEvent.changeText(screen.getByLabelText("Draft checkout note"), "Unsubmitted work");
    await view.rerender(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={{
        ...snapshot, data: null, error: "Profile access changed", isScopeInvalidated: true,
      }}>
        <WorkspaceConsumer />
      </PosBootstrapSnapshotBoundary>,
    );
    expect(screen.getByText("POS unavailable")).toBeTruthy();
    expect(screen.getByText("Profile access changed")).toBeTruthy();
    expect(unmounted).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(screen.getByText("Try again")));
    expect(snapshot.reload).toHaveBeenCalledWith({ full: true });
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
