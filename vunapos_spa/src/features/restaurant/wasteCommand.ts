export type WasteQuote = {
  ticket: string;
  fingerprint: string;
  invoice: string;
  invoice_doctype: string;
  currency?: string;
  waste_account?: string;
  lines: Array<{
    line_id: string;
    item_name: string;
    uom: string;
    max_qty: number;
    unit_cost?: number;
  }>;
};
export type WasteCommand = {
  ticket: string;
  fingerprint: string;
  quantities: Record<string, number>;
  request_key: string;
  reason: string;
};
export type SavedWaste = { command: WasteCommand; quote: WasteQuote };
const key = (scope: string, ticket: string) =>
  `${scope}:waste:${encodeURIComponent(ticket)}`;

export function readWaste(
  scope: string | null,
  ticket: string
): SavedWaste | null {
  if (!scope) return null;
  const raw = sessionStorage.getItem(key(scope, ticket));
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as SavedWaste;
    if (
      saved?.command?.ticket !== ticket ||
      !saved.command.request_key ||
      !saved.command.fingerprint ||
      typeof saved.command.reason !== "string" ||
      !saved.command.quantities ||
      Array.isArray(saved.command.quantities) ||
      typeof saved.command.quantities !== "object" ||
      !Object.keys(saved.command.quantities).length ||
      !Object.values(saved.command.quantities).every(
        (qty) => typeof qty === "number" && Number.isFinite(qty) && qty > 0
      ) ||
      saved.quote?.ticket !== ticket ||
      saved.quote.fingerprint !== saved.command.fingerprint ||
      typeof saved.quote.invoice !== "string" ||
      !Array.isArray(saved.quote.lines) ||
      !saved.quote.lines.every(
        (line) =>
          line &&
          typeof line.line_id === "string" &&
          typeof line.item_name === "string" &&
          typeof line.uom === "string" &&
          Number.isFinite(line.max_qty)
      )
    )
      throw new Error("Invalid saved waste");
    return saved;
  } catch {
    throw new Error(
      "The saved waste request could not be read. Ask a manager to reconcile this ticket before clearing browser storage."
    );
  }
}

export function saveWaste(scope: string | null, saved: SavedWaste) {
  if (!scope)
    throw new Error("Wait for your POS Profile before recording waste.");
  try {
    sessionStorage.setItem(
      key(scope, saved.command.ticket),
      JSON.stringify(saved)
    );
  } catch {
    throw new Error(
      "The waste request could not be saved for recovery. No request was sent. Check browser storage and try again."
    );
  }
}

export function clearWaste(scope: string | null, ticket: string) {
  if (scope) sessionStorage.removeItem(key(scope, ticket));
}
