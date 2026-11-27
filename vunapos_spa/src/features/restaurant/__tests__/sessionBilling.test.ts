import { describe, expect, it, vi } from "vitest";
import { checkoutSession, previewSessionBill, renderSessionBill, vunaMethods } from "../../../services/vunaApi";

describe("session billing transport", () => {
  it("prints the reviewed server bill without sending cart lines or payments", async () => {
    const call = vi.fn().mockResolvedValue({ message: { ok: true, data: { html: "<p>UNPAID</p>", session: "RS-1" } } });
    const params = { session: "RS-1", pos_profile: "Counter 1", fingerprint: "reviewed" };
    expect((await renderSessionBill(call, params)).html).toContain("UNPAID");
    expect(call).toHaveBeenCalledWith(params);
    expect(call.mock.lastCall?.[0]).not.toHaveProperty("items");
    expect(call.mock.lastCall?.[0]).not.toHaveProperty("payments");
    expect(vunaMethods.renderSessionBill).toBe("vunapos.api.restaurant.render_session_bill");
  });
  it("previews by server session identity, not client cart items", async () => {
    const call = vi.fn().mockResolvedValue({ message: { ok: true, data: { fingerprint: "reviewed" } } });
    expect((await previewSessionBill(call, { session: "RS-1", pos_profile: "Counter 1" })).fingerprint).toBe("reviewed");
    expect(call).toHaveBeenCalledWith({ session: "RS-1", pos_profile: "Counter 1" });
    expect(vunaMethods.previewSessionBill).toBe("vunapos.api.restaurant.preview_session_bill");
  });

  it("settles only the reviewed bill and payment allocations without accepting rates or source rows", async () => {
    const call = vi.fn().mockResolvedValue({ message: { ok: true, data: { session: { status: "Settled" } } } });
    const params = { session: "RS-1", pos_profile: "Counter 1", fingerprint: "reviewed", payments: [{ mode_of_payment: "Cash", amount: 250 }] };
    const result = await checkoutSession(call, params);
    expect(result.session.status).toBe("Settled");
    expect(call).toHaveBeenCalledWith(params);
    expect(call.mock.lastCall?.[0]).not.toHaveProperty("items");
    expect(vunaMethods.checkoutSession).toBe("vunapos.api.restaurant.checkout_session");
  });
});
