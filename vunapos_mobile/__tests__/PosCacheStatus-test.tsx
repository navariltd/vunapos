import { render } from "@testing-library/react-native";

jest.mock("@/theme/AppearanceProvider", () => ({
  useAppearance: () => ({
    palette: { onSurfaceMuted: "#777" },
  }),
}));

import { PosCacheStatus } from "@/features/pos/components/PosCacheStatus";

describe("PosCacheStatus", () => {
  it("keeps stale and refresh state in the natural page flow", async () => {
    const screen = await render(
      <PosCacheStatus
        isOffline={false}
        isRefreshing
        isStale
        lastUpdated={new Date("2026-09-26T09:30:00Z").getTime()}
      />,
    );

    expect(screen.getByText(/Refreshing · Updated/)).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("shows the last update when cached data is usable offline", async () => {
    const screen = await render(
      <PosCacheStatus
        isOffline
        isStale
        lastUpdated={new Date("2026-09-26T09:30:00Z").getTime()}
      />,
    );

    expect(screen.getByText(/Offline · Updated/)).toBeTruthy();
  });
});
