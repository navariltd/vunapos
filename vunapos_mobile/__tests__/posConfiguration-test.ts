import {
  effectivePosConfigurationFingerprint,
  transactionConfigurationFingerprint,
} from "@/features/pos/posConfiguration";
import { PosBootstrapData } from "@/features/pos/types";

function bootstrap(overrides: Partial<PosBootstrapData> = {}): PosBootstrapData {
  return {
    payment_modes: [{ mode_of_payment: "Cash" }],
    pos_profile: {
      company: "ACME",
      currency: "KES",
      default_order_type: "Sales Invoice",
      name: "POS-1",
      price_list: "Standard Selling",
      warehouse: "Main Warehouse",
    },
    pos_session: {
      cashier: "cashier@example.com",
      has_opening_entry: true,
      opening_entry: "OPEN-1",
      pos_profile: "POS-1",
      ready: true,
      status: "OPEN",
      verified_at: "2026-09-27 10:00:00",
    },
    server_time: "2026-09-27 10:00:00",
    ...overrides,
  };
}

describe("POS configuration identity", () => {
  it("ignores server and session verification timestamps", () => {
    const first = bootstrap();
    const second = bootstrap({
      server_time: "2026-09-27 11:00:00",
      pos_session: {
        has_opening_entry: true,
        opening_entry: "OPEN-1",
        cashier: "cashier@example.com",
        pos_profile: "POS-1",
        ready: true,
        status: "OPEN",
        verified_at: "2026-09-27 11:00:00",
      },
    });

    expect(effectivePosConfigurationFingerprint(first)).toBe(
      effectivePosConfigurationFingerprint(second),
    );
    expect(transactionConfigurationFingerprint(first)).toBe(
      transactionConfigurationFingerprint(second),
    );
  });

  it("detects a genuine pricing configuration change", () => {
    const first = bootstrap();
    const second = bootstrap({
      pos_profile: {
        ...first.pos_profile,
        price_list: "Wholesale Selling",
      },
    });

    expect(effectivePosConfigurationFingerprint(first)).not.toBe(
      effectivePosConfigurationFingerprint(second),
    );
    expect(transactionConfigurationFingerprint(first)).not.toBe(
      transactionConfigurationFingerprint(second),
    );
  });

  it("detects rounding and payment-reference configuration changes", () => {
    const first = bootstrap({
      pos_profile: {
        ...bootstrap().pos_profile,
        disable_rounded_total: false,
        rounding_method: "Banker's Rounding (legacy)",
        modes_of_payment: [{ mode_of_payment: "Cash", requires_reference: false }],
      },
    });
    const second = bootstrap({
      pos_profile: {
        ...first.pos_profile,
        disable_rounded_total: true,
        rounding_method: "Commercial Rounding",
        modes_of_payment: [{ mode_of_payment: "Cash", requires_reference: true }],
      },
    });

    expect(effectivePosConfigurationFingerprint(first)).not.toBe(
      effectivePosConfigurationFingerprint(second),
    );
    expect(transactionConfigurationFingerprint(first)).not.toBe(
      transactionConfigurationFingerprint(second),
    );
  });

  it("detects profile-controlled UI and checkout changes", () => {
    const first = bootstrap();
    const second = bootstrap({
      pos_profile: {
        ...first.pos_profile,
        hide_unavailable_items: true,
        background_submission: { enabled: true },
        allow_customer_creation: false,
      },
    });

    expect(effectivePosConfigurationFingerprint(first)).not.toBe(
      effectivePosConfigurationFingerprint(second),
    );
  });

  it.each([
    ["warehouse", { warehouse: "Secondary Warehouse" }],
    ["taxes", { taxes_and_charges: "VAT 16%" }],
    ["price list", { price_list: "Wholesale Selling" }],
    ["pricing rules", { ignore_pricing_rule: true }],
  ])("marks a %s change as transaction-affecting", (_label, change) => {
    const first = bootstrap();
    const second = bootstrap({
      pos_profile: { ...first.pos_profile, ...change },
    });

    expect(transactionConfigurationFingerprint(first)).not.toBe(
      transactionConfigurationFingerprint(second),
    );
  });

  it("does not mark payment metadata as a cart pricing change", () => {
    const first = bootstrap();
    const second = bootstrap({
      payment_modes: [
        { mode_of_payment: "Cash" },
        { mode_of_payment: "M-Pesa" },
      ],
    });

    expect(effectivePosConfigurationFingerprint(first)).not.toBe(
      effectivePosConfigurationFingerprint(second),
    );
    expect(transactionConfigurationFingerprint(first)).toBe(
      transactionConfigurationFingerprint(second),
    );
  });
});
