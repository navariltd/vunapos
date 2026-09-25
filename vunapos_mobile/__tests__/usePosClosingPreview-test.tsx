import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));

const mockUseNetworkStatus = jest.fn();
jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosClosingPreview } from "@/features/pos/hooks/usePosClosingPreview";
import { getVunaMethod } from "@/services/frappeClient";

const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockUseAppSession = jest.mocked(useAppSession);
const invalidateSession = jest.fn();

describe("usePosClosingPreview", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    mockUseAppSession.mockReturnValue({
      companyUrl: "https://vuna.example.com",
      invalidateSession,
      sessionId: "sid-1",
    } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => cleanup());

  it("loads the current server-authoritative closing preview and refreshes it", async () => {
    mockGetVunaMethod.mockResolvedValue({
      cashier: "cashier@example.com",
      grand_total: 580,
      invoice_count: 2,
      net_total: 500,
      opening_entry: "POS-OPEN-001",
      payments: [],
      period_end_date: "2026-09-13 10:00:00",
      period_start_date: "2026-09-13 08:00:00",
      pos_profile: "POS-001",
    });
    const hook = await renderHook(() => usePosClosingPreview("POS-001"));

    await waitFor(() =>
      expect(mockGetVunaMethod).toHaveBeenCalledWith(
        "https://vuna.example.com",
        "sid-1",
        "vunapos.api.pos_closing.get_preview",
        { pos_profile: "POS-001" },
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() =>
      expect(hook.result.current.data).toMatchObject({ grand_total: 580 }),
    );

    await act(async () => hook.result.current.reload());
    await waitFor(() => expect(mockGetVunaMethod).toHaveBeenCalledTimes(2));
  });

  it("does not request or expose a closing preview while offline", async () => {
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "offline" });
    const hook = await renderHook(() => usePosClosingPreview("POS-001"));

    expect(mockGetVunaMethod).not.toHaveBeenCalled();
    expect(hook.result.current).toMatchObject({
      data: null,
      error: null,
      isLoading: false,
    });
  });
});
