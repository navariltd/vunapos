jest.mock("@/services/posCache", () => ({
  posCache: { markResourceStale: jest.fn() },
}));

import { invalidateSaleCache } from "@/services/posCacheInvalidation";
import { posCache } from "@/services/posCache";

describe("invalidateSaleCache", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(posCache.markResourceStale).mockResolvedValue(undefined);
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
  });
});
