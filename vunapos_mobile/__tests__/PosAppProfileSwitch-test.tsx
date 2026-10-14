import { act, fireEvent, render, screen } from "@testing-library/react-native";

const mockSession = jest.fn(() => ({
  authState: "signedIn",
  companyUrl: "https://vuna.example.com",
  sessionId: "sid-1",
}));
const mockUnmount = jest.fn();
const mockClearResource = jest.fn().mockResolvedValue(undefined);

jest.mock("expo-router", () => ({ Redirect: () => null }));
jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: () => mockSession(),
}));
jest.mock("@/services/posCache", () => ({
  posCache: { clearResource: (...args: unknown[]) => mockClearResource(...args) },
}));
jest.mock("@/features/pos/screens/PosWorkspaceScreen", () => ({
  PosWorkspaceScreen: () => {
    const { useEffect, useState } = require("react");
    const { Text, TextInput } = require("react-native");
    const { useRootPosBootstrapSnapshot } = require("@/sync/PosBootstrapSnapshot");
    const snapshot = useRootPosBootstrapSnapshot();
    const [note, setNote] = useState("");
    useEffect(() => () => mockUnmount(), []);
    return <>
      <Text>Operational workspace</Text>
      <Text>{snapshot?.data?.pos_profile?.company}</Text>
      <TextInput accessibilityLabel="Local checkout note" onChangeText={setNote} value={note} />
    </>;
  },
}));

import AppIndex from "@/app/(app)/index";
import type { PosBootstrapState } from "@/features/pos/hooks/usePosBootstrap";
import { PosBootstrapSnapshotBoundary } from "@/sync/PosBootstrapSnapshot";

const profileSnapshot = (name: string, company?: string, warehouse?: string) => ({
  data: { payment_modes: [], pos_profile: { company, name, warehouse } },
  error: null,
  isLoading: false,
  reload: jest.fn(),
} as PosBootstrapState);

beforeEach(() => {
  mockUnmount.mockClear();
  mockClearResource.mockReset().mockResolvedValue(undefined);
});

it("keeps the old workspace blocked until handoff, then mounts fresh state for the new profile", async () => {
  const first = profileSnapshot("POS-OLD");
  const view = await render(
    <PosBootstrapSnapshotBoundary authState="signedIn" value={first}>
      <AppIndex />
    </PosBootstrapSnapshotBoundary>,
  );
  await fireEvent.changeText(screen.getByLabelText("Local checkout note"), "Old profile work");
  const next = profileSnapshot("POS-NEW");
  await view.rerender(
    <PosBootstrapSnapshotBoundary authState="signedIn" value={next}>
      <AppIndex />
    </PosBootstrapSnapshotBoundary>,
  );
  expect(screen.getByText("POS Profile changed")).toBeTruthy();
  expect(screen.getByLabelText("Local checkout note").props.value).toBe("Old profile work");
  expect(mockUnmount).not.toHaveBeenCalled();

  await act(async () => fireEvent.press(screen.getByText("Open new POS Profile")));
  expect(screen.queryByText("POS Profile changed")).toBeNull();
  expect(screen.getByLabelText("Local checkout note").props.value).toBe("");
  expect(mockUnmount).toHaveBeenCalledTimes(1);
});

it("does not remount the active workspace for repeated same-profile refreshes", async () => {
  const view = await render(
    <PosBootstrapSnapshotBoundary authState="signedIn" value={profileSnapshot("POS-001")}>
      <AppIndex />
    </PosBootstrapSnapshotBoundary>,
  );
  await fireEvent.changeText(screen.getByLabelText("Local checkout note"), "Keep the form");
  for (let index = 0; index < 3; index += 1) {
    await view.rerender(
      <PosBootstrapSnapshotBoundary authState="signedIn" value={profileSnapshot("POS-001")}>
        <AppIndex />
      </PosBootstrapSnapshotBoundary>,
    );
  }
  expect(screen.getByLabelText("Local checkout note").props.value).toBe("Keep the form");
  expect(mockUnmount).not.toHaveBeenCalled();
  expect(screen.queryByText("POS Profile changed")).toBeNull();
});

it("blocks a same-name company or warehouse switch without depending on cart deletion", async () => {
  const first = profileSnapshot("POS-001", "Company A", "Warehouse A");
  const view = await render(
    <PosBootstrapSnapshotBoundary authState="signedIn" value={first}>
      <AppIndex />
    </PosBootstrapSnapshotBoundary>,
  );
  await fireEvent.changeText(screen.getByLabelText("Local checkout note"), "Old warehouse work");
  const next = profileSnapshot("POS-001", "Company B", "Warehouse B");
  await view.rerender(
    <PosBootstrapSnapshotBoundary authState="signedIn" value={next}>
      <AppIndex />
    </PosBootstrapSnapshotBoundary>,
  );

  expect(screen.getByText("POS company or warehouse changed")).toBeTruthy();
  expect(screen.getByLabelText("Local checkout note").props.value).toBe("Old warehouse work");
  expect(mockUnmount).not.toHaveBeenCalled();
  expect(mockClearResource).not.toHaveBeenCalled();

  await act(async () => fireEvent.press(screen.getByText("Open new POS scope")));
  expect(mockClearResource).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Local checkout note").props.value).toBe("");
  expect(mockUnmount).toHaveBeenCalledTimes(1);
});

it("cannot install an older profile after a newer handoff completes", async () => {
  let finishOldClear: (() => void) | undefined;
  mockClearResource.mockImplementationOnce(() => new Promise<void>((resolve) => {
    finishOldClear = resolve;
  }));
  const view = await render(
    <PosBootstrapSnapshotBoundary authState="signedIn" value={profileSnapshot("POS-001", "A", "A")}>
      <AppIndex />
    </PosBootstrapSnapshotBoundary>,
  );

  await view.rerender(
    <PosBootstrapSnapshotBoundary authState="signedIn" value={profileSnapshot("POS-001", "B", "B")}>
      <AppIndex />
    </PosBootstrapSnapshotBoundary>,
  );
  await act(async () => fireEvent.press(screen.getByText("Open new POS scope")));
  await view.rerender(
    <PosBootstrapSnapshotBoundary authState="signedIn" value={profileSnapshot("POS-001", "C", "C")}>
      <AppIndex />
    </PosBootstrapSnapshotBoundary>,
  );
  await act(async () => fireEvent.press(screen.getByText("Open new POS scope")));
  await act(async () => finishOldClear?.());

  expect(mockClearResource).not.toHaveBeenCalled();
  expect(screen.getByText("C")).toBeTruthy();
  expect(screen.queryByText("POS company or warehouse changed")).toBeNull();
  expect(mockUnmount).toHaveBeenCalledTimes(2);
});
