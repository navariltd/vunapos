import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("@/features/pos/components/PosCartButton", () => ({
  PosCartButton: () => null,
}));

jest.mock("@/features/pos/components/PosItemCard", () => ({
  PosItemCard: ({
    imageUrl,
    isAdding,
    item,
    onAdd,
  }: {
    imageUrl?: string | null;
    isAdding?: boolean;
    item: { item_name: string };
    onAdd: (item: { item_name: string }) => void;
  }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <Pressable
        accessibilityRole="button"
        disabled={isAdding}
        onPress={() => onAdd(item)}
      >
        <Text>
          {isAdding ? `Adding: ${item.item_name}` : `Card: ${item.item_name}`}
        </Text>
        <Text>{`Image: ${imageUrl ?? "none"}`}</Text>
      </Pressable>
    );
  },
}));

jest.mock("@/features/pos/components/PosItemListRow", () => ({
  PosItemListRow: ({
    item,
    isAdding,
    onAdd,
  }: {
    item: { item_name: string };
    isAdding?: boolean;
    onAdd: (item: { item_name: string }) => void;
  }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <Pressable
        accessibilityRole="button"
        disabled={isAdding}
        onPress={() => onAdd(item)}
      >
        <Text>
          {isAdding ? `Adding: ${item.item_name}` : `List: ${item.item_name}`}
        </Text>
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

jest.mock("@/features/pos/components/PosVariantPickerSheet", () => ({
  PosVariantPickerSheet: ({
    onSelect,
    variants,
    visible,
  }: {
    onSelect: (variant: { item_code: string }) => void;
    variants: { item_code: string }[];
    visible: boolean;
  }) => {
    if (!visible) return null;
    const { Pressable, Text } = require("react-native");
    return (
      <Pressable
        accessibilityLabel="Select first variant"
        onPress={() => onSelect(variants[0])}
      >
        <Text>Variant picker</Text>
      </Pressable>
    );
  },
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

jest.mock("@/features/pos/hooks/usePosTemplateVariants", () => ({
  usePosTemplateVariants: jest.fn(),
}));

jest.mock("@/features/pos/hooks/usePosBarcodeScan", () => ({
  usePosBarcodeScan: () => ({ isResolving: false, resolve: jest.fn() }),
}));

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: () => ({ companyUrl: "https://vuna.example.com" }),
}));

import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import { usePosItemSearch } from "@/features/pos/hooks/usePosItemSearch";
import { usePosTemplateVariants } from "@/features/pos/hooks/usePosTemplateVariants";
import { PosHomeScreen } from "@/features/pos/screens/PosHomeScreen";

const mockUsePosBootstrap = jest.mocked(usePosBootstrap);
const mockUsePosItemSearch = jest.mocked(usePosItemSearch);
const mockUsePosTemplateVariants = jest.mocked(usePosTemplateVariants);
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
    mockUsePosTemplateVariants.mockReturnValue({
      data: { template: { item_code: "", item_name: "" }, variants: [] },
      error: null,
      isLoading: false,
      reload: jest.fn(),
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

  it("keeps the catalogue visible and explains when adding an item fails", async () => {
    const item = {
      actual_qty: 3,
      item_code: "FAILED-001",
      item_name: "Failed catalogue item",
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
        onAddToCart={async () => false}
        onOpenCart={jest.fn()}
        onPosProfileLoaded={onPosProfileLoaded}
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByText("Card: Failed catalogue item"));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        screen.getByText(
          "Could not add Failed catalogue item. Please try again.",
        ),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Card: Failed catalogue item")).toBeTruthy();
  });

  it("fetches and adds a concrete variant instead of adding its template", async () => {
    const template = {
      has_variants: true,
      item_code: "SHIRT-TEMPLATE",
      item_name: "Vuna shirt",
    };
    const variant = {
      actual_qty: 2,
      item_code: "SHIRT-BLUE-M",
      item_name: "Vuna shirt · Blue · M",
      rate: 1200,
    };
    mockUsePosBootstrap.mockReturnValue({
      data: {
        items: [template],
        default_customer: null,
        payment_modes: [],
        pos_profile: { currency: "KES", name: "POS-001" },
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    mockUsePosTemplateVariants.mockReturnValue({
      data: {
        template: {
          item_code: template.item_code,
          item_name: template.item_name,
        },
        variants: [variant],
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
        pricingContext={{ customer: "CUST-001", priceList: "Retail" }}
      />,
    );

    await fireEvent.press(screen.getByText("Card: Vuna shirt"));
    expect(screen.getByText("Variant picker")).toBeTruthy();
    expect(mockUsePosTemplateVariants).toHaveBeenLastCalledWith(
      expect.objectContaining({
        customer: "CUST-001",
        enabled: true,
        priceList: "Retail",
        templateItemCode: "SHIRT-TEMPLATE",
      }),
    );
    await fireEvent.press(screen.getByLabelText("Select first variant"));
    expect(onAddToCart).toHaveBeenCalledWith(variant, "KES");
    expect(onAddToCart).not.toHaveBeenCalledWith(template, "KES");
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
