// @vitest-environment jsdom
import { act, createContext } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KitchenPrintWorker } from "../components/KitchenPrinting";

const mocks = vi.hoisted(() => ({
  sound: vi.fn(),
  lock: vi.fn(),
  chime: vi.fn(),
}));
vi.mock("frappe-react-sdk", () => ({
  FrappeContext: createContext(null),
  useFrappeGetCall: () => ({ data: { message: [] }, mutate: vi.fn() }),
  useFrappePostCall: () => ({ call: vi.fn(), loading: false }),
}));
vi.mock("../hooks/usePrintLeaderLock", () => ({
  usePrintLeaderLock: mocks.lock,
}));

const config = {
  stations: [],
  user: "cashier@example.com",
  can_print: true,
  can_manage: false,
  run_on_pos: true,
};

describe("shared kitchen printing sound controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.lock.mockReturnValue(false);
    mocks.sound.mockReturnValue({
      configured: true,
      enabled: true,
      busy: false,
      error: null,
      onCreated: mocks.chime,
      enable: vi.fn(),
      mute: vi.fn(),
      preview: vi.fn(),
    });
  });

  it("resumes the manager-enabled terminal for another authorized user without exposing setup", () => {
    localStorage.setItem("vunapos_autoprint_enabled:terminal:Counter 1", "1");
    const html = renderToStaticMarkup(
      <KitchenPrintWorker
        config={{ ...config, user: "chef@example.com" }}
        posProfile="Counter 1"
        sound={mocks.sound()}
      />
    );
    expect(mocks.lock).toHaveBeenCalledWith("terminal:Counter 1", true);
    expect(html).not.toContain("Manage printer");
    expect(html).not.toContain("Discover printers");
    expect(html).not.toContain("Stop printing");
  });

  it("only migrates a legacy per-user printing opt-in for managers", () => {
    localStorage.setItem(
      "vunapos_autoprint_enabled:cashier@example.com:Counter 1",
      "1"
    );
    renderToStaticMarkup(
      <KitchenPrintWorker
        config={config}
        posProfile="Counter 1"
        sound={mocks.sound()}
      />
    );
    expect(
      localStorage.getItem("vunapos_autoprint_enabled:terminal:Counter 1")
    ).toBeNull();
    renderToStaticMarkup(
      <KitchenPrintWorker
        config={{ ...config, can_manage: true }}
        posProfile="Counter 1"
        sound={mocks.sound()}
      />
    );
    expect(
      localStorage.getItem("vunapos_autoprint_enabled:terminal:Counter 1")
    ).toBe("1");
  });

  it("does not override a manager's explicit terminal stop with an older user preference", () => {
    localStorage.setItem("vunapos_autoprint_enabled:terminal:Counter 1", "0");
    localStorage.setItem(
      "vunapos_autoprint_enabled:cashier@example.com:Counter 1",
      "1"
    );
    renderToStaticMarkup(
      <KitchenPrintWorker
        config={{ ...config, can_manage: true }}
        posProfile="Counter 1"
        sound={mocks.sound()}
      />
    );
    expect(mocks.lock).toHaveBeenCalledWith("terminal:Counter 1", false);
    expect(
      localStorage.getItem("vunapos_autoprint_enabled:terminal:Counter 1")
    ).toBe("0");
  });

  it("uses the shared sound controller instead of a printer-specific controller", () => {
    renderToStaticMarkup(
      <KitchenPrintWorker
        config={config}
        posProfile="Counter 1"
        sound={mocks.sound()}
      />
    );
    expect(mocks.lock).toHaveBeenCalledWith(
      "audio:cashier@example.com:Counter 1",
      true
    );
  });

  it("keeps setup and help text out of the kitchen workspace by default", () => {
    const html = renderToStaticMarkup(
      <KitchenPrintWorker
        config={config}
        posProfile="Counter 1"
        sound={mocks.sound()}
      />
    );
    expect(html).not.toContain("Manage printer");
    expect(html).toContain("Printer:");
    expect(html).not.toContain("Start printing");
    expect(html).not.toContain("Discover printers");
    expect(html).not.toContain("Print orders for");
    expect(html).not.toContain("Sound follows POS Settings");
    expect(html).not.toContain('role="dialog"');
  });

  it("opens configuration in a dismissible dialog instead of expanding the page", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    try {
      await act(async () =>
        root.render(
          <KitchenPrintWorker
            config={{ ...config, can_manage: true }}
            posProfile="Counter 1"
            sound={mocks.sound()}
          />
        )
      );
      const manage = Array.from(node.querySelectorAll("button")).find(
        (button) => button.getAttribute("aria-label") === "Manage printer"
      )!;
      await act(async () => manage.click());
      const dialog = node.querySelector('[role="dialog"]')!;
      expect(dialog.textContent).toContain("Discover printers");
      expect(dialog.textContent).toContain("Start printing");
      expect(
        dialog.querySelector('select[aria-label="Printing stations"]')
      ).not.toBeNull();
      await act(async () =>
        dialog
          .querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
          .click()
      );
      expect(node.querySelector('[role="dialog"]')).toBeNull();
      expect(node.textContent).toContain("Printer:");
    } finally {
      await act(async () => root.unmount());
      node.remove();
    }
  });

  it("leaves audio to the KDS when that screen is open", () => {
    renderToStaticMarkup(
      <KitchenPrintWorker
        config={config}
        posProfile="Counter 1"
        sound={mocks.sound()}
        kitchenPage
      />
    );
    expect(mocks.lock).toHaveBeenCalledWith(
      "audio:cashier@example.com:Counter 1",
      false
    );
  });

  it("renders KDS controls in its toolbar without remounting the worker", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const node = document.createElement("div");
    const toolbar = document.createElement("div");
    document.body.append(node, toolbar);
    const root = createRoot(node);
    try {
      await act(async () =>
        root.render(
          <KitchenPrintWorker
            config={{ ...config, can_manage: true }}
            posProfile="Counter 1"
            sound={mocks.sound()}
            kitchenPage
            toolbarTarget={toolbar}
          />
        )
      );
      expect(node.textContent).toBe("");
      expect(toolbar.textContent).toContain("Printer:");
      const manage = Array.from(toolbar.querySelectorAll("button")).find(
        (button) => button.getAttribute("aria-label") === "Manage printer"
      )!;
      await act(async () => manage.click());
      expect(toolbar.querySelector('[role="dialog"]')).not.toBeNull();
      // Moving the view must not reset the worker's open-dialog state.
      await act(async () =>
        root.render(
          <KitchenPrintWorker
            config={{ ...config, can_manage: true }}
            posProfile="Counter 1"
            sound={mocks.sound()}
          />
        )
      );
      expect(toolbar.textContent).toBe("");
      expect(node.querySelector('[role="dialog"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      node.remove();
      toolbar.remove();
    }
  });

  it("does not acquire audio ownership when muted or centrally disabled", () => {
    mocks.sound.mockReturnValue({
      configured: false,
      enabled: false,
      busy: false,
      error: null,
      onCreated: mocks.chime,
    });
    renderToStaticMarkup(
      <KitchenPrintWorker
        config={config}
        posProfile="Counter 1"
        sound={mocks.sound()}
      />
    );
    expect(mocks.lock).toHaveBeenCalledWith(
      "audio:cashier@example.com:Counter 1",
      false
    );
  });

  it("uses distinct print leadership keys for separate POS Profiles", () => {
    renderToStaticMarkup(
      <KitchenPrintWorker
        config={config}
        posProfile="Counter 1"
        sound={mocks.sound()}
      />
    );
    renderToStaticMarkup(
      <KitchenPrintWorker
        config={config}
        posProfile="Counter 2"
        sound={mocks.sound()}
      />
    );
    expect(mocks.lock).toHaveBeenCalledWith("terminal:Counter 1", false);
    expect(mocks.lock).toHaveBeenCalledWith("terminal:Counter 2", false);
  });
});
