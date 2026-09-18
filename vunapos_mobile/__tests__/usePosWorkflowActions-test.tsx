import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));

const mockUseNetworkStatus = jest.fn();
jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
  postVunaMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosWorkflowActions } from "@/features/pos/hooks/usePosWorkflowActions";
import { getVunaMethod, postVunaMethod } from "@/services/frappeClient";

const mockUseAppSession = jest.mocked(useAppSession);
const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockPostVunaMethod = jest.mocked(postVunaMethod);
const invalidateSession = jest.fn();

describe("POS workflow actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    mockUseAppSession.mockReturnValue({
      companyUrl: "https://vuna.example.com",
      invalidateSession,
      sessionId: "sid-1",
    } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("loads only the server-authorized actions for the current draft", async () => {
    mockGetVunaMethod.mockResolvedValue([
      { action: "Approve", next_state: "Approved" },
    ]);
    const hook = await renderHook(() =>
      usePosWorkflowActions({
        doctype: "Sales Invoice",
        name: "SINV-0001",
        posProfile: "POS-001",
      }),
    );

    await waitFor(() =>
      expect(hook.result.current.actions).toEqual([
        { action: "Approve", next_state: "Approved" },
      ]),
    );
    expect(mockGetVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.profile.get_workflow_actions",
      {
        doctype: "Sales Invoice",
        docname: "SINV-0001",
        pos_profile: "POS-001",
      },
      expect.any(AbortSignal),
    );
  });

  it("applies an action through the authoritative workflow endpoint", async () => {
    mockGetVunaMethod.mockResolvedValue([
      { action: "Approve", next_state: "Approved" },
    ]);
    mockPostVunaMethod.mockResolvedValue({
      docstatus: 1,
      doctype: "Sales Invoice",
      name: "SINV-0001",
    });
    const hook = await renderHook(() =>
      usePosWorkflowActions({
        doctype: "Sales Invoice",
        name: "SINV-0001",
        posProfile: "POS-001",
      }),
    );

    await act(async () => {
      await hook.result.current.apply("Approve");
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.profile.apply_workflow_action",
      {
        action: "Approve",
        doctype: "Sales Invoice",
        docname: "SINV-0001",
        pos_profile: "POS-001",
      },
    );
  });
});
