import { describe, it, expect } from "vitest";
import { kitchenElapsedMinutes } from "../kitchenStatus";
describe("kitchen timestamps", () => {
  it("compares the same instant across Kolkata and Nairobi offsets", () => {
    expect(kitchenElapsedMinutes({sent_at: "2026-11-21T03:26:00+05:30"}, Date.parse("2026-11-21T01:10:00+03:00"))).toBe(14);
  });
  it("uses the server clock even when a terminal is hours fast", () => {
    expect(kitchenElapsedMinutes({sent_at: "2026-11-21T03:26:00+05:30", server_now: "2026-11-21T03:40:00+05:30", received_at: 999000000}, 999060000)).toBe(15);
  });
});
