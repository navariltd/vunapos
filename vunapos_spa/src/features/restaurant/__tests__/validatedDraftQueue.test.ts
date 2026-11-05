import { describe, expect, it } from "vitest";
import { ValidatedDraftQueue } from "../validatedDraftQueue";

function harness() {
  let current: { qty: number } | null = { qty: 0 };
  const queue = new ValidatedDraftQueue<{ qty: number }>();
  const pending: number[] = [];
  return {
    read: () => current,
    clear: () => {
      current = null;
    },
    queue,
    pending,
    enqueue: (
      edit: (value: { qty: number }) => { qty: number },
      validate: (next: { qty: number }) => Promise<unknown>
    ) =>
      queue.enqueue({
        read: () => current,
        commit: (next) => {
          current = next;
        },
        edit,
        validate,
        blocked: () => false,
        changed: (count) => pending.push(count),
      }),
  };
}

describe("ingredient-checked cart edits", () => {
  it("checks rapid additions against the accepted previous addition", async () => {
    const cart = harness();
    const checked: number[] = [];
    const validate = async (next: { qty: number }) => {
      checked.push(next.qty);
    };
    await Promise.all([
      cart.enqueue((old) => ({ qty: old.qty + 1 }), validate),
      cart.enqueue((old) => ({ qty: old.qty + 1 }), validate),
    ]);
    expect(checked).toEqual([1, 2]);
    expect(cart.read()?.qty).toBe(2);
    expect(cart.queue.pending).toBe(0);
  });

  it("rejects shortages without changing quantity and permits a corrected retry", async () => {
    const cart = harness();
    const failed = cart.enqueue(
      () => ({ qty: 100 }),
      async () => {
        throw new Error("Not enough milk");
      }
    );
    const retry = cart.enqueue(
      (old) => ({ qty: old.qty + 1 }),
      async () => undefined
    );
    await expect(failed).rejects.toThrow("Not enough milk");
    await retry;
    expect(cart.read()?.qty).toBe(1);
    expect(cart.pending.at(-1)).toBe(0);
  });

  it("does not resurrect a cart cleared while a check was running", async () => {
    const cart = harness();
    let release = () => {};
    const checked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const task = cart.enqueue(
      () => ({ qty: 1 }),
      () => checked
    );
    await Promise.resolve();
    await Promise.resolve();
    cart.clear();
    release();
    await task;
    expect(cart.read()).toBeNull();
  });
});
