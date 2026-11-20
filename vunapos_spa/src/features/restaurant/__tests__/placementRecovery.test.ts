import { beforeEach, describe, expect, it, vi } from "vitest";
import { newOrderDraft } from "../orderDraft";
import { placePending, type PendingPlacement } from "../placement";
import { draftScope, useOrderDraftStore } from "../stores/orderDraftStore";
import type { RestaurantSessionDTO } from "../types";

const store = () => useOrderDraftStore.getState();
const visit = {
  name: "RS-1",
  status: "Open",
  pos_profile: "Counter",
  tables: [],
} as unknown as RestaurantSessionDTO;
const envelope = (data: unknown) => ({ message: { ok: true, data } });
const intent: PendingPlacement = {
  key: "round-1",
  pos_profile: "Counter",
  session: null,
  opening: {
    pos_profile: "Counter",
    idempotency_key: "session:round-1",
    tables: [],
    service_type: "Takeaway",
    customer: "Walk In",
    guest_count: 1,
  },
  items: [{ item_code: "Burger", qty: 2, line_id: "line-1" }],
};

function draft() {
  return {
    ...newOrderDraft({
      pos_profile: "Counter",
      service_type: "Takeaway",
      idempotency_key: intent.key,
    }),
    unsent: [
      {
        item_code: "Burger",
        item_name: "Burger",
        qty: 2,
        line_id: "line-1",
        note: "",
      },
    ],
  };
}

