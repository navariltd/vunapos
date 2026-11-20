export type StopMaterial = {
  id: string;
  item_name: string;
  item_code: string;
  warehouse: string;
  uom: string;
  max_qty: number;
  kind: string;
};
export type StopQuote = {
  ticket: string;
  fingerprint: string;
  charge_item?: string | null;
  waste_account?: string | null;
  lines: Array<{
    line_id: string;
    item_name: string;
    uom: string;
    qty: number;
    ready_qty: number;
    recorded_consumption?: Array<{
      item_code: string;
      qty: number;
      uom: string;
    }>;
    materials: StopMaterial[];
  }>;
};
export type StopCommand = {
  ticket: string;
  fingerprint: string;
  request_key: string;
  line_ids: string[];
  used: Record<string, number>;
  reason: string;
  charge: "Keep charge" | "Remove charge";
};
export type SavedStop = { command: StopCommand; quote: StopQuote };
const key = (scope: string, ticket: string) =>
  `${scope}:stop-preparation:${encodeURIComponent(ticket)}`;
export function readStop(
  scope: string | null,
  ticket: string
): SavedStop | null {
  if (!scope) return null;
  try {
    const raw = sessionStorage.getItem(key(scope, ticket));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedStop;
    const command = saved?.command;
    if (
      command?.ticket !== ticket ||
      typeof command.request_key !== "string" ||
      !command.request_key.trim() ||
      typeof command.reason !== "string" ||
      !command.reason.trim() ||
      typeof command.fingerprint !== "string" ||
      !["Keep charge", "Remove charge"].includes(command.charge) ||
      !Array.isArray(command.line_ids) ||
      !command.line_ids.length ||
      new Set(command.line_ids).size !== command.line_ids.length ||
      !command.line_ids.every((id) => typeof id === "string") ||
      !command.used ||
      Array.isArray(command.used) ||
      typeof command.used !== "object" ||
      !Object.values(command.used).every(
        (qty) => typeof qty === "number" && Number.isFinite(qty) && qty >= 0
      ) ||
      saved.quote?.ticket !== ticket ||
      !saved.quote.fingerprint ||
      saved.quote.fingerprint !== command.fingerprint ||
      !Array.isArray(saved.quote.lines)
    )
      throw new Error("Invalid stop recovery");
    const lines = saved.quote.lines.filter((line) =>
      command.line_ids.includes(line.line_id)
    );
    if (
      lines.length !== command.line_ids.length ||
      !lines.every(
        (line) =>
          typeof line.item_name === "string" &&
          Number.isFinite(line.qty) &&
          Array.isArray(line.materials)
      )
    )
      throw new Error("Invalid stop review");
    const materials = lines.flatMap((line) => line.materials);
    if (
      materials.length !== Object.keys(command.used).length ||
      !materials.every(
        (part) =>
          typeof part.id === "string" &&
          typeof part.item_name === "string" &&
          Number.isFinite(part.max_qty) &&
          part.id in command.used &&
          command.used[part.id] <= part.max_qty
      )
    )
      throw new Error("Incomplete material review");
    return saved;
  } catch {
    throw new Error(
      "The saved preparation stop could not be read. Ask a manager to review the ticket before clearing browser storage."
    );
  }
}
export function saveStop(scope: string | null, saved: SavedStop) {
  if (!scope)
    throw new Error("Wait for your POS Profile before stopping preparation.");
  try {
    sessionStorage.setItem(
      key(scope, saved.command.ticket),
      JSON.stringify(saved)
    );
  } catch {
    throw new Error(
      "The stop could not be saved for recovery. No request was sent. Check browser storage and try again."
    );
  }
}
export function clearStop(scope: string | null, ticket: string) {
  if (scope) sessionStorage.removeItem(key(scope, ticket));
}
