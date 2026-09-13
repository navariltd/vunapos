import { render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

const mockUseAppearance = jest.fn();

jest.mock("@expo/vector-icons", () => ({
  MaterialCommunityIcons: "MaterialCommunityIcons",
}));

jest.mock("@/theme/AppearanceProvider", () => ({
  useAppearance: () => mockUseAppearance(),
}));

import { PosCartButton } from "@/features/pos/components/PosCartButton";
import { darkPalette, lightPalette } from "@/theme/tokens";

type RenderedNode = {
  children?: Array<RenderedNode | string>;
  props?: { style?: unknown; testID?: string };
};

function findNodeByTestId(
  node: RenderedNode | string | null,
  testID: string,
): RenderedNode | null {
  if (!node || typeof node === "string") return null;
  if (node.props?.testID === testID) return node;

  for (const child of node.children ?? []) {
    const match = findNodeByTestId(child, testID);
    if (match) return match;
  }
  return null;
}

describe("PosCartButton", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([lightPalette, darkPalette])(
    "uses a strong red notification badge with white text",
    async (palette) => {
      mockUseAppearance.mockReturnValue({ palette });

      const screen = await render(
        <PosCartButton itemCount={3} onPress={jest.fn()} />,
      );
      const badge = findNodeByTestId(
        screen.toJSON() as RenderedNode | null,
        "cart-item-count",
      );
      const badgeStyle = StyleSheet.flatten(badge?.props?.style);

      expect(badgeStyle).toMatchObject({
        backgroundColor: "#d32f2f",
        color: "#ffffff",
      });
    },
  );
});
