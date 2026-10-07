jest.mock("@/services/posCache", () => ({
  posCache: {
    clearResource: jest.fn(),
    markResourceStale: jest.fn(),
    read: jest.fn(),
    write: jest.fn(),
  },
}));

import {
  clearOperationalPosCache,
  invalidateCustomerDirectoryCache,
  invalidateCustomerPaymentCache,
  invalidateHeldInvoiceCache,
  invalidateOperationalPosCache,
  invalidateReturnCache,
  invalidateSaleCache,
  patchCachedCatalogueItems,
} from "@/services/posCacheInvalidation";
import { posCache } from "@/services/posCache";

describe("invalidateSaleCache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(posCache.clearResource).mockResolvedValue(undefined);
    jest.mocked(posCache.markResourceStale).mockResolvedValue(undefined);
    jest.mocked(posCache.write).mockResolvedValue(undefined);
  });

  it("patches only affected cached catalogue rows with authoritative stock", async () => {
    jest.mocked(posCache.read).mockResolvedValue({
      data: {
        items: [
          { item_code: "ITEM-001", item_name: "One", actual_qty: 10, rate: 5 },
          { item_code: "ITEM-002", item_name: "Two", actual_qty: 8, rate: 7 },
        ],
        payment_modes: [],
        pos_profile: { name: "POS-001" },
      },
      expiresAt: Date.now() + 60_000,
      fetchedAt: Date.now(),
      isStale: false,
    });

    await patchCachedCatalogueItems({
      companyUrl: "https://vuna.example.com",
      sessionId: "sid-1",
      patches: [{ item_code: "ITEM-001", actual_qty: 4, rate: 6 }],
    });

    expect(posCache.write).toHaveBeenCalledWith(
      {
        resource: "workspace-configuration",
        scope: {
          companyUrl: "https://vuna.example.com",
          posProfile: "workspace",
          userId: "sid-1",
        },
      },
      expect.objectContaining({
        items: [
          { item_code: "ITEM-001", item_name: "One", actual_qty: 4, rate: 6 },
          { item_code: "ITEM-002", item_name: "Two", actual_qty: 8, rate: 7 },
        ],
      }),
      expect.any(Number),
    );
  });

  it("marks only the signed-in profile's changed sale resources stale", async () => {
    await invalidateSaleCache({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      sessionId: "sid-1",
    });

    const scope = {
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      userId: "sid-1",
    };
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "catalogue");
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "invoice-history");
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "payment-history");
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "customer-details");
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "customer-directory");
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "customer-search");
    expect(posCache.markResourceStale).toHaveBeenCalledWith(
      { ...scope, posProfile: "workspace" },
      "workspace-configuration",
    );
    expect(posCache.markResourceStale).not.toHaveBeenCalledWith(
      scope,
      "held-invoices",
    );
    expect(posCache.markResourceStale).toHaveBeenCalledTimes(7);
  });

  it("marks every operational resource stale for reconnect, including unmounted views", async () => {
    await invalidateOperationalPosCache({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      sessionId: "sid-1",
    });
    const scope = {
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      userId: "sid-1",
    };
    for (const resource of [
      "catalogue", "customer-details", "customer-directory", "customer-search",
      "invoice-history", "payment-history", "held-invoices",
    ]) {
      expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, resource);
    }
    expect(posCache.markResourceStale).toHaveBeenCalledTimes(7);
    expect(posCache.markResourceStale).not.toHaveBeenCalledWith(
      { ...scope, posProfile: "workspace" }, "workspace-configuration",
    );
  });

  it("clears old profile browse rows without deleting the active cart", async () => {
    await clearOperationalPosCache({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-OLD",
      sessionId: "sid-1",
    });
    const scope = {
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-OLD",
      userId: "sid-1",
    };
    expect(posCache.clearResource).toHaveBeenCalledTimes(7);
    expect(posCache.clearResource).toHaveBeenCalledWith(scope, "invoice-history");
    expect(posCache.clearResource).not.toHaveBeenCalledWith(scope, "active-cart");
  });

  it("also marks held drafts stale when their checkout completes", async () => {
    await invalidateSaleCache({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      sessionId: "sid-1",
      sourceInvoice: { doctype: "Sales Invoice", name: "SINV-HELD-001" },
    });

    expect(posCache.markResourceStale).toHaveBeenCalledWith(
      {
        companyUrl: "https://vuna.example.com",
        posProfile: "POS-001",
        userId: "sid-1",
      },
      "held-invoices",
    );
    expect(posCache.markResourceStale).toHaveBeenCalledTimes(8);
  });

  it("marks return-affected records stale without changing payment history", async () => {
    await invalidateReturnCache({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      sessionId: "sid-1",
    });

    const scope = {
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      userId: "sid-1",
    };
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "catalogue");
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "invoice-history");
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "customer-details");
    expect(posCache.markResourceStale).not.toHaveBeenCalledWith(
      scope,
      "payment-history",
    );
    expect(posCache.markResourceStale).toHaveBeenCalledTimes(6);
  });

  it("marks held drafts and sales history stale when draft visibility changes", async () => {
    await invalidateHeldInvoiceCache({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      sessionId: "sid-1",
    });

    const scope = {
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      userId: "sid-1",
    };
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "held-invoices");
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "invoice-history");
    expect(posCache.markResourceStale).toHaveBeenCalledTimes(2);
  });

  it("marks payment and balance views stale after a received or reconciled payment", async () => {
    await invalidateCustomerPaymentCache({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      sessionId: "sid-1",
    });

    const scope = {
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      userId: "sid-1",
    };
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "payment-history");
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "invoice-history");
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "customer-details");
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "customer-directory");
    expect(posCache.markResourceStale).toHaveBeenCalledTimes(4);
  });

  it("marks customer browse data stale after a customer write", async () => {
    await invalidateCustomerDirectoryCache({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      sessionId: "sid-1",
    });

    const scope = {
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      userId: "sid-1",
    };
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "customer-details");
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "customer-directory");
    expect(posCache.markResourceStale).toHaveBeenCalledWith(scope, "customer-search");
    expect(posCache.markResourceStale).toHaveBeenCalledTimes(3);
  });
});
