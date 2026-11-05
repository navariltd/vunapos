import { describe, expect, it } from "vitest";
import { tableSelectionRequired } from "../tableContext";

describe("table-first restaurant selling", () => {
  it("keeps dine-in locked after dismissing the picker without choosing a table", () => {
    expect(tableSelectionRequired(true, null)).toBe(true);
    expect(tableSelectionRequired(true, undefined)).toBe(true);
    expect(tableSelectionRequired(true, " ")).toBe(true);
  });

  it("unlocks dine-in only after a table is selected", () => {
    expect(tableSelectionRequired(true, "Ground Floor Table 1")).toBe(false);
  });

  it("does not require a table for takeaway", () => {
    expect(tableSelectionRequired(false, null)).toBe(false);
  });

  it("relocks entry when the selected table is cleared", () => {
    expect(tableSelectionRequired(true, "Table 1")).toBe(false);
    expect(tableSelectionRequired(true, "")).toBe(true);
  });
});
