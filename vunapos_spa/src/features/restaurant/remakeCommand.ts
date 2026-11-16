export type RemakeQuote = {
  ticket: string;
  fingerprint: string;
  lines: Array<{
    line_id: string;
    item_name: string;
    uom: string;
    max_qty: number;
  }>;
};
export type RemakeCommand = {
  ticket: string;
  fingerprint: string;
  quantities: Record<string, number>;
  request_key: string;
  reason: string;
  disposition: "Discard" | "Keep for guest";
};
export type SavedRemake = { command: RemakeCommand; quote: RemakeQuote };
const key = (scope: string, ticket: string) =>
  `${scope}:remake:${encodeURIComponent(ticket)}`;

export function readRemake(
  scope: string | null,
  ticket: string
): SavedRemake | null {
  if (!scope) return null;
  try {
    const raw = sessionStorage.getItem(key(scope, ticket));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedRemake;
    if (
      saved?.command?.ticket !== ticket ||
      !saved.command.request_key ||
      !saved.command.fingerprint ||
      typeof saved.command.reason !== "string" ||
      !["Discard", "Keep for guest"].includes(saved.command.disposition) ||
      !saved.command.quantities ||
      Array.isArray(saved.command.quantities) ||
      typeof saved.command.quantities !== "object" ||
      !Object.keys(saved.command.quantities).length ||
      !Object.values(saved.command.quantities).every(
        (qty) => typeof qty === "number" && Number.isFinite(qty) && qty > 0
      ) ||
      saved.quote?.ticket !== ticket ||
      saved.quote.fingerprint !== saved.command.fingerprint ||
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
      throw new Error("Invalid saved remake");
    return saved;
  } catch {
    throw new Error(
      "The saved remake request could not be read. Ask a manager to review this ticket before clearing browser storage."
    );
  }
}
export function saveRemake(scope: string | null, saved: SavedRemake) {
  if (!scope)
    throw new Error("Wait for your POS Profile before requesting a remake.");
  try {
    sessionStorage.setItem(
      key(scope, saved.command.ticket),
      JSON.stringify(saved)
    );
  } catch {
    throw new Error(
      "The remake could not be saved for recovery. No request was sent. Check browser storage and try again."
    );
  }
}
export function clearRemake(scope: string | null, ticket: string) {
  if (scope) sessionStorage.removeItem(key(scope, ticket));
}
