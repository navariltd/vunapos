import { cleanup, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("@/theme/AppearanceProvider", () => ({
  useAppearance: () => ({
    palette: {
      background: "#ffffff",
      border: "#cccccc",
      onSurface: "#111111",
      onSurfaceMuted: "#666666",
      surface: "#ffffff",
    },
  }),
}));

import { PosSessionGateScreen } from "@/features/pos/screens/PosSessionGateScreen";

describe("PosSessionGateScreen", () => {
  afterEach(async () => cleanup());

  it("blocks sales until ERPNext reports a new ready opening session", async () => {
    const screen = await render(
      <PosSessionGateScreen
        session={{
          has_opening_entry: false,
          opening_entry: null,
          ready: false,
          status: "OPENING_REQUIRED",
        }}
      />,
    );

    expect(screen.getByText("A new POS shift is required")).toBeTruthy();
    expect(
      screen.getByText(
        "Open a new POS Opening Entry in ERPNext before making another sale.",
      ),
    ).toBeTruthy();
  });
});
