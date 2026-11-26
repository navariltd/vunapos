import { describe, expect, it, vi } from "vitest";
import { createContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WaiterReadyAlerts } from "../components/WaiterReadyAlerts";

vi.mock("frappe-react-sdk", () => ({ FrappeContext: createContext(null) }));

describe("waiter ready sound control", () => {
  it("cannot enable sound disabled centrally, but retains the notification subscription", () => {
    const html = renderToStaticMarkup(
      <WaiterReadyAlerts
        user="waiter@example.com"
        soundSettings={{
          newKot: { enabled: true, tone: "chime", volume: 70 },
          ready: { enabled: false, tone: "bell", volume: 70 },
        }}
      />
    );
    expect(html).toContain("Ready sound disabled in settings");
    expect(html).toContain('disabled=""');
  });
  it("starts muted with a labelled, keyboard-accessible control", () => {
    const html = renderToStaticMarkup(
      <WaiterReadyAlerts user="waiter@example.com" />
    );
    expect(html).toContain('aria-label="Enable ready alerts"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Ready alerts off");
    expect(html).not.toContain('role="alert"');
  });
});
