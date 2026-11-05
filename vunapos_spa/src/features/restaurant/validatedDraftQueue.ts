/** Serialize checked edits against the latest accepted cart, never a stale render. */
export class ValidatedDraftQueue<T> {
  private tail: Promise<unknown> = Promise.resolve();
  pending = 0;

  enqueue(options: {
    read: () => T | null;
    commit: (next: T) => void;
    edit: (current: T) => T;
    validate: (next: T) => Promise<unknown>;
    blocked: () => boolean;
    changed: (pending: number) => void;
  }): Promise<void> {
    this.pending++;
    options.changed(this.pending);
    const task = this.tail
      .catch(() => undefined)
      .then(async () => {
        const current = options.read();
        if (!current || options.blocked()) return;
        const next = options.edit(current);
        await options.validate(next);
        // Clearing, changing context or navigation supersedes this request.
        if (options.read() === current && !options.blocked())
          options.commit(next);
      })
      .finally(() => {
        this.pending--;
        options.changed(this.pending);
      });
    // Keep the queue alive without an unhandled rejection when an edit fails.
    this.tail = task.catch(() => undefined);
    return task;
  }
}
