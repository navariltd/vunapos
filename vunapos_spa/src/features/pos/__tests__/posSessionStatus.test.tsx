import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { usePosSessionStatus } from "../hooks/usePosSessionStatus";

const mocked = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("frappe-react-sdk", () => ({ useFrappeGetCall: mocked.get }));

function Session() {
  const result = usePosSessionStatus("Counter 1", "test@navari.co.ke");
  return <div>{result.error || (result.session?.ready ? "OPEN" : "BLOCKED")}</div>;
}

describe("live session identity", () => {
  const respond = (profile: string, cashier: string) => mocked.get.mockReturnValue({
    data: { message: { ok: true, data: { session: { pos_profile: profile, cashier, ready: true, status: "OPEN" } } } },
    isLoading: false, mutate: vi.fn(),
  });

  it("uses a user/profile cache key and revalidates when the gate mounts", () => {
    respond("Counter 1", "test@navari.co.ke");
    expect(renderToStaticMarkup(<Session />)).toContain("OPEN");
    expect(mocked.get.mock.lastCall?.[2]).toEqual(["vunapos_session_status", "test@navari.co.ke", "Counter 1"]);
    expect(mocked.get.mock.lastCall?.[3]).toMatchObject({ revalidateOnMount: true, keepPreviousData: false });
  });

  it("rejects an open session from the previously selected profile", () => {
    respond("Katheri Cooler", "test@navari.co.ke");
    expect(renderToStaticMarkup(<Session />)).toContain("does not match");
  });

  it("rejects another user's open session", () => {
    respond("Counter 1", "Administrator");
    expect(renderToStaticMarkup(<Session />)).toContain("does not match");
  });
});
