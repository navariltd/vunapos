export type KitchenAudioTone = "new" | "alert";

type KitchenAudioEvent = {
  name?: unknown;
  kitchen_station?: unknown;
  status?: unknown;
  action?: unknown;
};

const CANCELLATION_ACTIONS = new Set([
  "Cancel Items",
  "Stop Preparation",
  "Cancel Order",
  "Cancel Remake",
]);

const MAX_TRACKED_EVENTS = 500;

function asEvent(value: unknown): KitchenAudioEvent | null {
  return value !== null && typeof value === "object"
    ? value as KitchenAudioEvent
    : null;
}

function field(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function trimOldest<K, V>(map: Map<K, V>) {
  if (map.size <= MAX_TRACKED_EVENTS) return;
  const oldest = map.keys().next().value;
  if (oldest !== undefined) map.delete(oldest);
}

function rememberOnce(seen: Map<string, true>, key: string): boolean {
  if (seen.has(key)) return false;
  seen.set(key, true);
  trimOldest(seen);
  return true;
}

export function createKitchenAudioEventHandlers(
  stations: readonly string[],
  play: (tone: KitchenAudioTone) => void,
) {
  const allowedStations = new Set(stations);
  const seenTickets = new Map<string, true>();
  const seenActions = new Map<string, true>();
  const printJobStatuses = new Map<string, string>();

  function belongsToStation(event: KitchenAudioEvent) {
    const station = field(event.kitchen_station);
    return station !== null && allowedStations.has(station);
  }

  function arrival(value: unknown) {
    const event = asEvent(value);
    if (!event || !belongsToStation(event)) return;

    const ticket = field(event.name);

    // Older backend events without an identifier retain their old behaviour.
    if (ticket && !rememberOnce(seenTickets, ticket)) return;

    play("new");
  }

  function printJob(value: unknown) {
    const event = asEvent(value);
    if (!event || !belongsToStation(event)) return;

    const status = field(event.status);
    if (!status) return;

    const job = field(event.name);

    // Backward compatibility with older event payloads.
    if (!job) {
      if (status === "Uncertain") play("alert");
      return;
    }

    const previousStatus = printJobStatuses.get(job);

    // Maintain the latest status so a retried job can alert again.
    printJobStatuses.delete(job);
    printJobStatuses.set(job, status);
    trimOldest(printJobStatuses);

    if (status === "Uncertain" && previousStatus !== "Uncertain") {
      play("alert");
    }
  }

  function action(value: unknown) {
    const event = asEvent(value);
    if (!event || !belongsToStation(event)) return;

    const actionName = field(event.action);
    if (!actionName || !CANCELLATION_ACTIONS.has(actionName)) return;

    const eventName = field(event.name);

    if (eventName && !rememberOnce(seenActions, eventName)) return;

    play("alert");
  }

  return { arrival, printJob, action };
}
