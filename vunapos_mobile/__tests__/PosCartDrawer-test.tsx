import { cleanup, fireEvent, render as renderWithTestingLibrary } from "@testing-library/react-native";
import { createRef } from "react";
import type { ReactElement } from "react";
import { Dimensions, Pressable, StyleSheet, Text } from "react-native";
import * as Reanimated from "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

jest.mock("react-native-paper", () => ({ Text: require("react-native").Text }));

import { PosCartDrawer } from "@/features/pos/components/PosCartDrawer";
import type { PosCartDrawerHandle } from "@/features/pos/components/PosCartDrawer";

const safeAreaMetrics = {
  frame: { height: 800, width: 400, x: 0, y: 0 },
  insets: { bottom: 24, left: 0, right: 0, top: 24 },
};

function render(ui: ReactElement) {
  return renderWithTestingLibrary(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>{ui}</SafeAreaProvider>,
  );
}

describe("PosCartDrawer", () => {
  afterEach(async () => cleanup());

  it("starts its entrance only after the native modal is shown", async () => {
    const onClose = jest.fn();
    const timing = jest.spyOn(Reanimated, "withTiming");
    const screen = await render(
      <PosCartDrawer onClose={onClose}>
        <Text>Cart contents</Text>
      </PosCartDrawer>,
    );

    expect(screen.getByText("Cart contents")).toBeTruthy();
    const panelStyle = StyleSheet.flatten(screen.getByTestId("pos-cart-drawer-panel").props.style);
    expect(panelStyle.width).toBe(Math.min(Dimensions.get("window").width * 0.88, 512));
    expect(panelStyle.top).toBe(safeAreaMetrics.insets.top);
    expect(panelStyle.bottom).toBe(safeAreaMetrics.insets.bottom);
    expect(panelStyle.right).toBe(0);
    expect(panelStyle.borderTopLeftRadius).toBeGreaterThan(0);
    expect(panelStyle.borderBottomLeftRadius).toBeGreaterThan(0);
    expect(timing).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId("pos-cart-drawer-modal"), "show");
    expect(timing).toHaveBeenCalledWith(0, expect.objectContaining({ duration: 280 }));
    expect(timing).toHaveBeenCalledWith(1, { duration: 280 });
    timing.mockRestore();
  });

  it("closes once when multiple dismissal requests arrive", async () => {
    const onClose = jest.fn();
    const screen = await render(
      <PosCartDrawer onClose={onClose}>
        <Text>Cart contents</Text>
      </PosCartDrawer>,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Close cart" }));
    await fireEvent.press(screen.getByLabelText("Dismiss cart", { includeHiddenElements: true }));
    await fireEvent(screen.getByTestId("pos-cart-drawer-modal"), "requestClose");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(["backdrop", "Android back"])("closes through %s", async (trigger) => {
    const onClose = jest.fn();
    const screen = await render(
      <PosCartDrawer onClose={onClose}>
        <Text>Cart contents</Text>
      </PosCartDrawer>,
    );
    if (trigger === "backdrop") {
      await fireEvent.press(screen.getByLabelText("Dismiss cart", { includeHiddenElements: true }));
    } else {
      await fireEvent(screen.getByTestId("pos-cart-drawer-modal"), "requestClose");
    }
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lets cart content use the animated close path", async () => {
    const onClose = jest.fn();
    const drawerRef = createRef<PosCartDrawerHandle>();
    const screen = await render(
      <PosCartDrawer onClose={onClose} ref={drawerRef}>
        <Pressable accessibilityLabel="Browse items" onPress={() => drawerRef.current?.close()} />
      </PosCartDrawer>,
    );

    await fireEvent.press(screen.getByLabelText("Browse items"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
