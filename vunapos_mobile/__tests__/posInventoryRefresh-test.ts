jest.mock("@/services/frappeClient", () => ({
  getVunaMethod: jest.fn(),
}));

const mockPatch = jest.fn();
jest.mock("@/services/posCacheInvalidation", () => ({
  patchCachedCatalogueItems: (...args: unknown[]) => mockPatch(...args),
}));

import { getVunaMethod } from "@/services/frappeClient";
import { refreshSoldItemStock } from "@/services/posInventoryRefresh";

const mockGet = jest.mocked(getVunaMethod);
const cartItem = (item_code: string, qty: number) =>
  ({
    allow_negative_stock: false,
    available_qty: 10,
    is_stock_item: true,
    item_code,
    item_name: item_code,
    qty,
    rate: 12,
  }) as never;

describe("refreshSoldItemStock", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPatch.mockResolvedValue(undefined);
  });

  it("deduplicates item codes and patches only the affected catalogue rows", async () => {
    mockGet.mockResolvedValue({
      actual_qty: 7,
      price_list_rate: 12,
      rate: 12,
    });

    await refreshSoldItemStock({
      companyUrl: "https://vuna.example.com",
      customer: "CUST-1",
      items: [
        cartItem("ITEM-A", 1),
        cartItem("ITEM-A", 2),
      ],
      posProfile: "POS-1",
      priceList: "Standard Selling",
      sessionId: "sid-1",
    });

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.item.get_item_details",
      {
        customer: "CUST-1",
        item_code: "ITEM-A",
        pos_profile: "POS-1",
        price_list: "Standard Selling",
      },
    );
    expect(mockPatch).toHaveBeenCalledWith({
      companyUrl: "https://vuna.example.com",
      sessionId: "sid-1",
      patches: [
        {
          actual_qty: 7,
          item_code: "ITEM-A",
          price_list_rate: 12,
          rate: 12,
        },
      ],
    });
  });

  it("keeps a committed sale successful when one item refresh fails", async () => {
    mockGet.mockRejectedValue(new Error("temporary outage"));

    await expect(
      refreshSoldItemStock({
        companyUrl: "https://vuna.example.com",
        items: [cartItem("ITEM-A", 1)],
        posProfile: "POS-1",
        sessionId: "sid-1",
      }),
    ).resolves.toBeUndefined();

    expect(mockPatch).not.toHaveBeenCalled();
  });
});