describe("durable restaurant placement", () => {
  let saved: Map<string, string>;
  beforeEach(() => {
    saved = new Map();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    });
    useOrderDraftStore.setState({
      scope: null,
      draft: null,
      pendingPlacement: null,
      storageError: null,
    });
    store().activateScope("waiter@example.com", "Counter");
    store().setDraft(draft());
  });

  it("restores an unsent draft and its exact pending payload after reload", () => {
    store().beginPlacement(intent);
    store().rememberSession("RS-1");
    useOrderDraftStore.setState({
      scope: null,
      draft: null,
      pendingPlacement: null,
    });
    store().activateScope("waiter@example.com", "Counter");
    expect(store().draft?.unsent[0].qty).toBe(2);
    expect(store().draft?.restaurant_session).toBe("RS-1");
    expect(store().pendingPlacement).toEqual({ ...intent, session: "RS-1" });
  });

  it("does not leak drafts to another user or profile", () => {
    store().activateScope("cashier@example.com", "Counter");
    expect(store().draft).toBeNull();
    store().activateScope("waiter@example.com", "Other");
    expect(store().draft).toBeNull();
    store().activateScope("waiter@example.com", "Counter");
    expect(store().draft?.unsent).toHaveLength(1);
  });

  it("does not let edits, clear, or replacement overwrite an uncertain submission", () => {
    store().beginPlacement(intent);
    store().setDraft(null);
    store().updateDraft((value) => ({ ...value, unsent: [] }));
    const next = store().beginPlacement({ ...intent, items: [] });
    expect(next.items).toHaveLength(1);
    expect(store().draft?.unsent).toHaveLength(1);
  });

  it("keeps the pending intent when writing the successful result fails", () => {
    store().beginPlacement(intent);
    vi.stubGlobal("sessionStorage", {
      setItem: () => {
        throw new Error("Quota exceeded");
      },
    });
    expect(() => store().finishPlacement(null)).toThrow("could not save");
    expect(store().pendingPlacement?.key).toBe(intent.key);
  });

  it("can retry recovery after browser storage becomes writable again", () => {
    store().beginPlacement(intent);
    const storage = sessionStorage;
    vi.stubGlobal("sessionStorage", {
      setItem: () => {
        throw new Error("Full");
      },
    });
    expect(() => store().finishPlacement(null)).toThrow();
    vi.stubGlobal("sessionStorage", storage);
    expect(store().beginPlacement(intent).key).toBe(intent.key);
    expect(store().storageError).toBeNull();
  });

  it("does not hydrate unknown properties over store actions", () => {
    saved.set(
      draftScope("other", "Counter"),
      JSON.stringify({
        draft: null,
        pendingPlacement: null,
        setDraft: "broken",
      })
    );
    store().activateScope("other", "Counter");
    expect(typeof store().setDraft).toBe("function");
  });

  it("distinguishes a server rejection from HTML and transport failures", async () => {
    const { createSessionRound } = await import("../../../services/vunaApi");
    const params = {
      session: "RS-1",
      items: intent.items,
      idempotency_key: intent.key,
    };
    await expect(
      createSessionRound(
        vi
          .fn()
          .mockResolvedValue({
            message: {
              ok: false,
              errors: [{ code: "ITEMS_REQUIRED", message: "Add an item" }],
            },
          }),
        params
      )
    ).rejects.toMatchObject({ serverRejected: true });
    await expect(
      createSessionRound(
        vi.fn().mockResolvedValue("<html>Login</html>"),
        params
      )
    ).rejects.toMatchObject({ serverRejected: false });
    await expect(
      createSessionRound(
        vi.fn().mockRejectedValue(new Error("Timeout")),
        params
      )
    ).rejects.toThrow("Timeout");
  });

  it("fails closed on malformed storage rather than overwriting an unknown order", () => {
    saved.set(draftScope("other", "Counter"), "{broken");
    store().activateScope("other", "Counter");
    expect(store().storageError).toContain("could not be read");
    expect(() => store().beginPlacement(intent)).toThrow();
    expect(saved.get(draftScope("other", "Counter"))).toBe("{broken");
  });

  it("recovers a committed round without opening or sending it again, even after settlement", async () => {
    const calls = {
      open: vi.fn(),
      round: vi.fn(),
      recover: vi.fn().mockResolvedValue(
        envelope({
          session: { ...visit, status: "Settled" },
          order: { name: "SO-1" },
        })
      ),
      get: vi.fn(),
    };
    const result = await placePending(intent, calls, vi.fn(), true);
    expect(result.status).toBe("Settled");
    expect(calls.open).not.toHaveBeenCalled();
    expect(calls.round).not.toHaveBeenCalled();
  });

  it("does not resend when the recovery check itself fails", async () => {
    const calls = {
      open: vi.fn(),
      round: vi.fn(),
      recover: vi.fn().mockRejectedValue(new Error("Network down")),
      get: vi.fn(),
    };
    await expect(placePending(intent, calls, vi.fn(), true)).rejects.toThrow(
      "Network down"
    );
    expect(calls.open).not.toHaveBeenCalled();
    expect(calls.round).not.toHaveBeenCalled();
  });

  it("remembers a successfully opened visit before attempting its first round", async () => {
    const events: string[] = [];
    const calls = {
      open: vi.fn().mockResolvedValue(envelope(visit)),
      round: vi.fn().mockImplementation(async () => {
        events.push("round");
        throw new Error("Timeout");
      }),
      recover: vi.fn().mockResolvedValue(envelope(null)),
      get: vi.fn(),
    };
    store().beginPlacement(intent);
    await expect(
      placePending(
        intent,
        calls,
        (value) => {
          events.push("remember");
          store().rememberSession(value.name);
        },
        true
      )
    ).rejects.toThrow("Timeout");
    expect(events).toEqual(["remember", "round"]);
    expect(store().pendingPlacement?.session).toBe("RS-1");
  });

  it("retries with the saved session and key, not a fresh opening", async () => {
    const calls = {
      open: vi.fn(),
      round: vi.fn().mockResolvedValue(envelope({ name: "SO-1" })),
      recover: vi.fn().mockResolvedValue(envelope(null)),
      get: vi.fn().mockResolvedValue(visit),
    };
    await placePending({ ...intent, session: "RS-1" }, calls, vi.fn(), true);
    expect(calls.open).not.toHaveBeenCalled();
    expect(calls.round).toHaveBeenCalledWith(
      expect.objectContaining({
        session: "RS-1",
        idempotency_key: intent.key,
        items: JSON.stringify(intent.items),
      })
    );
  });
});
