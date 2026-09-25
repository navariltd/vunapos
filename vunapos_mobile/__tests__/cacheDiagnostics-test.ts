import {
  clearCacheDiagnostics,
  getCacheDiagnostics,
  recordCacheDiagnostic,
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
});
