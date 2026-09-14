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
  postFrappeJsonMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useOpenPosShift } from "@/features/pos/hooks/useOpenPosShift";
import { postFrappeJsonMethod } from "@/services/frappeClient";

const mockPostFrappeJsonMethod = jest.mocked(postFrappeJsonMethod);
const mockUseAppSession = jest.mocked(useAppSession);
const invalidateSession = jest.fn();

describe("useOpenPosShift", () => {
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

  it("submits every configured opening balance to the opening-entry API", async () => {
    mockPostFrappeJsonMethod.mockResolvedValue({
      name: "POS-OPEN-001",
      pos_profile: "POS-001",
      success: true,
    });
    const hook = await renderHook(() => useOpenPosShift());

    let result: Awaited<ReturnType<typeof hook.result.current.open>> = null;
    await act(async () => {
      result = await hook.result.current.open({
        openingBalances: [
          { mode_of_payment: "Cash", opening_amount: 1500 },
          { mode_of_payment: "Card", opening_amount: 0 },
        ],
        posProfile: "POS-001",
      });
    });

    expect(result).toMatchObject({ name: "POS-OPEN-001" });
    expect(mockPostFrappeJsonMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.pos_entry.create_opening_entry",
      {
        opening_balance: [
          { mode_of_payment: "Cash", opening_amount: 1500 },
          { mode_of_payment: "Card", opening_amount: 0 },
        ],
        pos_profile: "POS-001",
      },
    );
  });

  it("keeps a server validation failure visible to the opening form", async () => {
    mockPostFrappeJsonMethod.mockRejectedValue(
      new Error("Opening balances are missing for: Cash"),
    );
    const hook = await renderHook(() => useOpenPosShift());

    await act(async () => {
      await hook.result.current.open({
        openingBalances: [],
        posProfile: "POS-001",
      });
    });

    await waitFor(() =>
      expect(hook.result.current.error).toBe(
        "Opening balances are missing for: Cash",
      ),
    );
  });
});
