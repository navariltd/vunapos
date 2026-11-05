import type { KitchenRoutingIssue } from "./types";

export function parseKitchenRoutingIssue(
  meta?: Record<string, unknown>
): KitchenRoutingIssue | null {
  if (
    !Array.isArray(meta?.items) ||
    !Array.isArray(meta?.stations) ||
    !meta.items.length
  )
    return null;
  const items = meta.items.filter(
    (row) =>
      row &&
      typeof row.item_code === "string" &&
      typeof row.item_group === "string" &&
      ["missing", "ambiguous", "invalid"].includes(row.reason) &&
      Array.isArray(row.candidates) &&
      row.candidates.every((name: unknown) => typeof name === "string")
  );
  const stations = meta.stations.filter(
    (row) =>
      row &&
      typeof row.name === "string" &&
      typeof row.station_name === "string"
  );
  if (
    items.length !== meta.items.length ||
    stations.length !== meta.stations.length
  )
    return null;
  return { items, stations };
}

export function kitchenRoutingComplete(
  issue: KitchenRoutingIssue,
  selections: Record<string, string>
) {
  return issue.items.every((item) =>
    issue.stations.some(
      (station) => station.name === selections[item.item_code]
    )
  );
}
