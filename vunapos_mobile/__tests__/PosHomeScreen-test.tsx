import { cleanup, fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("@/features/pos/components/PosCartButton", () => ({
  PosCartButton: () => null,
}));

jest.mock("@/features/pos/components/PosItemCard", () => ({
  PosItemCard: ({
    imageUrl,
    item,
    onAdd,
  }: {
    imageUrl?: string | null;
    item: { item_name: string };
    onAdd: (item: { item_name: string }) => void;
  }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <Pressable accessibilityRole="button" onPress={() => onAdd(item)}>
        <Text>{`Card: ${item.item_name}`}</Text>
        <Text>{`Image: ${imageUrl ?? "none"}`}</Text>
      </Pressable>
    );
  },
}));

jest.mock("@/features/pos/components/PosItemListRow", () => ({
  PosItemListRow: ({
    item,
    onAdd,
  }: {
    item: { item_name: string };
    onAdd: (item: { item_name: string }) => void;
  }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <Pressable accessibilityRole="button" onPress={() => onAdd(item)}>
        <Text>{`List: ${item.item_name}`}</Text>
      </Pressable>
    );
  },
}));

jest.mock("@/features/pos/components/PosItemSearch", () => ({
  PosItemSearch: () => {
    const { Text } = require("react-native");
    return <Text>Search items</Text>;
  },
}));

jest.mock("@/features/pos/components/PosBarcodeScannerModal", () => ({
  PosBarcodeScannerModal: () => null,
}));

jest.mock("@/features/pos/components/PosCustomerPickerSheet", () => ({
  PosCustomerPickerSheet: () => null,
}));

jest.mock("@/features/pos/hooks/usePosBootstrap", () => ({
  usePosBootstrap: jest.fn(),
}));

jest.mock("@/features/pos/hooks/usePosItemSearch", () => ({
  usePosItemSearch: jest.fn(),
}));

jest.mock("@/features/pos/hooks/usePosBarcodeScan", () => ({
  usePosBarcodeScan: () => ({ isResolving: false, resolve: jest.fn() }),
}));

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: () => ({ companyUrl: "https://vuna.example.com" }),
}));

import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import { usePosItemSearch } from "@/features/pos/hooks/usePosItemSearch";
import { PosHomeScreen } from "@/features/pos/screens/PosHomeScreen";

const mockUsePosBootstrap = jest.mocked(usePosBootstrap);
const mockUsePosItemSearch = jest.mocked(usePosItemSearch);
const onAddToCart = jest.fn();
const onPosProfileLoaded = jest.fn();

describe("PosHomeScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePosBootstrap.mockReturnValue({
      data: {
        default_customer: {
          customer: "CUST-WALK-IN",
          customer_name: "Walk-in customer",
        },
        items: [],
        payment_modes: [],
        pos_profile: { currency: "KES", name: "POS-001" },
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    mockUsePosItemSearch.mockReturnValue({
      error: null,
      hasLoaded: false,
      isLoading: false,
      items: [],
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("adds catalogue items without asking for a customer first", async () => {
    const liveItem = {
      actual_qty: 3,
      item_code: "LIVE-001",
      item_name: "Live catalogue item",
      rate: 150,
    };
    mockUsePosBootstrap.mockReturnValue({
      data: {
        items: [liveItem],
        default_customer: null,
        payment_modes: [],
        pos_profile: { currency: "KES", name: "POS-001" },
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    const screen = await render(
      <PosHomeScreen
        cartItemCount={0}
        onAddToCart={onAddToCart}
        onOpenCart={jest.fn()}
        onPosProfileLoaded={onPosProfileLoaded}
      />,
    );

    expect(screen.getByText("Card: Live catalogue item")).toBeTruthy();
    expect(screen.getByText("Image: none")).toBeTruthy();
    expect(onPosProfileLoaded).toHaveBeenCalledWith(
      expect.objectContaining({
        default_customer: null,
        pos_profile: expect.objectContaining({ name: "POS-001" }),
      }),
    );
    expect(mockUsePosItemSearch).toHaveBeenCalledWith(
      expect.objectContaining({ loadAll: true, posProfile: "POS-001" }),
    );
    await fireEvent.press(screen.getByText("Card: Live catalogue item"));
    expect(onAddToCart).toHaveBeenCalledWith(liveItem, "KES");
  });

  it("renders compact catalogue rows when the POS profile hides item images", async () => {
    const item = {
      actual_qty: 3,
      item_code: "LIST-001",
      item_name: "List catalogue item",
      rate: 150,
    };
    mockUsePosBootstrap.mockReturnValue({
      data: {
        items: [item],
        default_customer: null,
        payment_modes: [],
        pos_profile: { currency: "KES", hide_images: true, name: "POS-001" },
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });

    const screen = await render(
      <PosHomeScreen
        cartItemCount={0}
        onAddToCart={onAddToCart}
        onOpenCart={jest.fn()}
        onPosProfileLoaded={onPosProfileLoaded}
      />,
    );

    expect(screen.getByText("List: List catalogue item")).toBeTruthy();
    expect(screen.queryByText("Card: List catalogue item")).toBeNull();
    await fireEvent.press(screen.getByText("List: List catalogue item"));
    expect(onAddToCart).toHaveBeenCalledWith(item, "KES");
  });

  it("resolves relative Frappe item images against the saved company URL", async () => {
    const item = {
      actual_qty: 3,
      image: "/files/catalogue-item.png",
      item_code: "IMAGE-001",
      item_name: "Image catalogue item",
      rate: 150,
    };
    mockUsePosBootstrap.mockReturnValue({
      data: {
        items: [item],
        default_customer: null,
        payment_modes: [],
        pos_profile: { currency: "KES", name: "POS-001" },
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });

    const screen = await render(
      <PosHomeScreen
        cartItemCount={0}
        onAddToCart={onAddToCart}
        onOpenCart={jest.fn()}
        onPosProfileLoaded={onPosProfileLoaded}
      />,
    );

    expect(
      screen.getByText(
        "Image: https://vuna.example.com/files/catalogue-item.png",
      ),
    ).toBeTruthy();
  });

  it("shows a retryable error when the POS bootstrap cannot load", async () => {
    const reload = jest.fn();
    mockUsePosBootstrap.mockReturnValue({
      data: null,
      error: "Could not reach your company site.",
      isLoading: false,
      reload,
    });
    const screen = await render(
      <PosHomeScreen
        cartItemCount={0}
        onAddToCart={onAddToCart}
        onOpenCart={jest.fn()}
        onPosProfileLoaded={onPosProfileLoaded}
      />,
    );

    expect(screen.getByText("Could not reach your company site.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Retry loading POS catalogue"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads the live catalogue after a completed sale invalidates the POS snapshot", async () => {
    const reload = jest.fn();
    mockUsePosBootstrap.mockReturnValue({
      data: {
        default_customer: null,
        items: [],
        payment_modes: [],
        pos_profile: { currency: "KES", name: "POS-001" },
      },
      error: null,
      isLoading: false,
      reload,
    });
    const screen = await render(
      <PosHomeScreen
        cartItemCount={0}
        onAddToCart={onAddToCart}
        onOpenCart={jest.fn()}
        onPosProfileLoaded={onPosProfileLoaded}
        refreshKey={0}
      />,
    );

    expect(reload).not.toHaveBeenCalled();
    await screen.rerender(
      <PosHomeScreen
        cartItemCount={0}
        onAddToCart={onAddToCart}
        onOpenCart={jest.fn()}
        onPosProfileLoaded={onPosProfileLoaded}
        refreshKey={1}
      />,
    );

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
