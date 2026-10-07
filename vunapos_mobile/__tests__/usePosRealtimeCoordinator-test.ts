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
const mockRegisterOperationalRecovery = jest.fn((_handler: unknown) => jest.fn());
const mockClearResource = jest.fn().mockResolvedValue(undefined);
const mockRead = jest.fn().mockResolvedValue(null);
const mockInvalidateOperationalCache = jest.fn().mockResolvedValue(undefined);
const mockClearOperationalCache = jest.fn().mockResolvedValue(undefined);
jest.mock("@/sync/realtimeInvalidation", () => ({
  registerRealtimeRefresh: (resource: unknown, handler: unknown) =>
    mockRegisterRealtimeRefresh(resource, handler),
  registerRealtimeControlRefresh: (resource: unknown, handler: unknown) =>
    mockRegisterRealtimeRefresh(resource, handler),
  registerOperationalCacheRecovery: (handler: unknown) =>
    mockRegisterOperationalRecovery(handler),
}));
jest.mock("@/services/posCache", () => ({
  posCache: {
    clearResource: (...args: unknown[]) => mockClearResource(...args),
    read: (...args: unknown[]) => mockRead(...args),
  },
}));
jest.mock("@/services/posCacheInvalidation", () => ({
  invalidateOperationalPosCache: (...args: unknown[]) => mockInvalidateOperationalCache(...args),
  clearOperationalPosCache: (...args: unknown[]) => mockClearOperationalCache(...args),
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
    mockUseAppSession.mockReturnValue({
      authState: "signedIn",
      companyUrl: "https://pos.example.com",
      sessionId: "sid-1",
    } as never);
    mockUsePosBootstrap.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      reload: catalogueReload,
    });
  });

  it("registers one app-owned handler and refreshes the shared projection once", async () => {
    renderHook(() => usePosRealtimeCoordinator());

    await waitFor(() => expect(mockRegisterRealtimeRefresh).toHaveBeenCalledTimes(2));
    expect(mockRegisterRealtimeRefresh).toHaveBeenNthCalledWith(
      1,
      "referenceDataChanged",
      expect.any(Function),
    );
    expect(mockRegisterRealtimeRefresh).toHaveBeenNthCalledWith(
      2,
      "posProfileChanged",
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

  it("clears the scoped workspace before handling a profile scope change", async () => {
    mockRead.mockResolvedValueOnce({ data: { pos_profile: { name: "POS-OLD" } } });
    renderHook(() => usePosRealtimeCoordinator());
    await waitFor(() => expect(mockRegisterRealtimeRefresh).toHaveBeenCalledTimes(2));

    const profileHandler = mockRegisterRealtimeRefresh.mock.calls[1][1] as () =>
      Promise<void>;
    await act(async () => profileHandler());

    expect(mockClearOperationalCache).toHaveBeenCalledWith({
      companyUrl: "https://pos.example.com",
      sessionId: "sid-1",
      posProfile: "POS-OLD",
    });
    expect(mockClearResource).toHaveBeenCalledWith(
      {
        companyUrl: "https://pos.example.com",
        userId: "sid-1",
        posProfile: "workspace",
      },
      "workspace-configuration",
    );
    expect(catalogueReload).toHaveBeenCalledWith({ full: true });
  });

  it("registers root recovery for unmounted profile-scoped browse data", async () => {
    mockRead.mockResolvedValueOnce({ data: { pos_profile: { name: "POS-001" } } });
    renderHook(() => usePosRealtimeCoordinator());
    await waitFor(() => expect(mockRegisterOperationalRecovery).toHaveBeenCalledTimes(1));
    const recover = mockRegisterOperationalRecovery.mock.calls[0][0] as () => Promise<void>;

    await act(async () => recover());

    expect(mockInvalidateOperationalCache).toHaveBeenCalledWith({
      companyUrl: "https://pos.example.com",
      sessionId: "sid-1",
      posProfile: "POS-001",
    });
  });

  it("uses the active root snapshot when a large workspace was not persisted", async () => {
    mockRead.mockResolvedValueOnce(null);
    mockUsePosBootstrap.mockReturnValue({
      data: { pos_profile: { name: "POS-LIVE" } },
      error: null,
      isLoading: false,
      reload: catalogueReload,
    } as never);
    renderHook(() => usePosRealtimeCoordinator());
    await waitFor(() => expect(mockRegisterOperationalRecovery).toHaveBeenCalledTimes(1));
    const recover = mockRegisterOperationalRecovery.mock.calls[0][0] as () => Promise<void>;

    await act(async () => recover());

    expect(mockInvalidateOperationalCache).toHaveBeenCalledWith({
      companyUrl: "https://pos.example.com",
      sessionId: "sid-1",
      posProfile: "POS-LIVE",
    });
  });
});
