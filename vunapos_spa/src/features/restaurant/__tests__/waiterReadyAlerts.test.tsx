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
    expect(html).not.toContain("<button");
  });
  it("shows activation status without a staff mute or enable control", () => {
    const html = renderToStaticMarkup(
      <WaiterReadyAlerts user="waiter@example.com" />
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<button");
    expect(html).toContain("Tap anywhere to activate ready alerts");
    expect(html).not.toContain('role="alert"');
  });
});
