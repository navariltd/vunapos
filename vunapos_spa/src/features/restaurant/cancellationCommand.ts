export type CancellationQuote = {
  order: string;
  fingerprint: string;
  pos_profile: string;
  requires_manager_pin: boolean;
  lines: Array<{
    line_id: string;
    item_name: string;
    qty: number;
    uom: string;
    max_cancel_qty: number;
  }>;
};

export type CancellationCommand = {
  order: string;
  quantities: Record<string, number>;
  fingerprint: string;
  request_key: string;
  reason: string;
};

export type SavedCancellation = {
  command: CancellationCommand;
  quote: CancellationQuote;
};
const key = (scope: string, order: string) =>
  `${scope}:cancel-items:${encodeURIComponent(order)}`;

export function readCancellation(
  scope: string | null,
  order: string
): SavedCancellation | null {
  if (!scope) return null;
  const raw = sessionStorage.getItem(key(scope, order));
  if (!raw) return null;
  const saved = JSON.parse(raw) as SavedCancellation;
  if (
    saved?.command?.order !== order ||
    !saved.command.request_key ||
    !saved.command.fingerprint ||
    typeof saved.command.reason !== "string" ||
    !saved.command.quantities ||
    Array.isArray(saved.command.quantities) ||
    typeof saved.command.quantities !== "object" ||
    !Object.values(saved.command.quantities).every(
      (qty) => typeof qty === "number" && Number.isFinite(qty) && qty > 0
    ) ||
    saved.quote?.order !== order ||
    typeof saved.quote.pos_profile !== "string" ||
    typeof saved.quote.requires_manager_pin !== "boolean" ||
    saved.quote.fingerprint !== saved.command.fingerprint ||
    !Array.isArray(saved.quote.lines) ||
    !saved.quote.lines.every(
      (line) =>
        line &&
        typeof line.line_id === "string" &&
        typeof line.item_name === "string" &&
        typeof line.uom === "string" &&
        Number.isFinite(line.qty) &&
        Number.isFinite(line.max_cancel_qty)
    )
  )
    throw new Error(
      "The saved cancellation could not be read. Ask a manager to review this order before clearing browser storage."
    );
  return saved;
}

export function saveCancellation(
  scope: string | null,
  saved: SavedCancellation
) {
  if (!scope)
    throw new Error("Wait for your POS Profile before cancelling items.");
  try {
    sessionStorage.setItem(
      key(scope, saved.command.order),
      JSON.stringify(saved)
    );
  } catch {
    throw new Error(
      "The cancellation could not be saved for recovery. No request was sent. Check browser storage before trying again."
    );
  }
}

export function clearCancellation(scope: string | null, order: string) {
  if (scope) sessionStorage.removeItem(key(scope, order));
}
