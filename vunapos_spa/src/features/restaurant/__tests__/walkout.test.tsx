import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RecordWalkout,
  WalkoutConfirmation,
} from "../components/RecordWalkout";
import type { SessionBillDTO } from "../types";

vi.mock("frappe-react-sdk", () => ({
  useFrappePostCall: () => ({ call: vi.fn() }),
}));
const bill = {
  can_record_walkout: true,
  session: {
    name: "RS-1",
    status: "Open",
    customer: "Walk In",
    customer_name: "Walk In",
  },
  invoice: { totals: { grand_total: 100 } },
} as SessionBillDTO;

describe("manager walkout control", () => {
  it("does not offer walkout to an unauthorized user or an already billed visit", () => {
    for (const change of [
      { can_record_walkout: false },
      { session: { ...bill.session, status: "Settling" as const } },
    ]) {
      expect(
        renderToStaticMarkup(
          <RecordWalkout
            bill={{ ...bill, ...change }}
            posProfile="Till"
            disabled={false}
            onRecorded={vi.fn()}
          />
        )
      ).toBe("");
    }
  });
  it("offers a distinct walkout action, not a credit sale toggle", () => {
    const html = renderToStaticMarkup(
      <RecordWalkout
        bill={bill}
        posProfile="Till"
        disabled={false}
        onRecorded={vi.fn()}
      />
    );
    expect(html).toContain("Record walkout");
    expect(html).not.toContain('disabled=""');
  });
  it("blocks the action while a gateway result is pending", () => {
    const pending = {
      name: "L1",
      amount: 50,
      status: "Pending",
    } as NonNullable<SessionBillDTO["gateway_links"]>[number];
    const html = renderToStaticMarkup(
      <RecordWalkout
        bill={{ ...bill, gateway_links: [pending] }}
        posProfile="Till"
        disabled={false}
        onRecorded={vi.fn()}
      />
    );
    expect(html).toContain('disabled=""');
  });
  it("requires a reason and explains the unpaid balance, customer and workflow", () => {
    const html = renderToStaticMarkup(
      <WalkoutConfirmation
        open
        busy={false}
        reason=""
        balance={75}
        customer="Walk In"
        currency="KES"
        error=""
        onReason={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );
    expect(html).toContain("Walk In");
    expect(html).toContain("75.00");
    expect(html).toContain("write off");
    expect(html).toContain("workflow approval");
    expect(html).toContain('disabled=""');
  });
});
