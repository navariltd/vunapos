import { cleanup, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));

jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosTemplateVariants } from "@/features/pos/hooks/usePosTemplateVariants";
import { getVunaMethod } from "@/services/frappeClient";

const mockUseAppSession = jest.mocked(useAppSession);
const mockGetVunaMethod = jest.mocked(getVunaMethod);

describe("usePosTemplateVariants", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({
      companyUrl: "https://vuna.example.com",
      invalidateSession: jest.fn(),
      sessionId: "sid-1",
    } as unknown as ReturnType<typeof useAppSession>);
    mockGetVunaMethod.mockResolvedValue({
      template: { item_code: "SHIRT", item_name: "Vuna shirt" },
      variants: [
        {
          actual_qty: 2,
          item_code: "SHIRT-BLUE-M",
          item_name: "Vuna shirt · Blue · M",
          rate: 1200,
        },
      ],
    });
  });

  afterEach(async () => cleanup());

  it("requests concrete variants with the active POS pricing context", async () => {
    const hook = await renderHook(() =>
      usePosTemplateVariants({
        customer: "CUST-001",
        enabled: true,
        posProfile: "POS-001",
        priceList: "Retail",
        templateItemCode: "SHIRT",
      }),
    );

    await waitFor(() =>
      expect(hook.result.current.data?.variants).toHaveLength(1),
    );
    expect(mockGetVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.item.get_template_variants",
      {
        customer: "CUST-001",
        pos_profile: "POS-001",
        price_list: "Retail",
        template_item_code: "SHIRT",
      },
      expect.any(AbortSignal),
    );
  });
});
