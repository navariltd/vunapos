import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));

jest.mock("@/features/pos/hooks/usePosBootstrap", () => ({
  usePosBootstrap: jest.fn(),
}));

const mockRegisterRealtimeRefresh = jest.fn(
  (_resource: unknown, _handler: unknown) => jest.fn(),
);
jest.mock("@/sync/realtimeInvalidation", () => ({
  registerRealtimeRefresh: (resource: unknown, handler: unknown) =>
    mockRegisterRealtimeRefresh(resource, handler),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import { usePosRealtimeCoordinator } from "@/sync/usePosRealtimeCoordinator";

const mockUseAppSession = jest.mocked(useAppSession);
const mockUsePosBootstrap = jest.mocked(usePosBootstrap);
const catalogueReload = jest.fn();

describe("usePosRealtimeCoordinator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    catalogueReload.mockResolvedValue(undefined);
    mockUseAppSession.mockReturnValue({ authState: "signedIn" } as never);
    mockUsePosBootstrap.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      reload: catalogueReload,
    });
  });

  it("registers one app-owned handler and refreshes the shared projection once", async () => {
    renderHook(() => usePosRealtimeCoordinator());

    await waitFor(() => expect(mockRegisterRealtimeRefresh).toHaveBeenCalledTimes(1));
    expect(mockRegisterRealtimeRefresh).toHaveBeenCalledWith(
      "workspace-configuration",
      expect.any(Function),
    );

    const handler = mockRegisterRealtimeRefresh.mock.calls[0][1] as (
      payload?: unknown,
    ) => Promise<void>;
    await act(async () => handler({ refresh: "full" }));

    expect(catalogueReload).toHaveBeenCalledWith({ full: true });
  });

  it("does not register a handler while signed out", () => {
    mockUseAppSession.mockReturnValue({ authState: "signedOut" } as never);

    renderHook(() => usePosRealtimeCoordinator());

    expect(mockRegisterRealtimeRefresh).not.toHaveBeenCalled();
  });
});
