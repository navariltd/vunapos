import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));
jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosHeldInvoices } from "@/features/pos/hooks/usePosHeldInvoices";
import { getVunaMethod } from "@/services/frappeClient";

describe("usePosHeldInvoices", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useAppSession).mockReturnValue({
      companyUrl: "https://vuna.example.com",
      invalidateSession: jest.fn(),
      sessionId: "sid-1",
    } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("loads only the active POS profile's held drafts and supports refresh", async () => {
    jest
      .mocked(getVunaMethod)
      .mockResolvedValue([
        { doctype: "Sales Invoice", name: "SINV-HELD-001", total: 290 },
      ]);
    const hook = await renderHook(() =>
      usePosHeldInvoices({ enabled: true, posProfile: "POS-001" }),
    );

    await waitFor(() =>
      expect(hook.result.current.data).toEqual([
        { doctype: "Sales Invoice", name: "SINV-HELD-001", total: 290 },
      ]),
    );
    expect(getVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.list_held_invoices",
      { limit: 20, pos_profile: "POS-001" },
    );

    await act(async () => {
      await hook.result.current.reload();
    });
    expect(getVunaMethod).toHaveBeenCalledTimes(2);
  });
});
