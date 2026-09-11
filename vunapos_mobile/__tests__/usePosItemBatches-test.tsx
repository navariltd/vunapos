import { cleanup, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));
jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosItemBatches } from "@/features/pos/hooks/usePosItemBatches";
import { getVunaMethod } from "@/services/frappeClient";

describe("usePosItemBatches", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(useAppSession)
      .mockReturnValue({
        companyUrl: "https://vuna.example.com",
        invalidateSession: jest.fn(),
        sessionId: "sid-1",
      } as unknown as ReturnType<typeof useAppSession>);
    jest
      .mocked(getVunaMethod)
      .mockResolvedValue({
        batches: [
          {
            available_qty: 4,
            batch_no: "BATCH-001",
            expiry_date: "2027-01-01",
            qty: 0,
          },
        ],
        item_code: "ITEM-001",
        requires_batch: true,
      });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("loads the active profile’s live batch availability only when requested", async () => {
    const hook = await renderHook(() =>
      usePosItemBatches({
        enabled: true,
        itemCode: "ITEM-001",
        posProfile: "POS-001",
      }),
    );

    await waitFor(() =>
      expect(hook.result.current.data?.batches).toHaveLength(1),
    );
    expect(getVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.batch.get_item_batches",
      { item_code: "ITEM-001", pos_profile: "POS-001" },
      expect.any(AbortSignal),
    );
  });
});
