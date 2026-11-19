import type { RemakeQuote } from "./remakeCommand";

export type RejectionQuote = RemakeQuote;
export type RejectionCommand = {
  ticket: string;
  fingerprint: string;
  quantities: Record<string, number>;
  request_key: string;
  reason: string;
  charge: "Keep charge" | "Remove charge";
};
export type SavedRejection = {
  command: RejectionCommand;
  quote: RejectionQuote;
};
const key = (scope: string, ticket: string) =>
  `${scope}:rejection:${encodeURIComponent(ticket)}`;

export function readRejection(
  scope: string | null,
  ticket: string
): SavedRejection | null {
  if (!scope) return null;
  try {
    const raw = sessionStorage.getItem(key(scope, ticket));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedRejection;
    const command = saved?.command;
    if (
      command?.ticket !== ticket ||
      typeof command.request_key !== "string" ||
      !command.request_key ||
      typeof command.reason !== "string" ||
      !command.reason.trim() ||
      !["Keep charge", "Remove charge"].includes(command.charge) ||
      !command.quantities ||
      Array.isArray(command.quantities) ||
      typeof command.quantities !== "object" ||
      !Object.keys(command.quantities).length ||
      !Object.values(command.quantities).every(
        (qty) => typeof qty === "number" && Number.isFinite(qty) && qty > 0
      ) ||
      saved.quote?.ticket !== ticket ||
      !saved.quote.fingerprint ||
      saved.quote.fingerprint !== command.fingerprint ||
      !Array.isArray(saved.quote.lines) ||
      !saved.quote.lines.every(
        (line) =>
          typeof line?.line_id === "string" &&
          typeof line.item_name === "string" &&
          typeof line.uom === "string" &&
          Number.isFinite(line.max_qty)
      )
    )
      throw new Error("Invalid saved rejection");
    return saved;
  } catch {
    throw new Error(
      "The saved rejection could not be read. Ask a manager to review the ticket before clearing browser storage."
    );
  }
}
export function saveRejection(scope: string | null, saved: SavedRejection) {
  if (!scope)
    throw new Error(
      "Wait for your POS Profile before recording rejected food."
    );
  try {
    sessionStorage.setItem(
      key(scope, saved.command.ticket),
      JSON.stringify(saved)
    );
  } catch {
    throw new Error(
      "The rejection could not be saved for recovery. No request was sent. Check browser storage and try again."
    );
  }
}
export function clearRejection(scope: string | null, ticket: string) {
  if (scope) sessionStorage.removeItem(key(scope, ticket));
}
