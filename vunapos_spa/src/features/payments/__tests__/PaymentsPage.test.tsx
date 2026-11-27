// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PaymentsPage } from "../PaymentsPage";

vi.mock("frappe-react-sdk", () => ({
  useFrappeGetCall: () => ({}),
  useFrappePostCall: () => ({
    call: vi.fn(),
    loading: false,
  }),
}));

vi.mock("../../pos/hooks/useCustomerSearch", () => ({
  useCustomerSearch: () => ({
    customers: [],
    loading: false,
  }),
}));

vi.mock("../../pos/hooks/useGatewayPaymentRealtime", () => ({
  useGatewayPaymentRealtime: vi.fn(),
}));

const STORAGE_KEY = "vunapos.payments-tab";

describe("PaymentsPage tab selection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  function renderPage(allowHistory = true) {
    act(() => {
      root.render(
        <PaymentsPage
          allowReceive
          allowReconciliation
          allowHistory={allowHistory}
          paymentModes={[]}
          isOnline={true}
        />,
      );
    });
  }

  function getTab(name: string) {
    return Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.trim() === name);
  }

  it("preserves a valid saved tab", () => {
    window.localStorage.setItem(STORAGE_KEY, "history");

    renderPage();

    expect(
      getTab("History")?.classList.contains("border-b-2"),
    ).toBe(true);

    expect(window.localStorage.getItem(STORAGE_KEY))
      .toBe("history");
  });

  it("persists the fallback when permissions change and are restored", () => {
    window.localStorage.setItem(STORAGE_KEY, "history");

    renderPage();

    expect(
      getTab("History")?.classList.contains("border-b-2"),
    ).toBe(true);

    renderPage(false);

    expect(getTab("History")).toBeUndefined();

    expect(
      getTab("Receive")?.classList.contains("border-b-2"),
    ).toBe(true);

    expect(window.localStorage.getItem(STORAGE_KEY))
      .toBe("receive");

    renderPage(true);

    expect(getTab("History")).toBeDefined();

    expect(
      getTab("Receive")?.classList.contains("border-b-2"),
    ).toBe(true);

    expect(
      getTab("History")?.classList.contains("border-b-2"),
    ).toBe(false);

    expect(window.localStorage.getItem(STORAGE_KEY))
      .toBe("receive");
  });
});
