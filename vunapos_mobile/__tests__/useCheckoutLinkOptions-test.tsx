import { renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));

jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useCheckoutLinkOptions } from "@/features/pos/hooks/useCheckoutLinkOptions";
import { getVunaMethod } from "@/services/frappeClient";

const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockUseAppSession = jest.mocked(useAppSession);

describe("useCheckoutLinkOptions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({
      companyUrl: "https://vuna.example.com",
      invalidateSession: jest.fn(),
      sessionId: "sid-1",
    } as unknown as ReturnType<typeof useAppSession>);
  });

  it("uses the permission-safe configured Link search endpoint", async () => {
    mockGetVunaMethod.mockResolvedValue([
      { label: "ABC Limited", value: "ABC Limited" },
    ]);
    const hook = await renderHook(() =>
      useCheckoutLinkOptions(
        {
          doctype: "Sales Invoice",
          fieldname: "custom_project",
          fieldtype: "Link",
          label: "Project",
        },
        "ABC",
      ),
    );

    await waitFor(() => expect(hook.result.current.options).toHaveLength(1));
    expect(mockGetVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.profile.search_checkout_link_options",
      {
        doctype: "Sales Invoice",
        fieldname: "custom_project",
        query: "ABC",
      },
      expect.any(AbortSignal),
    );
  });
});
