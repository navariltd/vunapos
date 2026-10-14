import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { LaunchReadyContext, LaunchReadyRoute } from "@/components/splash/LaunchReadiness";

it("waits for destination layout before reporting launch readiness", async () => {
  const markReady = jest.fn();
  await render(
    <LaunchReadyContext.Provider value={markReady}>
      <LaunchReadyRoute><Text>Destination</Text></LaunchReadyRoute>
    </LaunchReadyContext.Provider>,
  );

  expect(screen.getByText("Destination")).toBeTruthy();
  expect(markReady).not.toHaveBeenCalled();
  fireEvent(screen.getByText("Destination").parent!, "layout");
  expect(markReady).toHaveBeenCalledTimes(1);
});
