import type { KitchenAction, KitchenTicketDTO } from "./types";

export type KitchenCommand = {
  ticket: string;
  action: KitchenAction;
  request_key: string;
  expected_status: string;
  expected_modified?: string;
  quantities?: Record<string, number>;
  reason?: string;
};

export function kitchenLines(ticket: KitchenTicketDTO, action: KitchenAction) {
  return ticket.items.filter(
    (line) =>
      !line.parent_line_id && Number(line.available_quantities?.[action]) > 0
  );
}

export function positiveKitchenQuantities(values: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(values).filter(([, qty]) => Number.isFinite(qty) && qty > 0)
  );
}

function storageKey(scope: string, ticket: string) {
  return `${scope}:kitchen-command:${encodeURIComponent(ticket)}`;
}

export function pendingKitchenTickets(scope: string | null): string[] {
  if (!scope) return [];
  const prefix = `${scope}:kitchen-command:`;
  const tickets: string[] = [];
  for (let index = 0; index < sessionStorage.length; index++) {
    const key = sessionStorage.key(index);
    if (key?.startsWith(prefix))
      tickets.push(decodeURIComponent(key.slice(prefix.length)));
  }
  return tickets;
}

export function readKitchenCommand(
  scope: string | null,
  ticket: string
): KitchenCommand | null {
  if (!scope) return null;
  const raw = sessionStorage.getItem(storageKey(scope, ticket));
  if (!raw) return null;
  const command = JSON.parse(raw) as KitchenCommand;
  if (
    command.ticket !== ticket ||
    !command.request_key ||
    !["Accept", "Start", "Ready", "Serve", "Undo Serve"].includes(
      command.action
    ) ||
    typeof command.expected_status !== "string"
  )
    throw new Error(
      "The saved kitchen action could not be read. Ask a manager to review this ticket before clearing its browser storage."
    );
  return command;
}

export function saveKitchenCommand(
  scope: string | null,
  command: KitchenCommand
) {
  if (!scope)
    throw new Error("Wait for your POS Profile before updating the kitchen.");
  try {
    sessionStorage.setItem(
      storageKey(scope, command.ticket),
      JSON.stringify(command)
    );
  } catch {
    throw new Error(
      "Your browser could not save this kitchen action for recovery. Free browser storage before trying again; no action was sent."
    );
  }
}

export function clearKitchenCommand(scope: string | null, ticket: string) {
  if (scope) sessionStorage.removeItem(storageKey(scope, ticket));
}
