import type { FloorPlanDTO, TableStatusDTO } from "./types";

export function selectVisitTable(
  previous: string[],
  table: string,
  action: "join" | "transfer"
): string[] {
  if (action === "transfer") return [table];
  return previous.includes(table)
    ? previous.filter((name) => name !== table)
    : [...previous, table];
}

/** A transfer replaces all current assignments with one free destination. */
export function transferFloors(
  floors: FloorPlanDTO["floors"],
  statuses: TableStatusDTO[],
  currentTables: string[]
): FloorPlanDTO["floors"] {
  const unavailable = new Set([
    ...currentTables,
    ...statuses
      .filter(
        (row) => row.session || row.status === "Occupied" || row.orders.length
      )
      .map((row) => row.table),
  ]);
  return floors.map((floor) => ({
    ...floor,
    tables: floor.tables.filter((table) => !unavailable.has(table.name)),
  }));
}
