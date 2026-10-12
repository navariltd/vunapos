import { fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

import { AppLaunchScreen } from "@/components/splash/AppLaunchScreen";

describe("AppLaunchScreen", () => {
  it("continues the native splash branding until the destination is ready", async () => {
    const onReady = jest.fn();
    const screen = await render(
      <AppLaunchScreen
        message="Preparing your workspace…"
        onReady={onReady}
      />,
    );

    expect(screen.getByText("Preparing your workspace…")).toBeTruthy();
    expect(screen.getByLabelText("VunaPOS logo")).toBeTruthy();
    expect(onReady).not.toHaveBeenCalled();

    fireEvent(screen.getByLabelText("Preparing your workspace…"), "layout");
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
