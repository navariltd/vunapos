import { fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

import { AppLaunchScreen } from "@/components/splash/AppLaunchScreen";

describe("AppLaunchScreen", () => {
  it("uses one unbranded preparation state before routing begins", async () => {
    const onReady = jest.fn();
    const screen = await render(
      <AppLaunchScreen
        message="Preparing your workspace…"
        onReady={onReady}
      />,
    );

    expect(screen.getByText("Preparing your workspace…")).toBeTruthy();
    expect(screen.queryByText("VunaPOS")).toBeNull();
    expect(screen.queryByText("Mobile point of sale")).toBeNull();

    fireEvent(screen.getByLabelText("Preparing your workspace…"), "layout");
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
