import { cleanup, fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({ Text: require("react-native").Text }));
jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));
jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  postVunaMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { ManagerPinApprovalDialog } from "@/features/pos/components/ManagerPinApprovalDialog";
import { postVunaMethod } from "@/services/frappeClient";

describe("ManagerPinApprovalDialog", () => {
  const onApproved = jest.fn();
  const onDismiss = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(useAppSession)
      .mockReturnValue({
        companyUrl: "https://vuna.example.com",
        invalidateSession: jest.fn(),
        sessionId: "sid-1",
      } as unknown as ReturnType<typeof useAppSession>);
    jest.mocked(postVunaMethod).mockResolvedValue({ token: "manager-token" });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("verifies a manager PIN with Frappe before approving a protected item removal", async () => {
    const screen = await render(
      <ManagerPinApprovalDialog
        onApproved={onApproved}
        onDismiss={onDismiss}
        posProfile="POS-001"
        visible
      />,
    );

    await fireEvent.changeText(screen.getByLabelText("Manager PIN"), "1234");
    await fireEvent.press(screen.getByLabelText("Approve item removal"));

    expect(postVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.pin.verify_manager",
      { action: "item_removal", pin: "1234", pos_profile: "POS-001" },
    );
    expect(onApproved).toHaveBeenCalledWith("manager-token");
  });
});
