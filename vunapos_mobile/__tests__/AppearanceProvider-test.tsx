import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react-native";

const mockGetItemAsync = jest.fn();
const mockSetItemAsync = jest.fn();
const mockSetBackgroundColorAsync = jest.fn();

jest.mock("expo-secure-store", () => ({
  getItemAsync: (...args: unknown[]) => mockGetItemAsync(...args),
  setItemAsync: (...args: unknown[]) => mockSetItemAsync(...args),
}));

jest.mock("expo-system-ui", () => ({
  setBackgroundColorAsync: (...args: unknown[]) =>
    mockSetBackgroundColorAsync(...args),
}));

jest.mock("expo-navigation-bar", () => ({
  NavigationBar: () => null,
}));

jest.mock("expo-status-bar", () => ({
  StatusBar: () => null,
}));

import {
  AppearanceProvider,
  resolveAppearance,
  useAppearance,
} from "@/theme/AppearanceProvider";

describe("appearance provider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItemAsync.mockResolvedValue(null);
    mockSetItemAsync.mockResolvedValue(undefined);
    mockSetBackgroundColorAsync.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("resolves explicit and system appearance choices predictably", () => {
    expect(resolveAppearance("dark", "light")).toBe("dark");
    expect(resolveAppearance("light", "dark")).toBe("light");
    expect(resolveAppearance("system", "dark")).toBe("dark");
    expect(resolveAppearance("system", "unspecified")).toBe("light");
  });

  it("loads a saved preference before exposing the interactive appearance state", async () => {
    mockGetItemAsync.mockResolvedValue("dark");
    const hook = await renderHook(() => useAppearance(), {
      wrapper: AppearanceProvider,
    });

    await waitFor(() => expect(hook.result.current.isReady).toBe(true));
    expect(hook.result.current.preference).toBe("dark");
    expect(hook.result.current.appearance).toBe("dark");
    expect(mockSetBackgroundColorAsync).toHaveBeenLastCalledWith("#171717");
  });

  it("persists a newly selected appearance and updates the active palette immediately", async () => {
    const hook = await renderHook(() => useAppearance(), {
      wrapper: AppearanceProvider,
    });

    await waitFor(() => expect(hook.result.current.isReady).toBe(true));
    await act(async () => {
      await hook.result.current.setPreference("dark");
    });

    expect(hook.result.current.appearance).toBe("dark");
    expect(mockSetItemAsync).toHaveBeenCalledWith(
      "vunapos_appearance_preference",
      "dark",
    );
  });
});
