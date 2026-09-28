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
  postVunaJsonMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useClosePosShift } from "@/features/pos/hooks/useClosePosShift";
import { postVunaJsonMethod } from "@/services/frappeClient";

const mockPostVunaJsonMethod = jest.mocked(postVunaJsonMethod);
const mockUseAppSession = jest.mocked(useAppSession);
const invalidateSession = jest.fn();

describe("useClosePosShift", () => {
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

  it("submits only the confirmed payment-mode balances", async () => {
    mockPostVunaJsonMethod.mockResolvedValue({
      name: "POS-CLOSE-001",
      session: {
        has_opening_entry: false,
        opening_entry: null,
        ready: false,
        status: "OPENING_REQUIRED",
      },
    });
    const hook = await renderHook(() => useClosePosShift());

    let result: Awaited<ReturnType<typeof hook.result.current.close>> = null;
    await act(async () => {
      result = await hook.result.current.close({
        closingBalances: [{ closing_amount: 80.5, mode_of_payment: "Cash" }],
        posProfile: "POS-001",
      });
    });

    expect(result).toMatchObject({ name: "POS-CLOSE-001" });
    expect(mockPostVunaJsonMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.pos_closing.close_session",
      {
        closing_balances: [{ closing_amount: 80.5, mode_of_payment: "Cash" }],
        pos_profile: "POS-001",
      },
    );
  });

  it("keeps a server failure available to the confirmation dialog", async () => {
    mockPostVunaJsonMethod.mockRejectedValue(
      new Error("Closing balances are missing for: Card"),
    );
    const hook = await renderHook(() => useClosePosShift());

    await act(async () => {
      await hook.result.current.close({
        closingBalances: [],
        posProfile: "POS-001",
      });
    });

    await waitFor(() =>
      expect(hook.result.current.error).toBe(
        "Closing balances are missing for: Card",
      ),
    );
  });

  it("does not submit a second closing while the first request is pending", async () => {
    let resolve!: (value: unknown) => void;
    mockPostVunaJsonMethod.mockReturnValueOnce(
      new Promise((nextResolve) => {
        resolve = nextResolve;
      }),
    );
    const hook = await renderHook(() => useClosePosShift());
    const input = {
      closingBalances: [{ closing_amount: 0, mode_of_payment: "Cash" }],
      posProfile: "POS-001",
    };

    let first!: Promise<unknown>;
    await act(async () => {
      first = hook.result.current.close(input);
      await hook.result.current.close(input);
    });
    expect(mockPostVunaJsonMethod).toHaveBeenCalledTimes(1);
    resolve({ name: "POS-CLOSE-001", session: null });
    await act(async () => {
      await first;
    });
  });
});
