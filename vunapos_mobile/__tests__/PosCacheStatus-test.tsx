import { render } from "@testing-library/react-native";

import {
  formatCacheTimestamp,
  PosCacheStatus,
} from "@/features/pos/components/PosCacheStatus";

describe("PosCacheStatus", () => {
  it("formats freshness timestamps compactly", () => {
    expect(formatCacheTimestamp(Date.UTC(2026, 8, 13, 19, 5))).toMatch(
      /13\/09\/2026, \d{2}:05/,
    );
  });

  it("shows cached freshness at the bottom of a normal catalogue", async () => {
    const screen = await render(
      <PosCacheStatus
        isOffline={false}
        lastUpdated={Date.UTC(2026, 8, 13, 19, 5)}
      />,
    );

    expect(
      screen.getByText(
        `Updated ${formatCacheTimestamp(Date.UTC(2026, 8, 13, 19, 5))}`,
      ),
    ).toBeTruthy();
  });

  it("makes offline cached browsing explicit", async () => {
    const screen = await render(
      <PosCacheStatus
        isOffline
        lastUpdated={Date.UTC(2026, 8, 13, 19, 5)}
      />,
    );

    expect(
      screen.getByText(
        `Offline · Updated ${formatCacheTimestamp(Date.UTC(2026, 8, 13, 19, 5))}`,
      ),
    ).toBeTruthy();
  });
});
