import {
  clearCacheDiagnostics,
  getCacheDiagnostics,
  recordCacheDiagnostic,
  summarizeCacheDiagnostics,
} from "@/services/cacheDiagnostics";

describe("cache diagnostics", () => {
  beforeEach(() => clearCacheDiagnostics());

  it("retains only safe cache metadata and does not expose keys or payloads", () => {
    recordCacheDiagnostic({
      operation: "read",
      outcome: "hit",
      resource: "catalogue",
      source: "sqlite",
    });

    expect(getCacheDiagnostics()).toEqual([
      {
        operation: "read",
        outcome: "hit",
        resource: "catalogue",
        source: "sqlite",
      },
    ]);
    expect(JSON.stringify(getCacheDiagnostics())).not.toContain("customer@example.com");
  });

  it("keeps diagnostics bounded and supports clearing", () => {
    for (let index = 0; index < 105; index += 1) {
      recordCacheDiagnostic({
        operation: "read",
        outcome: "miss",
        resource: `resource-${index}`,
      });
    }

    expect(getCacheDiagnostics()).toHaveLength(100);
    expect(getCacheDiagnostics()[0]?.resource).toBe("resource-5");

    clearCacheDiagnostics();
    expect(getCacheDiagnostics()).toEqual([]);
  });

  it("summarizes request count, hit rate, refresh duration, and rows written", () => {
    recordCacheDiagnostic({
      operation: "read",
      outcome: "hit",
      resource: "workspace-configuration",
    });
    recordCacheDiagnostic({
      operation: "read",
      outcome: "miss",
      resource: "invoice-history",
    });
    recordCacheDiagnostic({
      durationMs: 10,
      operation: "fetch",
      outcome: "success",
      resource: "workspace-configuration",
      rowsWritten: 500,
    });
    recordCacheDiagnostic({
      durationMs: 30,
      operation: "fetch",
      outcome: "error",
      resource: "invoice-history",
      rowsWritten: 0,
    });
    recordCacheDiagnostic({
      operation: "fetch",
      outcome: "deduplicated",
      resource: "workspace-configuration",
    });

    expect(summarizeCacheDiagnostics()).toEqual({
      averageFetchDurationMs: 20,
      cacheHitRate: 0.5,
      cacheHits: 1,
      cacheMisses: 1,
      requestCount: 2,
      rowsWritten: 500,
    });
  });
});
